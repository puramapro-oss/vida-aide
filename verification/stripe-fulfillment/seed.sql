CREATE SCHEMA stripe_test;
CREATE FUNCTION stripe_test.check_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERTION: %',label; END IF; END; $$;
INSERT INTO auth.users(id,email) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','payer@example.invalid'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','referrer@example.invalid');
UPDATE vida_aide.profiles SET id='10000000-0000-4000-8000-000000000001',total_money_recovered=1234.56
WHERE auth_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
UPDATE vida_aide.profiles SET referral_code='REFTEST',wallet_balance=10,total_money_recovered=789.01
WHERE auth_user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
INSERT INTO vida_aide.stripe_events(event_id,type) VALUES('evt_legacy','checkout.session.completed');
INSERT INTO vida_aide.payments(user_id,stripe_payment_id,amount,type,status,metadata)
VALUES('10000000-0000-4000-8000-000000000001','sub_historical',17,'subscription','succeeded','{"legacy":"preserve"}');
CREATE TABLE stripe_test.historical_payments AS SELECT to_jsonb(p) AS row FROM vida_aide.payments p;
CREATE TABLE stripe_test.fixture(args jsonb NOT NULL);
