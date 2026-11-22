-- CASE: real_handler_reservation_and_receipt
BEGIN;
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; f jsonb; BEGIN
 r:=scan_test.reserve('30000000-0000-4000-8000-000000000003');
 PERFORM scan_test.check_true(r->>'outcome'='reserved' AND r->'scan'->>'status'='processing','reserve before provider');
 PERFORM scan_test.check_true((r->'scan'->>'processing_expires_at')::timestamptz-(r->'scan'->>'created_at')::timestamptz=interval '5 minutes','five minute lease');
 f:=scan_test.finish('30000000-0000-4000-8000-000000000003');
 PERFORM scan_test.check_true(f->>'outcome'='completed' AND (f->>'changed')::boolean,'one completion');
 PERFORM scan_test.check_true(f->'scan'->>'id'=r->'scan'->>'id' AND (f->'scan'->>'total_recoverable')::numeric=1200,'actual handler result on reserved row');
 PERFORM scan_test.check_true((SELECT xp=450 FROM vida_aide.profiles WHERE id='20000000-0000-4000-8000-000000000002'),'higher XP preserved');
 PERFORM scan_test.check_true((scan_test.finish('30000000-0000-4000-8000-000000000003')->>'changed')::boolean=false,'completion replay has no second effect');
END; $$;
ROLLBACK;

-- CASE: final_slot_and_all_attempt_states
BEGIN;
INSERT INTO vida_aide.scans(user_id,type,status,created_at)
 SELECT '20000000-0000-4000-8000-000000000002','financial',CASE WHEN i%2=0 THEN 'failed' ELSE 'processing' END,now()-interval '1 hour' FROM generate_series(1,4) i;
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; BEGIN
 PERFORM scan_test.check_true(scan_test.reserve('80000000-0000-4000-8000-000000000001')->>'outcome'='reserved','last slot admitted');
 r:=scan_test.reserve('80000000-0000-4000-8000-000000000002');
 PERFORM scan_test.check_true(r->>'outcome'='quota_exceeded' AND (r->>'used')::integer=5,'next request refused before provider');
 PERFORM scan_test.check_true((SELECT count(*)=5 FROM vida_aide.scans WHERE created_at>=now()-interval '24 hours'),'no sixth row');
END; $$;
ROLLBACK;

-- CASE: stable_key_and_structural_input
BEGIN;
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; BEGIN
 PERFORM scan_test.reserve('80000000-0000-4000-8000-000000000001');
 r:=scan_test.reserve('80000000-0000-4000-8000-000000000001',p_input=>' {"revenus_mensuels_nets":1500,"emploi":"salarie"}');
 PERFORM scan_test.check_true(r->>'outcome'='in_progress','member order does not create a new intention');
 PERFORM scan_test.check_true(scan_test.reserve('80000000-0000-4000-8000-000000000001',p_input=>'{"revenus_mensuels_nets":0}')->>'outcome'='conflict','changed input rejected');
 PERFORM scan_test.check_true(scan_test.reserve('80000000-0000-4000-8000-000000000001',p_type=>'fiscal')->>'outcome'='conflict','changed type rejected');
 PERFORM scan_test.finish('80000000-0000-4000-8000-000000000001');
 PERFORM scan_test.check_true(scan_test.reserve('80000000-0000-4000-8000-000000000001')->>'outcome'='completed','saved result can replay');
 PERFORM scan_test.check_true((SELECT count(*)=1 FROM vida_aide.scans WHERE created_at>=now()-interval '24 hours'),'one identity one scan');
END; $$;
ROLLBACK;

-- CASE: owner_binding_and_uuid_conflict
BEGIN;
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; BEGIN
 PERFORM scan_test.reserve('80000000-0000-4000-8000-000000000001');
 r:=scan_test.reserve('80000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004');
 PERFORM scan_test.check_true(r->>'outcome'='conflict' AND NOT(r?'scan'),'no cross-owner disclosure');
 PERFORM scan_test.check_true(scan_test.finish('80000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004')->>'outcome'='conflict','wrong owner cannot finalize');
 PERFORM scan_test.check_true(scan_test.reserve('80000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000009')->>'outcome'='profile_missing','auth identity must map to a profile');
 PERFORM scan_test.check_true((SELECT status='processing' FROM vida_aide.scans WHERE id='80000000-0000-4000-8000-000000000001'),'wrong owner cannot alter state');
END; $$;
ROLLBACK;

-- CASE: failed_attempt_remains_counted
BEGIN;
INSERT INTO vida_aide.scans(user_id,type,created_at)
 SELECT '20000000-0000-4000-8000-000000000002','financial',now() FROM generate_series(1,4);
SET LOCAL ROLE service_role;
DO $$ BEGIN
 PERFORM scan_test.reserve('80000000-0000-4000-8000-000000000001');
 PERFORM scan_test.finish('80000000-0000-4000-8000-000000000001',p_failure=>'provider_unavailable');
 PERFORM scan_test.check_true(scan_test.reserve('80000000-0000-4000-8000-000000000001')->>'outcome'='failed','failed identity does not resume provider');
 PERFORM scan_test.check_true(scan_test.reserve('80000000-0000-4000-8000-000000000002')->>'outcome'='quota_exceeded','failure does not refund quota');
END; $$;
ROLLBACK;

-- CASE: expiry_needs_service_passage
BEGIN;
SELECT scan_test.reserve('80000000-0000-4000-8000-000000000001');
UPDATE vida_aide.scans SET processing_expires_at=clock_timestamp()-interval '1 second' WHERE id='80000000-0000-4000-8000-000000000001';
SELECT scan_test.check_true((SELECT status='processing' FROM vida_aide.scans WHERE id='80000000-0000-4000-8000-000000000001'),'SELECT does not clean up');
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; BEGIN
 r:=scan_test.reserve('80000000-0000-4000-8000-000000000001');
 PERFORM scan_test.check_true(r->>'outcome'='failed' AND r->'scan'->>'failure_code'='result_unconfirmed','service passage expires attempt');
 PERFORM scan_test.check_true(scan_test.finish('80000000-0000-4000-8000-000000000001')->>'outcome'='failed','late success cannot overwrite expiration');
END; $$;
ROLLBACK;

-- CASE: late_finalization_has_no_xp_or_result
BEGIN;
SELECT scan_test.reserve('80000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004');
UPDATE vida_aide.scans SET processing_expires_at=clock_timestamp()-interval '1 second' WHERE id='80000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; BEGIN
 r:=scan_test.finish('80000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004');
 PERFORM scan_test.check_true(r->>'outcome'='failed' AND r->'scan'->'results'='[]'::jsonb,'expired result rejected');
 PERFORM scan_test.check_true((SELECT xp=0 FROM vida_aide.profiles WHERE id='20000000-0000-4000-8000-000000000004'),'no XP for late result');
END; $$;
ROLLBACK;

-- CASE: rolling_window_and_bounded_cleanup
BEGIN;
INSERT INTO vida_aide.scans(user_id,type,status,created_at)
 SELECT '20000000-0000-4000-8000-000000000002','financial','failed',clock_timestamp()-interval '24 hours 1 minute' FROM generate_series(1,5);
SELECT scan_test.check_true(scan_test.reserve('80000000-0000-4000-8000-000000000001')->>'outcome'='reserved','outside rolling window does not consume a new slot');
INSERT INTO vida_aide.scans(user_id,type,status,created_at,processing_expires_at)
 SELECT '20000000-0000-4000-8000-000000000004','financial','processing',now()-interval '6 minutes',now()-interval '1 minute' FROM generate_series(1,60);
SELECT scan_test.check_true(scan_test.reserve('80000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000004')->>'outcome'='quota_exceeded','expired attempts remain counted');
SELECT scan_test.check_true((SELECT count(*)=50 FROM vida_aide.scans WHERE user_id='20000000-0000-4000-8000-000000000004' AND status='failed'),'cleanup is bounded at fifty unrelated rows');
SELECT scan_test.check_true((SELECT count(*)=10 FROM vida_aide.scans WHERE user_id='20000000-0000-4000-8000-000000000004' AND status='processing'),'remaining sweep is deferred');
ROLLBACK;

-- CASE: premium_and_administrator_policy
BEGIN;
INSERT INTO vida_aide.scans(user_id,type) SELECT p.id,'financial' FROM vida_aide.profiles p CROSS JOIN generate_series(1,6)
 WHERE p.auth_user_id IN ('50000000-0000-4000-8000-000000000005','60000000-0000-4000-8000-000000000006');
SET LOCAL ROLE service_role;
SELECT scan_test.check_true(scan_test.reserve('80000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000005')->>'outcome'='reserved','premium stays unlimited');
SELECT scan_test.check_true(scan_test.reserve('80000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000006')->>'plan'='premium','superadmin retains policy');
ROLLBACK;

-- CASE: inconsistent_result_is_atomic_rejection
BEGIN;
SET LOCAL ROLE service_role;
DO $$ DECLARE rejected boolean:=false; r jsonb; BEGIN
 PERFORM scan_test.reserve('80000000-0000-4000-8000-000000000001');
 SELECT args->'finish'->'p_result' INTO r FROM scan_test.fixture;
 BEGIN PERFORM scan_test.finish('80000000-0000-4000-8000-000000000001',p_result=>jsonb_set(r,'{total_recoverable}','2400'));
 EXCEPTION WHEN SQLSTATE '22023' THEN rejected:=true; END;
 PERFORM scan_test.check_true(rejected,'double inflation rejected in SQL');
 PERFORM scan_test.check_true((SELECT status='processing' AND results='[]'::jsonb FROM vida_aide.scans WHERE id='80000000-0000-4000-8000-000000000001'),'failed finalization rolls back');
END; $$;
ROLLBACK;

-- CASE: decimal_rounding_and_initial_xp_floor
BEGIN;
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; f jsonb; BEGIN
 PERFORM scan_test.reserve('80000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004');
 SELECT args->'finish'->'p_result' INTO r FROM scan_test.fixture;
 r:=jsonb_set(jsonb_set(jsonb_set(r,'{results,0,montant_estime}','10.075'),'{total_recoverable}','120.96'),'{total_recoverable_monthly}','10.08');
 f:=scan_test.finish('80000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004',r);
 PERFORM scan_test.check_true(f->>'outcome'='completed' AND (f->'scan'->>'total_recoverable')::numeric=120.96,'decimal cents before annualization');
 PERFORM scan_test.check_true((SELECT xp=100 FROM vida_aide.profiles WHERE id='20000000-0000-4000-8000-000000000004'),'original initial XP floor');
 UPDATE vida_aide.profiles SET xp=450 WHERE id='20000000-0000-4000-8000-000000000004';
 PERFORM scan_test.finish('80000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004',r);
 PERFORM scan_test.check_true((SELECT xp=450 FROM vida_aide.profiles WHERE id='20000000-0000-4000-8000-000000000004'),'replay does not overwrite later progress');
 SELECT args->'finish'->'p_result' INTO r FROM scan_test.fixture;
 r:=jsonb_set(r,'{results}',jsonb_build_array(
  jsonb_set(r->'results'->0,'{montant_estime}','10.005'),
  jsonb_set(jsonb_set(r->'results'->0,'{montant_estime}','25.125'),'{unite}','"an"'),
  jsonb_set(jsonb_set(r->'results'->0,'{montant_estime}','5.015'),'{unite}','"unique"')));
 r:=jsonb_set(jsonb_set(r,'{total_recoverable}','150.27'),'{total_recoverable_monthly}','10.01');
 PERFORM scan_test.reserve('80000000-0000-4000-8000-000000000002');
 f:=scan_test.finish('80000000-0000-4000-8000-000000000002',p_result=>r);
 PERFORM scan_test.check_true(f->>'outcome'='completed' AND (f->'scan'->>'total_recoverable_monthly')::numeric=10.01,'annual and one-time values never inflate the monthly total');
END; $$;
ROLLBACK;

-- CASE: rollback_after_result_before_xp
BEGIN;
CREATE FUNCTION scan_test.reject_xp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic XP failure'; END; $$;
CREATE TRIGGER scan_test_xp BEFORE UPDATE OF xp ON vida_aide.profiles FOR EACH ROW EXECUTE FUNCTION scan_test.reject_xp();
SET LOCAL ROLE service_role;
DO $$ DECLARE rejected boolean:=false; BEGIN
 PERFORM scan_test.reserve('80000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004');
 BEGIN PERFORM scan_test.finish('80000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004');
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='synthetic XP failure' THEN rejected:=true; ELSE RAISE; END IF; END;
 PERFORM scan_test.check_true(rejected,'final effect failure observed');
 PERFORM scan_test.check_true((SELECT status='processing' AND results='[]'::jsonb FROM vida_aide.scans WHERE id='80000000-0000-4000-8000-000000000001'),'result update rolled back');
 PERFORM scan_test.check_true((SELECT xp=0 FROM vida_aide.profiles WHERE id='20000000-0000-4000-8000-000000000004'),'XP rolled back');
END; $$;
RESET ROLE;
DROP TRIGGER scan_test_xp ON vida_aide.profiles;
SELECT scan_test.check_true(scan_test.finish('80000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004')->>'outcome'='completed','same attempt can finalize after transaction rollback');
ROLLBACK;

-- CASE: client_cannot_forge_admission_or_completion
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT scan_test.check_true(row_security_active('vida_aide.scans'),'RLS is genuinely active');
SELECT scan_test.check_true((SELECT count(*)=2 FROM vida_aide.scans),'own historical SELECT is preserved');
DO $$ DECLARE rejected integer:=0; BEGIN
 BEGIN PERFORM vida_aide.reserve_scan_v1('10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','financial','{}'); EXCEPTION WHEN insufficient_privilege THEN rejected:=rejected+1; END;
 BEGIN INSERT INTO vida_aide.scans(user_id,type) VALUES('20000000-0000-4000-8000-000000000002','financial'); EXCEPTION WHEN insufficient_privilege THEN rejected:=rejected+1; END;
 BEGIN UPDATE vida_aide.scans SET status='completed'; EXCEPTION WHEN insufficient_privilege THEN rejected:=rejected+1; END;
 BEGIN DELETE FROM vida_aide.scans; EXCEPTION WHEN insufficient_privilege THEN rejected:=rejected+1; END;
 PERFORM scan_test.check_true(rejected=4,'client cannot manufacture scans or admission');
END; $$;
SELECT scan_test.check_true(NOT has_function_privilege('authenticated','vida_aide.finish_scan_v1(uuid,uuid,text,jsonb,jsonb,text)','EXECUTE'),'client cannot finalize');
SELECT scan_test.check_true(NOT has_function_privilege('anon','vida_aide.reserve_scan_v1(uuid,uuid,text,jsonb)','EXECUTE'),'anonymous cannot reserve');
ROLLBACK;

-- CASE: historical_rows_and_money_preserved
SELECT scan_test.check_true(NOT EXISTS (
 SELECT 1 FROM scan_test.old_scans old LEFT JOIN vida_aide.scans s USING(id)
 WHERE (to_jsonb(s)-'processing_expires_at'-'failure_code') IS DISTINCT FROM old.original
),'all historical scan values preserved');
SELECT scan_test.check_true(NOT EXISTS (
 SELECT 1 FROM scan_test.old_money old LEFT JOIN vida_aide.profiles p USING(id)
 WHERE p.total_money_recovered IS DISTINCT FROM old.total_money_recovered
 OR p.wallet_balance IS DISTINCT FROM old.wallet_balance OR p.purama_points IS DISTINCT FROM old.purama_points
),'historical money and points preserved');
SELECT scan_test.check_true(has_table_privilege('service_role','vida_aide.scans','INSERT,UPDATE,DELETE'),'server storage authority preserved');
SELECT scan_test.check_true((SELECT count(*)=0 FROM vida_aide.scans WHERE processing_expires_at IS NOT NULL),'no historical lease invented');

-- CASE: historical_pending_is_not_automatically_reclassified
BEGIN;
SET LOCAL ROLE service_role;
SELECT scan_test.check_true(scan_test.finish('70000000-0000-4000-8000-000000000002',p_input=>'{}')->>'outcome'='legacy_unconfirmed','unleased historical processing is not finalized');
SELECT scan_test.check_true((SELECT status='processing' AND processing_expires_at IS NULL FROM vida_aide.scans WHERE id='70000000-0000-4000-8000-000000000002'),'legacy state remains unchanged');
ROLLBACK;

-- CASE: invalid_reservation_is_not_admitted
BEGIN;
SET LOCAL ROLE service_role;
DO $$ DECLARE rejected integer:=0; BEGIN
 BEGIN PERFORM vida_aide.reserve_scan_v1(NULL,'80000000-0000-4000-8000-000000000001','financial','{}'); EXCEPTION WHEN SQLSTATE '22023' THEN rejected:=rejected+1; END;
 BEGIN PERFORM vida_aide.reserve_scan_v1('10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','juridique','{}'); EXCEPTION WHEN SQLSTATE '22023' THEN rejected:=rejected+1; END;
 BEGIN PERFORM vida_aide.reserve_scan_v1('10000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','financial','[]'); EXCEPTION WHEN SQLSTATE '22023' THEN rejected:=rejected+1; END;
 PERFORM scan_test.check_true(rejected=3,'invalid identities, types and input rejected');
 PERFORM scan_test.check_true((SELECT count(*)=2 FROM vida_aide.scans),'no invalid new scan');
END; $$;
ROLLBACK;
