CREATE FUNCTION stripe_test.call_event(
  eid text,sid text,checkout_patch jsonb DEFAULT '{}',subscription_patch jsonb DEFAULT '{}',
  event_type text DEFAULT 'checkout.session.completed',chosen_revision bigint DEFAULT NULL,
  event_time bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE args jsonb; chosen_time bigint; rev bigint; checkout jsonb; sub jsonb; BEGIN
  SELECT f.args INTO STRICT args FROM stripe_test.fixture f;
  SELECT ceil(extract(epoch FROM activated_at))::bigint+1 INTO STRICT chosen_time
    FROM vida_aide.stripe_fulfillment_settings WHERE singleton;
  SELECT stripe_state_revision INTO STRICT rev FROM vida_aide.profiles
    WHERE id=(args->>'p_profile_id')::uuid;
  checkout := args->'p_checkout'||jsonb_build_object('id',sid,'created',chosen_time)||checkout_patch;
  sub := args->'p_subscription'||subscription_patch;
  IF event_type LIKE 'customer.subscription.%' THEN
    checkout:=NULL;
    sub:=sub||jsonb_build_object('id',sid);
  ELSIF checkout->>'payment_status'='unpaid' OR checkout->>'mode'='payment' THEN
    sub:=NULL;
  END IF;
  RETURN vida_aide.apply_stripe_fulfillment(eid,event_type,sid,md5(eid)||md5(sid),
    COALESCE(event_time,chosen_time),(args->>'p_profile_id')::uuid,COALESCE(chosen_revision,rev),checkout,sub);
END; $$;
CREATE FUNCTION stripe_test.balance() RETURNS numeric LANGUAGE sql AS $$
  SELECT wallet_balance FROM vida_aide.profiles WHERE referral_code='REFTEST';
$$;
CREATE FUNCTION stripe_test.fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('stripe_test.fail_notification',true)='yes' THEN
    RAISE EXCEPTION 'Synthetic notification failure' USING ERRCODE='22000';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER stripe_test_notification BEFORE INSERT ON vida_aide.notifications
FOR EACH ROW EXECUTE FUNCTION stripe_test.fail_notification();
CREATE TABLE stripe_test.cutover AS SELECT activated_at FROM vida_aide.stripe_fulfillment_settings;
GRANT USAGE ON SCHEMA stripe_test TO authenticated,anon,service_role;
GRANT SELECT ON stripe_test.fixture TO authenticated,anon,service_role;
