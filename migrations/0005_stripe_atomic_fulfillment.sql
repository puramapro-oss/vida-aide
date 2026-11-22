-- Apply after schema.sql and 0004. No historical balance/payment is rewritten.
-- Existing stripe_events rows are NOT completion receipts: the old relay inserted
-- them before its effects. They must be reconciled, never automatically replayed.
BEGIN;

ALTER TABLE vida_aide.stripe_events ADD COLUMN IF NOT EXISTS object_id text;
ALTER TABLE vida_aide.stripe_events ADD COLUMN IF NOT EXISTS payload_hash text;
ALTER TABLE vida_aide.stripe_events ADD COLUMN IF NOT EXISTS receipt jsonb;
ALTER TABLE vida_aide.wallet_transactions ADD COLUMN IF NOT EXISTS stripe_checkout_id text;
ALTER TABLE vida_aide.payments ADD COLUMN IF NOT EXISTS stripe_checkout_id text;
ALTER TABLE vida_aide.profiles ADD COLUMN IF NOT EXISTS stripe_state_revision bigint NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_stripe_customer_unique
  ON vida_aide.profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_stripe_checkout_unique
  ON vida_aide.wallet_transactions (stripe_checkout_id) WHERE stripe_checkout_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_checkout_unique
  ON vida_aide.payments (stripe_checkout_id) WHERE stripe_checkout_id IS NOT NULL;

-- The public legacy handler kept no event/session key. Old deliveries cannot be
-- distinguished from already credited payments. Keep an immutable cutover for
-- automatic crediting; an older checkout requires evidence-based reconciliation.
CREATE TABLE IF NOT EXISTS vida_aide.stripe_fulfillment_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO vida_aide.stripe_fulfillment_settings(singleton) VALUES(true)
  ON CONFLICT (singleton) DO NOTHING;
ALTER TABLE vida_aide.stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE vida_aide.stripe_fulfillment_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vida_aide.stripe_events, vida_aide.stripe_fulfillment_settings
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON vida_aide.stripe_fulfillment_settings FROM service_role;
GRANT SELECT, INSERT, UPDATE ON vida_aide.stripe_events TO service_role;
GRANT SELECT ON vida_aide.stripe_fulfillment_settings TO service_role;

CREATE OR REPLACE FUNCTION vida_aide.apply_stripe_fulfillment(
  p_event_id text, p_event_type text, p_object_id text, p_payload_hash text,
  p_event_created bigint, p_profile_id uuid, p_expected_revision bigint,
  p_checkout jsonb, p_subscription jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, vida_aide
AS $$
DECLARE
  v_event vida_aide.stripe_events%ROWTYPE;
  v_profile uuid;
  v_target vida_aide.profiles%ROWTYPE;
  v_referrer uuid;
  v_payment uuid;
  v_wallet uuid;
  v_existing_payment vida_aide.payments%ROWTYPE;
  v_existing_wallet vida_aide.wallet_transactions%ROWTYPE;
  v_customer text;
  v_amount numeric;
  v_commission numeric;
  v_receipt jsonb;
  v_cutover timestamptz;
  v_status text := 'applied';
  v_checkout boolean := p_event_type IN ('checkout.session.completed', 'checkout.session.async_payment_succeeded');
BEGIN
  IF p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 1 AND 255
    OR p_object_id IS NULL OR length(p_object_id) NOT BETWEEN 1 AND 255
    OR p_payload_hash IS NULL OR p_payload_hash !~ '^[a-f0-9]{64}$'
    OR p_event_created IS NULL OR p_event_created < 0
    OR p_event_type IS NULL OR p_event_type NOT IN (
      'checkout.session.completed', 'checkout.session.async_payment_succeeded',
      'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'
    ) THEN RAISE EXCEPTION 'Invalid fulfillment identity' USING ERRCODE = '22023'; END IF;

  -- The unique event row is locked until ALL effects and the receipt commit.
  INSERT INTO vida_aide.stripe_events(event_id, type, object_id, payload_hash)
    VALUES(p_event_id, p_event_type, p_object_id, p_payload_hash)
    ON CONFLICT (event_id) DO NOTHING;
  SELECT * INTO STRICT v_event FROM vida_aide.stripe_events WHERE event_id=p_event_id FOR UPDATE;
  IF v_event.payload_hash IS NULL OR v_event.object_id IS NULL THEN
    RAISE EXCEPTION 'Legacy event requires reconciliation' USING ERRCODE = 'P0001';
  END IF;
  IF v_event.payload_hash <> p_payload_hash OR v_event.object_id <> p_object_id
    OR v_event.type IS DISTINCT FROM p_event_type THEN
    RAISE EXCEPTION 'Event identity conflict' USING ERRCODE = '22023';
  END IF;
  IF v_event.receipt IS NOT NULL THEN
    RETURN v_event.receipt || jsonb_build_object('duplicate', true);
  END IF;
  IF p_profile_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0 THEN
    RAISE EXCEPTION 'Missing profile revision' USING ERRCODE='22023';
  END IF;
  SELECT * INTO STRICT v_target FROM vida_aide.profiles WHERE id=p_profile_id FOR UPDATE;
  IF v_target.stripe_state_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Stale subscription snapshot; retry after rereading provider' USING ERRCODE='40001';
  END IF;

  IF v_checkout THEN
    IF jsonb_typeof(p_checkout) IS DISTINCT FROM 'object'
      OR (p_checkout->>'id') IS DISTINCT FROM p_object_id
      OR COALESCE(length(p_checkout->>'customer_id'),0) NOT BETWEEN 1 AND 255
      OR COALESCE(p_checkout->>'mode','') NOT IN ('subscription','payment')
      OR COALESCE(p_checkout->>'payment_status','') NOT IN ('paid','unpaid','no_payment_required')
      OR COALESCE(p_checkout->>'currency','') !~ '^[a-z]{3}$'
      OR jsonb_typeof(p_checkout->'amount_total') IS DISTINCT FROM 'number'
      OR jsonb_typeof(p_checkout->'created') IS DISTINCT FROM 'number'
      OR (p_checkout->>'created')::numeric < 0
      OR (p_checkout->>'created')::numeric <> trunc((p_checkout->>'created')::numeric)
      OR (p_checkout->>'amount_total')::numeric < 0
      OR (p_checkout->>'amount_total')::numeric > 999999999999
      OR (p_checkout->>'amount_total')::numeric <> trunc((p_checkout->>'amount_total')::numeric)
      OR length(p_checkout->>'referral_code') > 40 THEN
      RAISE EXCEPTION 'Invalid checkout' USING ERRCODE = '22023';
    END IF;
    IF p_event_type='checkout.session.async_payment_succeeded' AND p_checkout->>'payment_status' <> 'paid' THEN
      RAISE EXCEPTION 'Payment is not confirmed' USING ERRCODE = '22023';
    END IF;
    IF p_checkout->>'payment_status'='unpaid' THEN
      v_status := 'deferred';
    ELSE
      -- Fail closed for old untracked checkouts, including differently named events
      -- referring to a session created before the installation of this migration.
      SELECT activated_at INTO STRICT v_cutover FROM vida_aide.stripe_fulfillment_settings WHERE singleton;
      IF p_event_created < ceil(extract(epoch FROM v_cutover))
        OR (p_checkout->>'created')::numeric < ceil(extract(epoch FROM v_cutover)) THEN
        RAISE EXCEPTION 'Pre-cutover checkout requires reconciliation' USING ERRCODE = 'P0001';
      END IF;
      IF p_checkout->>'payment_status'='no_payment_required' AND (p_checkout->>'amount_total')::numeric <> 0 THEN
        RAISE EXCEPTION 'Unconfirmed positive payment' USING ERRCODE = '22023';
      END IF;
      v_customer := p_checkout->>'customer_id';
      v_profile := v_target.id;
      IF v_target.stripe_customer_id IS NOT NULL AND v_target.stripe_customer_id<>v_customer THEN
        RAISE EXCEPTION 'Customer binding conflict' USING ERRCODE='22023';
      END IF;
      UPDATE vida_aide.profiles SET stripe_customer_id=v_customer WHERE id=v_profile;
    END IF;
  ELSE
    IF p_checkout IS NOT NULL THEN RAISE EXCEPTION 'Unexpected checkout' USING ERRCODE = '22023'; END IF;
  END IF;

  IF v_status <> 'deferred' THEN
    IF p_subscription IS NOT NULL THEN
      IF jsonb_typeof(p_subscription) IS DISTINCT FROM 'object'
        OR COALESCE(length(p_subscription->>'id'),0) NOT BETWEEN 1 AND 255
        OR COALESCE(length(p_subscription->>'customer_id'),0) NOT BETWEEN 1 AND 255
        OR COALESCE(p_subscription->>'status','') NOT IN (
          'active','trialing','canceled','incomplete','incomplete_expired','past_due','unpaid','paused')
        OR COALESCE(p_subscription->>'interval','') NOT IN ('monthly','yearly') THEN
        RAISE EXCEPTION 'Invalid subscription' USING ERRCODE = '22023';
      END IF;
      IF v_checkout AND ((p_checkout->>'subscription_id') IS DISTINCT FROM (p_subscription->>'id')
        OR v_customer IS DISTINCT FROM (p_subscription->>'customer_id') OR p_checkout->>'mode'<>'subscription') THEN
        RAISE EXCEPTION 'Subscription identity conflict' USING ERRCODE = '22023';
      END IF;
      IF NOT v_checkout THEN
        IF (p_subscription->>'id') IS DISTINCT FROM p_object_id THEN
          RAISE EXCEPTION 'Subscription object conflict' USING ERRCODE = '22023';
        END IF;
        v_profile := v_target.id;
        IF v_target.stripe_customer_id IS NOT NULL
          AND v_target.stripe_customer_id<>p_subscription->>'customer_id' THEN
          RAISE EXCEPTION 'Customer binding conflict' USING ERRCODE='22023';
        END IF;
        IF v_target.stripe_subscription_id IS NOT NULL AND v_target.stripe_subscription_id<>p_subscription->>'id' THEN
          v_status := 'ignored'; -- A superseded subscription cannot revoke the current one.
        END IF;
      ELSIF v_target.stripe_subscription_id IS NOT NULL AND v_target.stripe_subscription_id<>p_subscription->>'id' THEN
        IF (p_subscription->>'previous_id') IS DISTINCT FROM v_target.stripe_subscription_id
          OR COALESCE(p_subscription->>'previous_status','') NOT IN ('canceled','incomplete_expired') THEN
          RAISE EXCEPTION 'Existing subscription requires reconciliation' USING ERRCODE='22023';
        END IF;
      END IF;
      IF v_status='applied' THEN UPDATE vida_aide.profiles SET
        stripe_customer_id=p_subscription->>'customer_id',
        subscription_plan=CASE WHEN p_subscription->>'status' IN ('active','trialing') THEN 'premium' ELSE 'free' END,
        stripe_subscription_id=p_subscription->>'id', subscription_interval=p_subscription->>'interval',
        trial_ends_at=(p_subscription->>'trial_ends_at')::timestamptz
        WHERE id=v_profile;
      END IF;
      -- A subscription state or its list price is not a payment receipt.
    ELSIF NOT v_checkout OR p_checkout->>'mode'='subscription' THEN
      RAISE EXCEPTION 'Missing subscription' USING ERRCODE = '22023';
    END IF;

    IF v_checkout AND p_checkout->>'payment_status'='paid' AND (p_checkout->>'amount_total')::numeric>0 THEN
      v_amount := (p_checkout->>'amount_total')::numeric / 100;
      INSERT INTO vida_aide.payments(user_id,stripe_payment_id,stripe_checkout_id,amount,currency,type,status,metadata)
        VALUES(v_profile,COALESCE(p_checkout->>'payment_id',p_object_id),p_object_id,v_amount,p_checkout->>'currency',
          CASE WHEN p_checkout->>'mode'='subscription' THEN 'subscription' ELSE 'one_shot' END,'succeeded',
          jsonb_build_object('stripe_event_id',p_event_id,'payment_status','paid'))
        ON CONFLICT (stripe_checkout_id) WHERE stripe_checkout_id IS NOT NULL DO NOTHING
        RETURNING id INTO v_payment;
      IF v_payment IS NULL THEN
        SELECT * INTO STRICT v_existing_payment FROM vida_aide.payments WHERE stripe_checkout_id=p_object_id;
        IF v_existing_payment.user_id<>v_profile OR v_existing_payment.amount<>v_amount
          OR v_existing_payment.currency<>p_checkout->>'currency' OR v_existing_payment.status<>'succeeded' THEN
          RAISE EXCEPTION 'Payment receipt conflict' USING ERRCODE='22023';
        END IF;
        v_payment := v_existing_payment.id;
      END IF;

      IF COALESCE(p_checkout->>'referral_code','')<>'' THEN
        SELECT id INTO v_referrer FROM vida_aide.profiles WHERE referral_code=p_checkout->>'referral_code';
        IF v_referrer IS NOT NULL THEN
          IF p_checkout->>'currency'<>'eur' THEN
            RAISE EXCEPTION 'Wallet currency mismatch' USING ERRCODE='22023';
          END IF;
          -- Existing rule: 50% of the paid checkout, rounded to the wallet's cents.
          v_commission := round(v_amount * 0.5, 2);
          INSERT INTO vida_aide.wallet_transactions(user_id,amount,type,description,stripe_checkout_id,metadata)
            VALUES(v_referrer,v_commission,'referral','Commission parrainage 50% ('||(p_checkout->>'referral_code')||')',
              p_object_id,jsonb_build_object('stripe_event_id',p_event_id,'payment_id',v_payment))
            ON CONFLICT (stripe_checkout_id) WHERE stripe_checkout_id IS NOT NULL DO NOTHING
            RETURNING id INTO v_wallet;
          IF v_wallet IS NOT NULL THEN
            UPDATE vida_aide.profiles SET wallet_balance=wallet_balance+v_commission WHERE id=v_referrer;
            IF NOT FOUND THEN RAISE EXCEPTION 'Referrer disappeared'; END IF;
            INSERT INTO vida_aide.notifications(user_id,type,title,body,icon,action_url)
              VALUES(v_referrer,'referral','Commission parrainage créditée',
                'Commission de '||v_commission::text||' € créditée au portefeuille.','💰','/dashboard/wallet');
          ELSE
            SELECT * INTO STRICT v_existing_wallet FROM vida_aide.wallet_transactions WHERE stripe_checkout_id=p_object_id;
            IF v_existing_wallet.user_id<>v_referrer OR v_existing_wallet.amount<>v_commission
              OR v_existing_wallet.type<>'referral' OR v_existing_wallet.status<>'completed' THEN
              RAISE EXCEPTION 'Wallet receipt conflict' USING ERRCODE='22023';
            END IF;
            v_wallet := v_existing_wallet.id;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_status='applied' THEN
    UPDATE vida_aide.profiles SET stripe_state_revision=stripe_state_revision+1 WHERE id=v_profile;
  END IF;

  v_receipt := jsonb_build_object('version',1,'event_id',p_event_id,'event_type',p_event_type,
    'object_id',p_object_id,'payload_hash',p_payload_hash,'status',v_status,'duplicate',false,
    'profile_id',v_profile,'payment_id',v_payment,'wallet_transaction_id',v_wallet);
  UPDATE vida_aide.stripe_events SET receipt=v_receipt, processed_at=clock_timestamp() WHERE event_id=p_event_id;
  RETURN v_receipt;
END;
$$;
REVOKE ALL ON FUNCTION vida_aide.apply_stripe_fulfillment(text,text,text,text,bigint,uuid,bigint,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION vida_aide.apply_stripe_fulfillment(text,text,text,text,bigint,uuid,bigint,jsonb,jsonb) TO service_role;
COMMIT;
