CREATE SCHEMA scan_test;
CREATE TABLE scan_test.fixture(args jsonb NOT NULL);
CREATE FUNCTION scan_test.check_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION: %', label; END IF; END; $$;
INSERT INTO auth.users(id,email) VALUES
 ('10000000-0000-4000-8000-000000000001','scan-owner@example.invalid'),
 ('40000000-0000-4000-8000-000000000004','scan-other@example.invalid'),
 ('50000000-0000-4000-8000-000000000005','scan-premium@example.invalid'),
 ('60000000-0000-4000-8000-000000000006','scan-admin@example.invalid');
UPDATE vida_aide.profiles SET id='20000000-0000-4000-8000-000000000002',
  total_money_recovered=9734.56,wallet_balance=25.5,purama_points=30,xp=450
  WHERE auth_user_id='10000000-0000-4000-8000-000000000001';
UPDATE vida_aide.profiles SET id='20000000-0000-4000-8000-000000000004',xp=0
  WHERE auth_user_id='40000000-0000-4000-8000-000000000004';
UPDATE vida_aide.profiles SET subscription_plan='premium'
  WHERE auth_user_id='50000000-0000-4000-8000-000000000005';
UPDATE vida_aide.profiles SET role='super_admin'
  WHERE auth_user_id='60000000-0000-4000-8000-000000000006';
INSERT INTO vida_aide.scans(id,user_id,type,input_data,results,total_recoverable,total_recoverable_monthly,status,created_at)
VALUES ('70000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','financial','{}','[]',987.65,23.45,'completed',now()-interval '3 days'),
 ('70000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','financial','{}','[]',0,0,'processing',now()-interval '3 days');
CREATE TABLE scan_test.old_scans AS SELECT id,to_jsonb(s) AS original FROM vida_aide.scans s;
CREATE TABLE scan_test.old_money AS SELECT id,total_money_recovered,wallet_balance,purama_points FROM vida_aide.profiles;
GRANT UPDATE(status), INSERT(user_id), REFERENCES(id) ON vida_aide.scans TO PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA scan_test TO service_role,authenticated,anon;
GRANT SELECT ON ALL TABLES IN SCHEMA scan_test TO service_role,authenticated,anon;

