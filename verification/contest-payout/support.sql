CREATE FUNCTION contest_test.new_contest(identifier uuid,pool integer DEFAULT 10003,ending timestamptz DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO vida_aide.contests(id,title,type,total_pool_cents,start_date,end_date,status)
  VALUES(identifier,'Synthetic weekly contest','weekly',pool,now()-interval '8 days',
    COALESCE(ending,(SELECT (payload->'args'->>'p_expected_end')::timestamptz FROM contest_test.fixture)),'live');
$$;
CREATE FUNCTION contest_test.awards(pool integer DEFAULT 10003,amount integer DEFAULT 10)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(value||jsonb_build_object('amount_cents',
    floor(pool::numeric*(ARRAY[330,170,120,80,70,50,45,45,45,45])[ordinality]/1000)) ORDER BY ordinality),'[]'::jsonb)
  FROM contest_test.fixture,jsonb_array_elements(payload->'args'->'p_winners') WITH ORDINALITY
  WHERE ordinality<=amount;
$$;
CREATE FUNCTION contest_test.settle(identifier uuid,winners jsonb DEFAULT NULL,pool integer DEFAULT NULL,ending timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c vida_aide.contests%ROWTYPE; BEGIN
  SELECT * INTO STRICT c FROM vida_aide.contests WHERE id=identifier;
  RETURN vida_aide.settle_weekly_contest_v1(identifier,COALESCE(pool,c.total_pool_cents),COALESCE(ending,c.end_date),
    COALESCE(winners,(SELECT payload->'args'->'p_winners' FROM contest_test.fixture)));
END; $$;
CREATE FUNCTION contest_test.reject(identifier uuid,winners jsonb,expected_state text DEFAULT '22023',pool integer DEFAULT NULL,ending timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean:=false; BEGIN
  BEGIN PERFORM contest_test.settle(identifier,winners,pool,ending);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE<>expected_state THEN RAISE; END IF;
    rejected:=true;
  END;
  PERFORM contest_test.check_true(rejected,'Invalid request was accepted');
  PERFORM contest_test.check_true((SELECT payout_receipt IS NULL FROM vida_aide.contests WHERE id=identifier),'Failed request wrote a receipt');
END; $$;
CREATE FUNCTION contest_test.fail_closure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('contest_test.fail_closure',true)='yes' AND NEW.payout_receipt IS NOT NULL THEN
    RAISE EXCEPTION 'Synthetic final contest write failure' USING ERRCODE='22000';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER contest_test_closure BEFORE UPDATE ON vida_aide.contests
FOR EACH ROW EXECUTE FUNCTION contest_test.fail_closure();
CREATE FUNCTION contest_test.fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('contest_test.fail_notification',true)='yes' AND NEW.title LIKE '🏆 Top 10 %' THEN
    RAISE EXCEPTION 'Synthetic last notification failure' USING ERRCODE='22000';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER contest_test_notification BEFORE INSERT ON vida_aide.notifications
FOR EACH ROW EXECUTE FUNCTION contest_test.fail_notification();
SELECT contest_test.new_contest((payload->'args'->>'p_contest_id')::uuid,
  (payload->'args'->>'p_expected_pool')::integer,(payload->'args'->>'p_expected_end')::timestamptz)
FROM contest_test.fixture;
CREATE TABLE contest_test.marker AS SELECT id,payout_tracking_started_at FROM vida_aide.contests;
GRANT SELECT ON contest_test.marker TO service_role;
