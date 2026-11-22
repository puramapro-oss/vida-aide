-- CASE: client_rpc_and_direct_close_denied
SELECT contest_test.check_true(has_function_privilege('service_role','vida_aide.settle_weekly_contest_v1(uuid,integer,timestamptz,jsonb)','EXECUTE'),'service cannot settle');
SELECT contest_test.check_true(NOT has_function_privilege('anon','vida_aide.settle_weekly_contest_v1(uuid,integer,timestamptz,jsonb)','EXECUTE'),'anonymous execution');
SELECT contest_test.check_true(NOT has_function_privilege('authenticated','vida_aide.settle_weekly_contest_v1(uuid,integer,timestamptz,jsonb)','EXECUTE'),'client execution');
SET ROLE authenticated;
SELECT contest_test.check_true(row_security_active('vida_aide.contests') AND row_security_active('vida_aide.profiles'),'RLS gate inactive');
SELECT contest_test.check_true((SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname=current_user),'client role bypasses RLS');
DO $$ DECLARE n integer; BEGIN
  BEGIN PERFORM vida_aide.settle_weekly_contest_v1(contest_test.uuid(900),10003,now(),'[]'); RAISE EXCEPTION 'RPC executed' USING ERRCODE='P0004';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE vida_aide.contests SET status='completed',payout_receipt='{"forged":true}' WHERE id=contest_test.uuid(900);
  GET DIAGNOSTICS n=ROW_COUNT; PERFORM contest_test.check_true(n=0,'client forged closure');
END; $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM vida_aide.settle_weekly_contest_v1(contest_test.uuid(900),10003,now(),'[]'); RAISE EXCEPTION 'Anonymous RPC executed' USING ERRCODE='P0004';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;

-- CASE: exact_handler_settlement_commits
SET ROLE service_role;
DO $$ DECLARE r jsonb; args jsonb; BEGIN
  SELECT payload->'args' INTO STRICT args FROM contest_test.fixture;
  r:=vida_aide.settle_weekly_contest_v1((args->>'p_contest_id')::uuid,(args->>'p_expected_pool')::integer,(args->>'p_expected_end')::timestamptz,args->'p_winners');
  PERFORM contest_test.check_true(r=jsonb_build_object('version',1,'contest_id',args->>'p_contest_id','duplicate',false,'winners_count',10,'total_paid_cents',10000,'awards',args->'p_winners'),'receipt differs from actual handler allocations');
  PERFORM contest_test.check_true((SELECT status='completed' AND winners=args->'p_winners' AND payout_receipt=r AND payout_tracking_started_at IS NOT NULL FROM vida_aide.contests WHERE id=contest_test.uuid(900)),'closure/receipt missing');
  PERFORM contest_test.check_true((SELECT count(*)=10 AND sum(amount)=100 FROM vida_aide.wallet_transactions WHERE source_id=contest_test.uuid(900)),'wrong ledger total or count');
  PERFORM contest_test.check_true(NOT EXISTS(SELECT FROM vida_aide.wallet_transactions w JOIN jsonb_array_elements(args->'p_winners') a ON w.user_id=(a->>'user_id')::uuid WHERE w.source_id=contest_test.uuid(900) AND (w.amount<>(a->>'amount_cents')::numeric/100 OR w.status<>'completed' OR w.type<>'contest_prize' OR w.metadata<>jsonb_build_object('contest_id',contest_test.uuid(900),'rank',a->'rank','score',a->'score','payout_version',1))),'ledger loses identity or exact cents');
  PERFORM contest_test.check_true(NOT EXISTS(SELECT FROM vida_aide.profiles p JOIN jsonb_array_elements(args->'p_winners') a ON p.id=(a->>'user_id')::uuid WHERE p.wallet_balance<>25.50+(a->>'amount_cents')::numeric/100),'balance lost original funds');
  PERFORM contest_test.check_true((SELECT count(*)=10 FROM vida_aide.notifications WHERE type='contest_won' AND action_url='/dashboard/wallet'),'notifications missing');
END; $$;
RESET ROLE;

-- CASE: committed_replay_uses_original_receipt
SET ROLE service_role;
DO $$ DECLARE first_receipt jsonb; r jsonb; before_money numeric; before_notifications bigint; BEGIN
  SELECT payout_receipt INTO STRICT first_receipt FROM vida_aide.contests WHERE id=contest_test.uuid(900);
  SELECT sum(wallet_balance) INTO before_money FROM vida_aide.profiles;
  SELECT count(*) INTO before_notifications FROM vida_aide.notifications;
  r:=contest_test.settle(contest_test.uuid(900),'[]');
  PERFORM contest_test.check_true(r=first_receipt||'{"duplicate":true}'::jsonb,'replay changed committed awards');
  PERFORM contest_test.check_true((SELECT sum(wallet_balance)=before_money FROM vida_aide.profiles),'duplicate credited balance');
  PERFORM contest_test.check_true((SELECT count(*)=10 FROM vida_aide.wallet_transactions WHERE source_id=contest_test.uuid(900)),'duplicate ledger entry');
  PERFORM contest_test.check_true((SELECT count(*)=before_notifications FROM vida_aide.notifications),'duplicate notification');
END; $$;
RESET ROLE;

-- CASE: final_closure_failure_rolls_back_then_explicit_retry
BEGIN;
SELECT contest_test.new_contest(contest_test.uuid(910));
SET ROLE service_role;
DO $$ DECLARE before_money numeric; before_notifications bigint; r jsonb; BEGIN
  SELECT sum(wallet_balance) INTO before_money FROM vida_aide.profiles;
  SELECT count(*) INTO before_notifications FROM vida_aide.notifications;
  PERFORM set_config('contest_test.fail_closure','yes',true);
  PERFORM contest_test.reject(contest_test.uuid(910),contest_test.awards(),'22000');
  PERFORM set_config('contest_test.fail_closure','no',true);
  PERFORM contest_test.check_true((SELECT sum(wallet_balance)=before_money FROM vida_aide.profiles),'last write failure left balance');
  PERFORM contest_test.check_true(NOT EXISTS(SELECT FROM vida_aide.wallet_transactions WHERE source_id=contest_test.uuid(910)),'last write failure left ledger');
  PERFORM contest_test.check_true((SELECT count(*)=before_notifications FROM vida_aide.notifications),'last write failure left notifications');
  PERFORM contest_test.check_true((SELECT status='live' AND winners IS NULL AND payout_receipt IS NULL FROM vida_aide.contests WHERE id=contest_test.uuid(910)),'last write failure closed contest');
  r:=contest_test.settle(contest_test.uuid(910));
  PERFORM contest_test.check_true(r->>'duplicate'='false' AND (r->>'total_paid_cents')::integer=10000,'retry did not settle once');
  PERFORM contest_test.check_true((SELECT sum(wallet_balance)=before_money+100 FROM vida_aide.profiles),'retry balance mismatch');
  PERFORM contest_test.settle(contest_test.uuid(910));
  PERFORM contest_test.check_true((SELECT count(*)=10 FROM vida_aide.wallet_transactions WHERE source_id=contest_test.uuid(910)),'retry duplicated ledger');
END; $$;
ROLLBACK;

-- CASE: last_notification_failure_rolls_back_every_award
BEGIN;
SELECT contest_test.new_contest(contest_test.uuid(911));
DO $$ DECLARE before_money numeric; before_notifications bigint; BEGIN
  SELECT sum(wallet_balance) INTO before_money FROM vida_aide.profiles;
  SELECT count(*) INTO before_notifications FROM vida_aide.notifications;
  PERFORM set_config('contest_test.fail_notification','yes',true);
  PERFORM contest_test.reject(contest_test.uuid(911),contest_test.awards(),'22000');
  PERFORM contest_test.check_true((SELECT sum(wallet_balance)=before_money FROM vida_aide.profiles),'notification failure left balance');
  PERFORM contest_test.check_true(NOT EXISTS(SELECT FROM vida_aide.wallet_transactions WHERE source_id=contest_test.uuid(911)),'notification failure left ledger');
  PERFORM contest_test.check_true((SELECT count(*)=before_notifications FROM vida_aide.notifications),'notification failure left earlier notifications');
END; $$;
ROLLBACK;

-- CASE: invalid_ranks_and_duplicate_beneficiaries
BEGIN;
SELECT contest_test.new_contest(contest_test.uuid(912));
SELECT contest_test.reject(contest_test.uuid(912),jsonb_set(contest_test.awards(),'{0,rank}','2'));
SELECT contest_test.reject(contest_test.uuid(912),jsonb_set(contest_test.awards(),'{0,rank}','1.5'));
SELECT contest_test.reject(contest_test.uuid(912),jsonb_set(contest_test.awards(),'{0,rank}','"1"'));
SELECT contest_test.reject(contest_test.uuid(912),jsonb_set(contest_test.awards(),'{1,user_id}',to_jsonb(contest_test.uuid(1)::text)));
ROLLBACK;

-- CASE: invalid_amounts_never_change_allocation
BEGIN;
SELECT contest_test.new_contest(contest_test.uuid(913));
SELECT contest_test.reject(contest_test.uuid(913),jsonb_set(contest_test.awards(),'{0,amount_cents}','3301'));
SELECT contest_test.reject(contest_test.uuid(913),jsonb_set(contest_test.awards(),'{0,amount_cents}','3300.5'));
SELECT contest_test.reject(contest_test.uuid(913),jsonb_set(contest_test.awards(),'{0,amount_cents}','-1'));
SELECT contest_test.reject(contest_test.uuid(913),jsonb_set(contest_test.awards(),'{0,amount_cents}','"3300"'));
SELECT contest_test.check_true(NOT EXISTS(SELECT FROM vida_aide.wallet_transactions WHERE source_id=contest_test.uuid(913)),'invalid allocation wrote ledger');
ROLLBACK;

-- CASE: invalid_winner_types_and_scores
BEGIN;
SELECT contest_test.new_contest(contest_test.uuid(914));
SELECT contest_test.reject(contest_test.uuid(914),jsonb_set(contest_test.awards(),'{0,score}','0'));
SELECT contest_test.reject(contest_test.uuid(914),jsonb_set(contest_test.awards(),'{0,score}','1.5'));
SELECT contest_test.reject(contest_test.uuid(914),jsonb_set(contest_test.awards(),'{0,score}','"10"'));
SELECT contest_test.reject(contest_test.uuid(914),jsonb_set(contest_test.awards(),'{0,name}','{}'));
SELECT contest_test.reject(contest_test.uuid(914),contest_test.awards()#-'{0,name}');
SELECT contest_test.reject(contest_test.uuid(914),jsonb_set(contest_test.awards(),'{0,user_id}','{}'));
SELECT contest_test.reject(contest_test.uuid(914),jsonb_set(contest_test.awards(),'{0,user_id}','"bad"'),'22P02');
SELECT contest_test.reject(contest_test.uuid(914),'{}');
SELECT contest_test.reject(contest_test.uuid(914),'[null]');
ROLLBACK;

-- CASE: missing_or_excess_beneficiaries_refused
BEGIN;
SELECT contest_test.new_contest(contest_test.uuid(915));
SELECT contest_test.reject(contest_test.uuid(915),jsonb_set(contest_test.awards(),'{0,user_id}',to_jsonb(contest_test.uuid(999)::text)));
SELECT contest_test.reject(contest_test.uuid(915),contest_test.awards()||jsonb_build_array(contest_test.awards()->0));
SELECT contest_test.check_true(NOT EXISTS(SELECT FROM vida_aide.wallet_transactions WHERE source_id=contest_test.uuid(915)),'unknown beneficiary wrote ledger');
ROLLBACK;

-- CASE: stale_pool_end_or_contest_state_refused
BEGIN;
SELECT contest_test.new_contest(contest_test.uuid(916));
SELECT contest_test.reject(contest_test.uuid(916),contest_test.awards(),'22023',10004);
SELECT contest_test.reject(contest_test.uuid(916),contest_test.awards(),'22023',10003,now()-interval '20 days');
UPDATE vida_aide.contests SET status='cancelled' WHERE id=contest_test.uuid(916);
SELECT contest_test.reject(contest_test.uuid(916),contest_test.awards());
UPDATE vida_aide.contests SET status='live',type='monthly' WHERE id=contest_test.uuid(916);
SELECT contest_test.reject(contest_test.uuid(916),contest_test.awards());
UPDATE vida_aide.contests SET type='weekly',end_date=now()+interval '1 day' WHERE id=contest_test.uuid(916);
SELECT contest_test.reject(contest_test.uuid(916),contest_test.awards());
ROLLBACK;

-- CASE: legacy_without_any_ledger_is_not_replayed
SELECT contest_test.check_true(NOT EXISTS(SELECT FROM vida_aide.wallet_transactions WHERE source_id=contest_test.uuid(800)),'legacy no-ledger fixture invalid');
SELECT contest_test.reject(contest_test.uuid(800),contest_test.awards(),'P0001');
SELECT contest_test.check_true((SELECT status='live' AND payout_tracking_started_at IS NULL FROM vida_aide.contests WHERE id=contest_test.uuid(800)),'legacy no-ledger state changed');

-- CASE: legacy_partial_ledger_is_preserved
SELECT contest_test.reject(contest_test.uuid(801),contest_test.awards(),'P0001');
SELECT contest_test.check_true((SELECT count(*)=1 AND sum(amount)=7.25 FROM vida_aide.wallet_transactions WHERE source_id=contest_test.uuid(801)),'old partial ledger changed');

-- CASE: tracked_contest_with_ambiguous_ledger_is_refused
BEGIN;
SELECT contest_test.new_contest(contest_test.uuid(917));
INSERT INTO vida_aide.wallet_transactions(user_id,amount,type,source_id) VALUES(contest_test.uuid(1),4,'contest_prize',contest_test.uuid(917));
SELECT contest_test.reject(contest_test.uuid(917),contest_test.awards(),'P0001');
SELECT contest_test.check_true((SELECT count(*)=1 AND sum(amount)=4 FROM vida_aide.wallet_transactions WHERE source_id=contest_test.uuid(917)),'partial tracked ledger replayed');
ROLLBACK;

-- CASE: zero_pool_has_notifications_without_money
BEGIN;
SELECT contest_test.new_contest(contest_test.uuid(918),0);
DO $$ DECLARE before_money numeric; before_notifications bigint; r jsonb; BEGIN
  SELECT sum(wallet_balance) INTO before_money FROM vida_aide.profiles;
  SELECT count(*) INTO before_notifications FROM vida_aide.notifications;
  r:=contest_test.settle(contest_test.uuid(918),contest_test.awards(0));
  PERFORM contest_test.check_true(r->>'total_paid_cents'='0' AND r->>'winners_count'='10','zero pool receipt wrong');
  PERFORM contest_test.check_true((SELECT sum(wallet_balance)=before_money FROM vida_aide.profiles),'zero pool invented money');
  PERFORM contest_test.check_true(NOT EXISTS(SELECT FROM vida_aide.wallet_transactions WHERE source_id=contest_test.uuid(918)),'zero pool invented ledger');
  PERFORM contest_test.check_true((SELECT count(*)=before_notifications+10 FROM vida_aide.notifications),'zero pool participation missing');
END; $$;
ROLLBACK;

-- CASE: no_positive_candidates_closes_with_empty_receipt
BEGIN;
SELECT contest_test.new_contest(contest_test.uuid(919));
SELECT contest_test.check_true(contest_test.settle(contest_test.uuid(919),'[]')=jsonb_build_object('version',1,'contest_id',contest_test.uuid(919),'duplicate',false,'winners_count',0,'total_paid_cents',0,'awards','[]'::jsonb),'empty receipt wrong');
SELECT contest_test.check_true((SELECT status='completed' AND winners='[]'::jsonb FROM vida_aide.contests WHERE id=contest_test.uuid(919)),'empty contest not closed');
SELECT contest_test.check_true(NOT EXISTS(SELECT FROM vida_aide.wallet_transactions WHERE source_id=contest_test.uuid(919)),'empty contest wrote ledger');
ROLLBACK;

-- CASE: fewer_winners_do_not_redistribute_remainder
BEGIN;
SELECT contest_test.new_contest(contest_test.uuid(920));
SELECT contest_test.check_true((contest_test.settle(contest_test.uuid(920),contest_test.awards(10003,3))->>'total_paid_cents')::integer=6200,'top three allocation changed');
SELECT contest_test.check_true((SELECT count(*)=3 AND sum(amount)=62 FROM vida_aide.wallet_transactions WHERE source_id=contest_test.uuid(920)),'top three ledger wrong');
ROLLBACK;

-- CASE: maximum_integer_pool_uses_exact_cents
BEGIN;
SELECT contest_test.new_contest(contest_test.uuid(921),2147483647);
DO $$ DECLARE r jsonb; expected bigint; BEGIN
  SELECT sum((value->>'amount_cents')::bigint) INTO expected FROM jsonb_array_elements(contest_test.awards(2147483647));
  r:=contest_test.settle(contest_test.uuid(921),contest_test.awards(2147483647));
  PERFORM contest_test.check_true((r->>'total_paid_cents')::bigint=expected AND expected<=2147483647,'integer overflow or rounding loss');
  PERFORM contest_test.check_true((SELECT sum(amount)*100=expected FROM vida_aide.wallet_transactions WHERE source_id=contest_test.uuid(921)),'maximum pool ledger mismatch');
END; $$;
ROLLBACK;

-- CASE: null_arguments_fail_without_side_effects
DO $$ BEGIN
  BEGIN PERFORM vida_aide.settle_weekly_contest_v1(NULL,10003,now(),'[]'); RAISE EXCEPTION 'null id accepted' USING ERRCODE='P0004'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM vida_aide.settle_weekly_contest_v1(contest_test.uuid(900),NULL,now(),'[]'); RAISE EXCEPTION 'null pool accepted' USING ERRCODE='P0004'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM vida_aide.settle_weekly_contest_v1(contest_test.uuid(900),10003,NULL,'[]'); RAISE EXCEPTION 'null end accepted' USING ERRCODE='P0004'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM vida_aide.settle_weekly_contest_v1(contest_test.uuid(900),10003,now(),NULL); RAISE EXCEPTION 'null winners accepted' USING ERRCODE='P0004'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END; $$;

-- CASE: historical_rows_and_marker_preserved
SELECT contest_test.check_true(NOT EXISTS(SELECT FROM contest_test.historical_contests h LEFT JOIN vida_aide.contests c ON c.id=h.id WHERE c.id IS NULL OR to_jsonb(c)-'payout_receipt'-'payout_tracking_started_at'<>h.row OR c.payout_receipt IS NOT NULL OR c.payout_tracking_started_at IS NOT NULL),'historical contest rewritten or tracked retroactively');
SELECT contest_test.check_true(NOT EXISTS(SELECT FROM contest_test.historical_wallet h LEFT JOIN vida_aide.wallet_transactions w ON w.id=h.id WHERE w.id IS NULL OR to_jsonb(w)-'stripe_checkout_id'<>h.row),'historical wallet rewritten');
SELECT contest_test.check_true(NOT EXISTS(SELECT FROM contest_test.historical_notifications h LEFT JOIN vida_aide.notifications n ON n.id=h.id WHERE n.id IS NULL OR to_jsonb(n)<>h.row),'historical notification rewritten');
SELECT contest_test.check_true(NOT EXISTS(SELECT FROM contest_test.historical_profiles h LEFT JOIN vida_aide.profiles p ON p.id=h.id WHERE p.id IS NULL OR to_jsonb(p)-'wallet_balance'-'updated_at'-'stripe_state_revision'<>h.row-'wallet_balance'-'updated_at'),'profile historical, points or XP rewritten');
SELECT contest_test.check_true(NOT EXISTS(SELECT FROM contest_test.marker m JOIN vida_aide.contests c ON c.id=m.id WHERE c.payout_tracking_started_at IS DISTINCT FROM m.payout_tracking_started_at),'tracking activation changed');
