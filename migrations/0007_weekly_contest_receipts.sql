-- The weekly contest keeps its existing ranking/distribution. Only the
-- completion boundary changes: prizes, balances, notifications and closure
-- must commit together. Existing contests and awards are not rewritten.
BEGIN;
ALTER TABLE vida_aide.contests ADD COLUMN IF NOT EXISTS payout_receipt jsonb;

CREATE OR REPLACE FUNCTION vida_aide.settle_weekly_contest_v1(
  p_contest_id uuid, p_expected_pool integer, p_expected_end timestamptz,
  p_winners jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, vida_aide
AS $$
DECLARE
  v_contest vida_aide.contests%ROWTYPE;
  v_item jsonb;
  v_rank bigint;
  v_count integer;
  v_locked integer;
  v_amount integer;
  v_total integer := 0;
  v_ratios integer[] := ARRAY[330,170,120,80,70,50,45,45,45,45];
  v_receipt jsonb;
BEGIN
  IF p_contest_id IS NULL OR p_expected_pool IS NULL OR p_expected_pool<0
    OR p_expected_end IS NULL OR jsonb_typeof(p_winners) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid contest settlement' USING ERRCODE='22023';
  END IF;
  SELECT * INTO STRICT v_contest FROM vida_aide.contests WHERE id=p_contest_id FOR UPDATE;
  IF v_contest.payout_receipt IS NOT NULL THEN
    RETURN v_contest.payout_receipt || jsonb_build_object('duplicate',true);
  END IF;
  IF v_contest.type<>'weekly' OR v_contest.status<>'live' OR v_contest.end_date>clock_timestamp()
    OR v_contest.total_pool_cents<>p_expected_pool OR v_contest.end_date<>p_expected_end THEN
    RAISE EXCEPTION 'Contest state requires reconciliation' USING ERRCODE='22023';
  END IF;
  -- The old handler could leave a prize row without its balance/closure, or the
  -- reverse after an ignored error. Never replay that ambiguous partial history.
  IF EXISTS(SELECT 1 FROM vida_aide.wallet_transactions
      WHERE source_id=p_contest_id AND type='contest_prize') THEN
    RAISE EXCEPTION 'Legacy contest awards require reconciliation' USING ERRCODE='P0001';
  END IF;
  v_count:=jsonb_array_length(p_winners);
  IF v_count>10 THEN RAISE EXCEPTION 'Too many contest winners' USING ERRCODE='22023'; END IF;
  FOR v_item,v_rank IN SELECT value,ordinality FROM jsonb_array_elements(p_winners) WITH ORDINALITY LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
      OR jsonb_typeof(v_item->'rank') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_item->'score') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_item->'amount_cents') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_item->'user_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_item->'name') NOT IN ('string','null')
      OR NOT (v_item ? 'name') THEN
      RAISE EXCEPTION 'Invalid contest winner' USING ERRCODE='22023';
    END IF;
    IF (v_item->>'rank')::numeric<>v_rank
      OR (v_item->>'score')::numeric<=0
      OR (v_item->>'score')::numeric<>trunc((v_item->>'score')::numeric)
      OR (v_item->>'amount_cents')::numeric<>floor(p_expected_pool::numeric*v_ratios[v_rank]/1000) THEN
      RAISE EXCEPTION 'Invalid contest allocation' USING ERRCODE='22023';
    END IF;
    PERFORM (v_item->>'user_id')::uuid;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'user_id') FROM jsonb_array_elements(p_winners))<>v_count THEN
    RAISE EXCEPTION 'Repeated contest winner' USING ERRCODE='22023';
  END IF;
  -- Stable row-lock order; all additions use the committed current balance.
  PERFORM id FROM vida_aide.profiles WHERE id IN
    (SELECT (value->>'user_id')::uuid FROM jsonb_array_elements(p_winners)) ORDER BY id FOR UPDATE;
  GET DIAGNOSTICS v_locked=ROW_COUNT;
  IF v_locked<>v_count THEN RAISE EXCEPTION 'Missing contest beneficiary' USING ERRCODE='22023'; END IF;

  FOR v_item,v_rank IN SELECT value,ordinality FROM jsonb_array_elements(p_winners) WITH ORDINALITY LOOP
    v_amount:=(v_item->>'amount_cents')::integer;
    v_total:=v_total+v_amount;
    IF v_amount>0 THEN
      INSERT INTO vida_aide.wallet_transactions(user_id,amount,type,description,status,source_id,metadata)
        VALUES((v_item->>'user_id')::uuid,v_amount::numeric/100,'contest_prize',
          'Concours hebdo : '||v_contest.title||' — rang '||v_rank,'completed',p_contest_id,
          jsonb_build_object('contest_id',p_contest_id,'rank',v_rank,'score',v_item->'score','payout_version',1));
      UPDATE vida_aide.profiles SET wallet_balance=wallet_balance+v_amount::numeric/100
        WHERE id=(v_item->>'user_id')::uuid;
    END IF;
    INSERT INTO vida_aide.notifications(user_id,type,title,body,action_url,icon)
      VALUES((v_item->>'user_id')::uuid,'contest_won','🏆 Top '||v_rank||' du concours hebdo !',
        CASE WHEN v_amount>0 THEN 'Prix de '||(v_amount::numeric/100)::text||' € crédité au portefeuille pour '||v_contest.title||'.'
          ELSE 'Tu termines au top '||v_rank||' sur '||v_contest.title||'.' END,
        '/dashboard/wallet','🏆');
  END LOOP;
  IF v_total>p_expected_pool THEN RAISE EXCEPTION 'Contest pool exceeded' USING ERRCODE='22023'; END IF;
  v_receipt:=jsonb_build_object('version',1,'contest_id',p_contest_id,'duplicate',false,
    'winners_count',v_count,'total_paid_cents',v_total,'awards',p_winners);
  UPDATE vida_aide.contests SET status='completed',winners=p_winners,payout_receipt=v_receipt WHERE id=p_contest_id;
  RETURN v_receipt;
END;
$$;
REVOKE ALL ON FUNCTION vida_aide.settle_weekly_contest_v1(uuid,integer,timestamptz,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION vida_aide.settle_weekly_contest_v1(uuid,integer,timestamptz,jsonb) TO service_role;
DO $$ BEGIN
  IF has_function_privilege('authenticated','vida_aide.settle_weekly_contest_v1(uuid,integer,timestamptz,jsonb)','EXECUTE')
    OR has_function_privilege('anon','vida_aide.settle_weekly_contest_v1(uuid,integer,timestamptz,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected inherited contest settlement privileges';
  END IF;
END; $$;
COMMIT;
