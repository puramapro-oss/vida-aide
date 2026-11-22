-- CASE: rls_environment
BEGIN;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SET LOCAL ROLE authenticated;
SELECT profile_test.check_true(current_user = 'authenticated', 'actual client role');
SELECT profile_test.check_true(NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), 'client has no bypass');
SELECT profile_test.check_true(row_security_active('vida_aide.profiles'), 'profile RLS must be active');
SELECT profile_test.check_true('vida_aide.profiles'::regclass::oid >= 16384, 'ordinary user table OID');
SELECT profile_test.check_true((SELECT count(*) = 1 FROM vida_aide.profiles), 'only own profile is visible');
ROLLBACK;

-- CASE: reject_privileged_update
BEGIN;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE field text; rejected integer := 0; BEGIN
  BEGIN
    UPDATE vida_aide.profiles SET role = 'super_admin', wallet_balance = 9000,
      total_money_recovered = 9000, subscription_plan = 'premium'
      WHERE auth_user_id = auth.uid();
    RAISE EXCEPTION 'ASSERTION: privileged update accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  FOR field IN SELECT attname FROM pg_attribute
    WHERE attrelid = 'vida_aide.profiles'::regclass AND attnum > 0 AND NOT attisdropped
      AND attname NOT IN ('onboarded','tutorial_completed')
  LOOP
    BEGIN
      EXECUTE format('UPDATE vida_aide.profiles SET %1$I = %1$I WHERE auth_user_id = auth.uid()', field);
      RAISE EXCEPTION 'ASSERTION: protected column accepted: %', field;
    EXCEPTION WHEN insufficient_privilege THEN rejected := rejected + 1; END;
  END LOOP;
  PERFORM profile_test.check_true(rejected >= 20, 'all technical and API-owned fields tested');
  RAISE NOTICE 'PROFILE_PROTECTED_COLUMNS_REJECTED %', rejected;
  BEGIN
    UPDATE vida_aide.profiles SET onboarded = true, wallet_balance = 1 WHERE auth_user_id = auth.uid();
    RAISE EXCEPTION 'ASSERTION: mixed allowed and protected patch accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM profile_test.check_true((SELECT NOT onboarded AND wallet_balance = 17.25 FROM vida_aide.profiles WHERE auth_user_id = auth.uid()), 'rejected patch has no partial effect');
END; $$;
ROLLBACK;

-- CASE: reject_client_insert
BEGIN;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    INSERT INTO vida_aide.profiles (auth_user_id,email,role,subscription_plan,wallet_balance)
      VALUES (auth.uid(),'forged@example.test','super_admin','premium',9000);
    RAISE EXCEPTION 'ASSERTION: forged profile insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO vida_aide.profiles (auth_user_id,email) VALUES (auth.uid(),'minimal@example.test');
    RAISE EXCEPTION 'ASSERTION: direct profile insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO vida_aide.profiles (auth_user_id,email,wallet_balance)
      VALUES (auth.uid(),'upsert@example.test',9000)
      ON CONFLICT (auth_user_id) DO UPDATE SET wallet_balance = 9000;
    RAISE EXCEPTION 'ASSERTION: direct profile upsert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
ROLLBACK;

-- CASE: own_and_foreign_onboarding
BEGIN;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE changed integer; BEGIN
  UPDATE vida_aide.profiles SET onboarded = true, tutorial_completed = true WHERE auth_user_id = auth.uid();
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM profile_test.check_true(changed = 1, 'existing onboarding update succeeds once');
  PERFORM profile_test.check_true((SELECT onboarded AND tutorial_completed AND wallet_balance = 17.25 AND total_money_recovered = 987.65 FROM vida_aide.profiles WHERE auth_user_id = auth.uid()), 'onboarding preserves money and history');
  UPDATE vida_aide.profiles SET onboarded = true, tutorial_completed = true
    WHERE auth_user_id = '22222222-2222-4222-8222-222222222222';
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM profile_test.check_true(changed = 0, 'foreign profile cannot be changed');
END; $$;
ROLLBACK;

-- CASE: anonymous_cannot_mutate
BEGIN;
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE anon;
SELECT profile_test.check_true(row_security_active('vida_aide.profiles'), 'anonymous RLS active');
SELECT profile_test.check_true((SELECT count(*) = 0 FROM vida_aide.profiles), 'anonymous profile read remains empty');
DO $$ BEGIN
  BEGIN
    UPDATE vida_aide.profiles SET onboarded = true;
    RAISE EXCEPTION 'ASSERTION: anonymous update accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO vida_aide.profiles (auth_user_id,email) VALUES ('33333333-3333-4333-8333-333333333333','anonymous@example.test');
    RAISE EXCEPTION 'ASSERTION: anonymous insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
ROLLBACK;

-- CASE: effective_client_acl
BEGIN;
DO $$ DECLARE client text; field text; operation text; expected boolean; BEGIN
  FOREACH client IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH operation IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      PERFORM profile_test.check_true(NOT has_table_privilege(client,'vida_aide.profiles',operation), 'no full-table mutation');
    END LOOP;
    FOR field IN SELECT attname FROM pg_attribute WHERE attrelid = 'vida_aide.profiles'::regclass AND attnum > 0 AND NOT attisdropped LOOP
      expected := client = 'authenticated' AND field IN ('onboarded','tutorial_completed');
      PERFORM profile_test.check_true(has_column_privilege(client,'vida_aide.profiles',field,'UPDATE') = expected, 'exact update allowlist');
      PERFORM profile_test.check_true(NOT has_column_privilege(client,'vida_aide.profiles',field,'INSERT,REFERENCES'), 'no column insert/reference escape');
    END LOOP;
    PERFORM profile_test.check_true(has_table_privilege(client,'vida_aide.profiles','SELECT'), 'read grant preserved');
  END LOOP;
  PERFORM profile_test.check_true(NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname = 'vida_aide' AND tablename = 'profiles' AND policyname = 'profiles_insert_own'), 'legacy client insert policy removed');
END; $$;
ROLLBACK;

-- CASE: service_role_preserved
BEGIN;
SET LOCAL ROLE service_role;
DO $$ DECLARE changed integer; BEGIN
  UPDATE vida_aide.profiles SET role = 'user', subscription_plan = 'premium',
    wallet_balance = 18.25, purama_points = 42, xp = 22, total_money_recovered = 987.65,
    full_name = 'Server personal update', phone = 'synthetic', birth_date = '2000-01-01',
    address = '{"city":"Fixture"}', situation = '{"age":26}', language = 'fr', theme = 'light',
    iban = 'synthetic', onboarded = true, tutorial_completed = true
    WHERE auth_user_id = '11111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM profile_test.check_true(changed = 1, 'server financial and personal update preserved');
  INSERT INTO vida_aide.profiles (auth_user_id,email,role,wallet_balance)
    VALUES ('33333333-3333-4333-8333-333333333333','service@example.test','user',4);
  DELETE FROM vida_aide.profiles WHERE auth_user_id = '33333333-3333-4333-8333-333333333333';
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM profile_test.check_true(changed = 1, 'server insert and delete privileges preserved');
END; $$;
ROLLBACK;

-- CASE: signup_trigger_preserved
BEGIN;
INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES
  ('55555555-5555-4555-8555-555555555555','new-account@example.test',
   '{"full_name":"New fixture","role":"super_admin","subscription_plan":"premium","wallet_balance":9000}');
SELECT profile_test.check_true((SELECT count(*) = 1 FROM vida_aide.profiles
  WHERE auth_user_id = '55555555-5555-4555-8555-555555555555'
    AND role = 'user' AND subscription_plan = 'free' AND wallet_balance = 0
    AND full_name = 'New fixture'), 'signup trigger creates ordinary profile and ignores forged metadata');
SELECT profile_test.check_true(pg_get_functiondef('vida_aide.handle_new_user()'::regprocedure) =
  (SELECT definition FROM profile_test.trigger_snapshot), 'signup function is unchanged');
ROLLBACK;

-- CASE: historical_rows_and_server_grants_preserved
BEGIN;
SELECT profile_test.check_true((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM vida_aide.profiles p) =
  (SELECT rows FROM profile_test.snapshot), 'every historical profile value preserved');
SELECT profile_test.check_true((SELECT bool_and(has_table_privilege('service_role','vida_aide.profiles',privilege) = allowed)
  FROM profile_test.service_privileges), 'all original service_role grants preserved');
ROLLBACK;

-- CASE: privileged_reader_keeps_no_direct_money_write
BEGIN;
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
SET LOCAL ROLE authenticated;
SELECT profile_test.check_true((SELECT count(*) = 3 FROM vida_aide.profiles), 'existing super-admin read policy preserved');
DO $$ BEGIN
  BEGIN
    UPDATE vida_aide.profiles SET wallet_balance = 9000 WHERE auth_user_id = auth.uid();
    RAISE EXCEPTION 'ASSERTION: privileged browser money update accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
ROLLBACK;

-- CASE: future_column_closed_by_default
BEGIN;
ALTER TABLE vida_aide.profiles ADD COLUMN fixture_future_entitlement integer DEFAULT 0;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    UPDATE vida_aide.profiles SET fixture_future_entitlement = 999 WHERE auth_user_id = auth.uid();
    RAISE EXCEPTION 'ASSERTION: future technical column writable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
ROLLBACK;
