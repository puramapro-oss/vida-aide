-- Synthetic rows in a fresh database, before any new payout marker exists.
CREATE SCHEMA contest_test;
CREATE FUNCTION contest_test.uuid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
CREATE FUNCTION contest_test.check_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION: %',label USING ERRCODE='P0004'; END IF; END; $$;
INSERT INTO auth.users(id,email)
SELECT contest_test.uuid(100+n),'fixture-'||n||'@example.invalid' FROM generate_series(1,10) n;
UPDATE vida_aide.profiles p SET id=contest_test.uuid(n),wallet_balance=25.50,
  total_money_recovered=9734.56,purama_points=30,xp=101
FROM generate_series(1,10) n WHERE p.auth_user_id=contest_test.uuid(100+n);
INSERT INTO vida_aide.contests(id,title,type,total_pool_cents,start_date,end_date,status)
SELECT contest_test.uuid(n),'Legacy contest '||n,'weekly',10003,now()-interval '8 days',now()-interval '1 day','live'
FROM generate_series(800,801) n;
INSERT INTO vida_aide.wallet_transactions(user_id,amount,type,description,status,source_id,metadata)
VALUES(contest_test.uuid(1),7.25,'contest_prize','Historical ambiguous row','completed',contest_test.uuid(801),'{"historical":"preserve"}');
INSERT INTO vida_aide.notifications(user_id,type,title,body)
VALUES(contest_test.uuid(2),'historical_fixture','Historical notification','Preserve the original notification');
CREATE TABLE contest_test.historical_contests AS SELECT id,to_jsonb(c) AS row FROM vida_aide.contests c;
CREATE TABLE contest_test.historical_wallet AS SELECT id,to_jsonb(w) AS row FROM vida_aide.wallet_transactions w;
CREATE TABLE contest_test.historical_notifications AS SELECT id,to_jsonb(n) AS row FROM vida_aide.notifications n;
CREATE TABLE contest_test.historical_profiles AS SELECT id,to_jsonb(p) AS row FROM vida_aide.profiles p;
CREATE TABLE contest_test.fixture(payload jsonb NOT NULL);
GRANT USAGE ON SCHEMA contest_test TO anon,authenticated,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA contest_test TO service_role;
