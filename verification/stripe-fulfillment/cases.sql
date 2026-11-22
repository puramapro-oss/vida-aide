-- CASE: private_registry_and_rpc
SELECT stripe_test.check_true(NOT has_table_privilege('authenticated','vida_aide.stripe_events','SELECT,INSERT,UPDATE,DELETE'),'client ledger access');
SELECT stripe_test.check_true(NOT has_table_privilege('anon','vida_aide.stripe_fulfillment_settings','SELECT,INSERT,UPDATE,DELETE'),'anonymous settings access');
SELECT stripe_test.check_true(NOT has_table_privilege('service_role','vida_aide.stripe_fulfillment_settings','INSERT,UPDATE,DELETE,TRUNCATE'),'cutover mutation privilege');
SELECT stripe_test.check_true(has_table_privilege('service_role','vida_aide.stripe_fulfillment_settings','SELECT'),'cutover service read');
SELECT stripe_test.check_true(NOT has_function_privilege('authenticated','vida_aide.apply_stripe_fulfillment(text,text,text,text,bigint,uuid,bigint,jsonb,jsonb)','EXECUTE'),'client RPC execution');
SELECT stripe_test.check_true(has_function_privilege('service_role','vida_aide.apply_stripe_fulfillment(text,text,text,text,bigint,uuid,bigint,jsonb,jsonb)','EXECUTE'),'service RPC execution');
SET ROLE authenticated;
SELECT stripe_test.check_true(row_security_active('vida_aide.profiles'),'profile RLS inactive');
DO $$ BEGIN
  BEGIN PERFORM vida_aide.apply_stripe_fulfillment('evt_attack','checkout.session.completed','cs_attack',repeat('a',64),1,'10000000-0000-4000-8000-000000000001',0,NULL,NULL); RAISE EXCEPTION 'ASSERTION: client RPC accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;

-- CASE: one_paid_checkout
DO $$ DECLARE r jsonb; BEGIN
  r:=stripe_test.call_event('evt_paid','cs_paid');
  PERFORM stripe_test.check_true(r->>'status'='applied' AND r->>'duplicate'='false','first receipt');
  PERFORM stripe_test.check_true(r->>'payment_id' IS NOT NULL AND r->>'wallet_transaction_id' IS NOT NULL,'durable payment/wallet receipt');
  PERFORM stripe_test.check_true(stripe_test.balance()=20,'50 percent once');
  PERFORM stripe_test.check_true((SELECT count(*)=1 FROM vida_aide.payments WHERE stripe_checkout_id='cs_paid'),'one payment');
  PERFORM stripe_test.check_true((SELECT count(*)=1 FROM vida_aide.wallet_transactions WHERE stripe_checkout_id='cs_paid'),'one wallet row');
  PERFORM stripe_test.check_true((SELECT stripe_customer_id='cus_fixture' AND subscription_plan='premium' AND stripe_state_revision=1 FROM vida_aide.profiles WHERE id='10000000-0000-4000-8000-000000000001'),'binding and revision');
END; $$;

-- CASE: same_event_replay
DO $$ DECLARE r jsonb; first_receipt jsonb; BEGIN
  SELECT receipt INTO STRICT first_receipt FROM vida_aide.stripe_events WHERE event_id='evt_paid';
  r:=stripe_test.call_event('evt_paid','cs_paid',chosen_revision=>0);
  PERFORM stripe_test.check_true(r=first_receipt||'{"duplicate":true}'::jsonb,'duplicate retains committed receipt even with old revision');
  PERFORM stripe_test.check_true(stripe_test.balance()=20,'repeated event double credit');
  PERFORM stripe_test.check_true((SELECT count(*)=1 FROM vida_aide.notifications WHERE type='referral'),'repeated notification');
END; $$;

-- CASE: distinct_event_same_session
DO $$ DECLARE r jsonb; BEGIN
  r:=stripe_test.call_event('evt_same_session','cs_paid');
  PERFORM stripe_test.check_true(r->>'status'='applied','new event receipt');
  PERFORM stripe_test.check_true(stripe_test.balance()=20,'second event same session double credit');
  PERFORM stripe_test.check_true((SELECT count(*)=1 FROM vida_aide.payments WHERE stripe_checkout_id='cs_paid'),'second payment for one session');
  PERFORM stripe_test.check_true((SELECT count(*)=1 FROM vida_aide.wallet_transactions WHERE stripe_checkout_id='cs_paid'),'second wallet entry for one session');
END; $$;

-- CASE: distinct_sessions_accumulate
SELECT stripe_test.call_event('evt_two','cs_two');
SELECT stripe_test.call_event('evt_three','cs_three');
SELECT stripe_test.check_true(stripe_test.balance()=40,'atomic increments preserve distinct credits');

-- CASE: unpaid_then_async_paid
DO $$ DECLARE r jsonb; previous numeric:=stripe_test.balance(); BEGIN
  r:=stripe_test.call_event('evt_waiting','cs_delayed','{"payment_status":"unpaid"}');
  PERFORM stripe_test.check_true(r->>'status'='deferred' AND r->>'profile_id' IS NULL AND r->>'payment_id' IS NULL AND r->>'wallet_transaction_id' IS NULL,'unpaid receipt');
  PERFORM stripe_test.check_true(stripe_test.balance()=previous,'unpaid checkout credited');
  r:=stripe_test.call_event('evt_later','cs_delayed',event_type=>'checkout.session.async_payment_succeeded');
  PERFORM stripe_test.check_true(r->>'status'='applied' AND stripe_test.balance()=previous+10,'delayed payment missing');
  PERFORM stripe_test.call_event('evt_later','cs_delayed',event_type=>'checkout.session.async_payment_succeeded');
  PERFORM stripe_test.check_true(stripe_test.balance()=previous+10,'delayed payment double credit');
END; $$;

-- CASE: failed_effect_rolls_back_and_retries
DO $$ DECLARE previous numeric:=stripe_test.balance(); previous_revision bigint; BEGIN
  SELECT stripe_state_revision INTO previous_revision FROM vida_aide.profiles WHERE id='10000000-0000-4000-8000-000000000001';
  PERFORM set_config('stripe_test.fail_notification','yes',true);
  BEGIN
    PERFORM stripe_test.call_event('evt_rollback','cs_rollback');
    RAISE EXCEPTION 'ASSERTION: injected failure did not abort';
  EXCEPTION WHEN SQLSTATE '22000' THEN NULL; END;
  PERFORM set_config('stripe_test.fail_notification','no',true);
  PERFORM stripe_test.check_true(stripe_test.balance()=previous,'balance survived rollback');
  PERFORM stripe_test.check_true(NOT EXISTS(SELECT FROM vida_aide.stripe_events WHERE event_id='evt_rollback'),'failed event reserved');
  PERFORM stripe_test.check_true(NOT EXISTS(SELECT FROM vida_aide.payments WHERE stripe_checkout_id='cs_rollback'),'partial payment survived');
  PERFORM stripe_test.check_true(NOT EXISTS(SELECT FROM vida_aide.wallet_transactions WHERE stripe_checkout_id='cs_rollback'),'partial wallet receipt survived');
  PERFORM stripe_test.check_true((SELECT stripe_state_revision=previous_revision FROM vida_aide.profiles WHERE id='10000000-0000-4000-8000-000000000001'),'version survived rollback');
  PERFORM stripe_test.call_event('evt_rollback','cs_rollback');
  PERFORM stripe_test.check_true(stripe_test.balance()=previous+10,'retry did not apply exactly once');
END; $$;

-- CASE: legacy_unverified_event_preserved
DO $$ DECLARE previous numeric:=stripe_test.balance(); BEGIN
  BEGIN PERFORM stripe_test.call_event('evt_legacy','cs_legacy'); RAISE EXCEPTION 'ASSERTION: legacy event acknowledged';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'Legacy event requires reconciliation' THEN RAISE; END IF; END;
  PERFORM stripe_test.check_true(stripe_test.balance()=previous,'legacy replay credit');
  PERFORM stripe_test.check_true((SELECT receipt IS NULL AND payload_hash IS NULL FROM vida_aide.stripe_events WHERE event_id='evt_legacy'),'legacy record changed');
END; $$;

-- CASE: pre_cutover_event_and_session_refused
DO $$ DECLARE previous numeric:=stripe_test.balance(); BEGIN
  BEGIN PERFORM stripe_test.call_event('evt_old','cs_old',event_time=>0); RAISE EXCEPTION 'ASSERTION: old event accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'Pre-cutover checkout requires reconciliation' THEN RAISE; END IF; END;
  BEGIN PERFORM stripe_test.call_event('evt_new_old_session','cs_old_session','{"created":0}'); RAISE EXCEPTION 'ASSERTION: old session accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'Pre-cutover checkout requires reconciliation' THEN RAISE; END IF; END;
  PERFORM stripe_test.check_true(stripe_test.balance()=previous,'old checkout credit');
  PERFORM stripe_test.check_true(NOT EXISTS(SELECT FROM vida_aide.stripe_events WHERE event_id IN ('evt_old','evt_new_old_session')),'cutover failure reserved event');
END; $$;

-- CASE: event_identity_conflict
DO $$ DECLARE e vida_aide.stripe_events%ROWTYPE; BEGIN
  SELECT * INTO STRICT e FROM vida_aide.stripe_events WHERE event_id='evt_paid';
  BEGIN PERFORM vida_aide.apply_stripe_fulfillment(e.event_id,e.type,e.object_id,repeat('0',64),1,'10000000-0000-4000-8000-000000000001',0,NULL,NULL); RAISE EXCEPTION 'ASSERTION: event hash conflict accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM stripe_test.check_true((SELECT payload_hash=e.payload_hash FROM vida_aide.stripe_events WHERE event_id=e.event_id),'event conflict altered receipt');
END; $$;

-- CASE: currency_and_positive_unconfirmed_payment
DO $$ DECLARE previous numeric:=stripe_test.balance(); BEGIN
  BEGIN PERFORM stripe_test.call_event('evt_usd','cs_usd','{"currency":"usd"}'); RAISE EXCEPTION 'ASSERTION: USD credited to EUR wallet';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM stripe_test.call_event('evt_bad_trial','cs_bad_trial','{"payment_status":"no_payment_required","amount_total":2000}'); RAISE EXCEPTION 'ASSERTION: unconfirmed payment accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM stripe_test.check_true(stripe_test.balance()=previous,'invalid money changed balance');
  PERFORM stripe_test.check_true(NOT EXISTS(SELECT FROM vida_aide.payments WHERE stripe_checkout_id IN('cs_usd','cs_bad_trial')),'invalid money left payment');
END; $$;

-- CASE: trial_does_not_invent_payment
DO $$ DECLARE previous numeric:=stripe_test.balance(); r jsonb; BEGIN
  r:=stripe_test.call_event('evt_trial','cs_trial','{"payment_status":"no_payment_required","amount_total":0}','{"status":"trialing"}');
  PERFORM stripe_test.check_true(r->>'status'='applied' AND r->>'payment_id' IS NULL AND r->>'wallet_transaction_id' IS NULL,'trial fabricated receipt');
  PERFORM stripe_test.check_true(stripe_test.balance()=previous,'trial credited money');
  PERFORM stripe_test.check_true((SELECT subscription_plan='premium' FROM vida_aide.profiles WHERE id='10000000-0000-4000-8000-000000000001'),'trial entitlement missing');
END; $$;

-- CASE: stale_subscription_read_cannot_restore_access
DO $$ DECLARE old_revision bigint; r jsonb; previous numeric:=stripe_test.balance(); payments_before bigint; BEGIN
  SELECT stripe_state_revision INTO old_revision FROM vida_aide.profiles WHERE id='10000000-0000-4000-8000-000000000001';
  SELECT count(*) INTO payments_before FROM vida_aide.payments;
  PERFORM stripe_test.call_event('evt_cancel','sub_fixture',subscription_patch=>'{"status":"canceled"}',event_type=>'customer.subscription.updated',chosen_revision=>old_revision);
  BEGIN PERFORM stripe_test.call_event('evt_stale_active','sub_fixture',event_type=>'customer.subscription.updated',chosen_revision=>old_revision); RAISE EXCEPTION 'ASSERTION: stale active snapshot accepted';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL; END;
  PERFORM stripe_test.check_true((SELECT subscription_plan='free' FROM vida_aide.profiles WHERE id='10000000-0000-4000-8000-000000000001'),'stale snapshot restored access');
  PERFORM stripe_test.check_true(NOT EXISTS(SELECT FROM vida_aide.stripe_events WHERE event_id='evt_stale_active'),'stale snapshot reserved');
  r:=stripe_test.call_event('evt_stale_active','sub_fixture',subscription_patch=>'{"status":"canceled"}',event_type=>'customer.subscription.updated');
  PERFORM stripe_test.check_true(r->>'status'='applied','retry with current provider state');
  PERFORM stripe_test.check_true((SELECT count(*)=payments_before FROM vida_aide.payments),'subscription list price treated as payment');
  PERFORM stripe_test.check_true(stripe_test.balance()=previous,'subscription update credited wallet');
END; $$;

-- CASE: superseded_subscription_cannot_revoke_current
DO $$ DECLARE r jsonb; previous_revision bigint; BEGIN
  PERFORM stripe_test.call_event('evt_restore','sub_fixture',event_type=>'customer.subscription.updated');
  SELECT stripe_state_revision INTO previous_revision FROM vida_aide.profiles WHERE id='10000000-0000-4000-8000-000000000001';
  r:=stripe_test.call_event('evt_old_sub_deleted','sub_old',subscription_patch=>'{"status":"canceled"}',event_type=>'customer.subscription.deleted');
  PERFORM stripe_test.check_true(r->>'status'='ignored','old subscription not identified');
  PERFORM stripe_test.check_true((SELECT subscription_plan='premium' AND stripe_subscription_id='sub_fixture' AND stripe_state_revision=previous_revision FROM vida_aide.profiles WHERE id='10000000-0000-4000-8000-000000000001'),'old subscription changed current one');
END; $$;

-- CASE: subscription_replacement_requires_terminal_receipt
DO $$ DECLARE r jsonb; BEGIN
  BEGIN PERFORM stripe_test.call_event('evt_new_sub','cs_new_sub','{"subscription_id":"sub_next"}','{"id":"sub_next"}'); RAISE EXCEPTION 'ASSERTION: active subscription replaced without confirmation';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  r:=stripe_test.call_event('evt_new_sub','cs_new_sub','{"subscription_id":"sub_next"}','{"id":"sub_next","previous_id":"sub_fixture","previous_status":"canceled"}');
  PERFORM stripe_test.check_true(r->>'status'='applied','confirmed replacement failed');
  PERFORM stripe_test.check_true((SELECT stripe_subscription_id='sub_next' FROM vida_aide.profiles WHERE id='10000000-0000-4000-8000-000000000001'),'replacement not stored');
END; $$;

-- CASE: historical_values_and_cutover_preserved
SELECT stripe_test.check_true((SELECT total_money_recovered=1234.56 FROM vida_aide.profiles WHERE id='10000000-0000-4000-8000-000000000001'),'historical recovered amount rewritten');
SELECT stripe_test.check_true((SELECT total_money_recovered=789.01 FROM vida_aide.profiles WHERE referral_code='REFTEST'),'referrer historical amount rewritten');
SELECT stripe_test.check_true((SELECT to_jsonb(p)-'stripe_checkout_id'=h.row FROM vida_aide.payments p CROSS JOIN stripe_test.historical_payments h WHERE stripe_payment_id='sub_historical'),'historical payment rewritten');
SELECT stripe_test.check_true((SELECT s.activated_at=c.activated_at FROM vida_aide.stripe_fulfillment_settings s CROSS JOIN stripe_test.cutover c),'cutover changed');
