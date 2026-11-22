INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-4111-8111-111111111111', 'owner@example.test', '{"full_name":"Owner fixture"}'),
  ('22222222-2222-4222-8222-222222222222', 'other@example.test', '{"full_name":"Other fixture"}'),
  ('33333333-3333-4333-8333-333333333333', 'missing-profile@example.test', '{}'),
  ('44444444-4444-4444-8444-444444444444', 'admin-fixture@example.test', '{}');
-- Simulate a missing profile without changing the signup mechanism under test.
DELETE FROM vida_aide.profiles
  WHERE auth_user_id = '33333333-3333-4333-8333-333333333333';
UPDATE vida_aide.profiles SET wallet_balance = 17.25, total_money_recovered = 987.65,
  purama_points = 31, xp = 21, metadata = '{"historical":"keep"}'
  WHERE auth_user_id = '11111111-1111-4111-8111-111111111111';
UPDATE vida_aide.profiles SET role = 'super_admin', subscription_plan = 'premium'
  WHERE auth_user_id = '44444444-4444-4444-8444-444444444444';
CREATE TABLE profile_test.snapshot AS
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) AS rows FROM vida_aide.profiles p;
CREATE TABLE profile_test.service_privileges AS
  SELECT privilege, has_table_privilege('service_role', 'vida_aide.profiles', privilege) AS allowed
  FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS privilege;
CREATE TABLE profile_test.trigger_snapshot AS
  SELECT pg_get_functiondef('vida_aide.handle_new_user()'::regprocedure) AS definition;
-- Explicit column and PUBLIC grants are removed too, not just the schema's
-- historical authenticated table grant. All grants exist only in this fixture.
GRANT UPDATE (role), INSERT (wallet_balance), REFERENCES (id)
  ON vida_aide.profiles TO PUBLIC, anon, authenticated;
