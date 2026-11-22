// Real local PostgreSQL concurrency gate. No provider calls; runtime remains NON TESTE until CI.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { runLocalPostgres } = require('../local-postgres-fixture.cjs');
const repository = path.resolve(__dirname, '../..');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sources = ['schema.sql', 'migrations/0004_profiles_client_permissions.sql', 'migrations/0005_stripe_atomic_fulfillment.sql',
  'verification/profiles-permissions/setup.sql', 'verification/stripe-fulfillment/seed.sql',
  'verification/stripe-fulfillment/emit-fixture.cjs', 'verification/stripe-fulfillment/harness.cjs',
  'verification/stripe-fulfillment/concurrency.cjs', 'verification/package-lock.json',
  'src/lib/stripe-fulfillment.ts', 'src/app/api/stripe/webhook/route.ts', 'src/app/api/internal/stripe-fulfillment/route.ts'];
const rpc = `SELECT vida_aide.apply_stripe_fulfillment($1,$2,$3,$4,$5,$6::uuid,$7::bigint,$8::jsonb,$9::jsonb) AS receipt`;
function values(args, revision) {
  return [args.p_event_id, args.p_event_type, args.p_object_id, args.p_payload_hash, args.p_event_created,
    args.p_profile_id, revision, JSON.stringify(args.p_checkout), JSON.stringify(args.p_subscription)];
}
async function scenario(context, name, variants, referrerId, blockProfileId, expectedCredits, expectedDuplicates) {
  const { control, receipt, save, connect, closeClient, observeLockOverlap } = context;
  const evidence = { name, status: 'RUNNING', calls: 12, workers: [] };
  receipt.scenarios.push(evidence); save();
  const connected = await Promise.allSettled(Array.from({ length: 12 }, () => connect(true)));
  const failure = connected.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  const workers = connected.map((result) => result.value);
  const identities = await Promise.all(workers.map(async (client) => (await client.query('SELECT pg_backend_pid() AS pid, current_user AS role')).rows[0]));
  assert.ok(identities.every((row) => row.role === 'service_role'));
  assert.equal(new Set(identities.map((row) => row.pid)).size, 12);
  evidence.backend_pids = identities.map((row) => row.pid);
  const before = (await control.query('SELECT (wallet_balance*100)::bigint::text AS cents FROM vida_aide.profiles WHERE id=$1', [referrerId])).rows[0];
  const notificationsBefore = Number((await control.query("SELECT count(*) AS n FROM vida_aide.notifications WHERE user_id=$1 AND type='referral'", [referrerId])).rows[0].n);
  let arrived = 0, release, abort;
  const barrier = new Promise((resolve, reject) => { release = resolve; abort = reject; });
  barrier.catch(() => {});
  await control.query('BEGIN');
  assert.equal((await control.query('SELECT id FROM vida_aide.profiles WHERE id=$1 FOR UPDATE', [blockProfileId])).rowCount, 1);
  const pending = workers.map(async (client, index) => {
    const args = variants[index], trace = { event_id: args.p_event_id, session_id: args.p_object_id, attempts: 0, serialization_retries: 0, revisions: [] };
    evidence.workers[index] = trace;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      try {
        // Every retry rereads actual committed state. The synthetic provider state is stable.
        const target = await client.query('SELECT stripe_state_revision::text AS revision FROM vida_aide.profiles WHERE id=$1', [args.p_profile_id]);
        assert.equal(target.rowCount, 1);
        const revision = target.rows[0].revision;
        assert.match(revision, /^\d+$/);
        trace.revisions.push(revision); trace.attempts += 1;
        if (attempt === 0) { arrived += 1; if (arrived === 12) release(); await barrier; }
        const result = await client.query(rpc, values(args, revision));
        assert.equal(result.rowCount, 1);
        trace.receipt = result.rows[0].receipt;
        return trace.receipt;
      } catch (error) {
        if (error.code !== '40001') { abort(error); throw error; }
        trace.serialization_retries += 1;
        if (attempt === 31) throw new Error('Bounded serialization retries exhausted');
        await sleep(5 + index);
      }
    }
    throw new Error('No durable receipt');
  });
  const settlement = Promise.allSettled(pending);
  // Observe all 12 requests inside PostgreSQL before releasing the blocking row.
  let overlapError;
  try { evidence.overlap = await observeLockOverlap(control, evidence.backend_pids); }
  catch (error) { overlapError = error; abort(error); }
  finally { await control.query('ROLLBACK'); }
  const completed = await settlement;
  const workerFailure = completed.find((result) => result.status === 'rejected');
  const closed = await Promise.allSettled(workers.map(closeClient));
  if (overlapError || workerFailure) throw overlapError || workerFailure.reason;
  const closeFailure = closed.find((result) => result.status === 'rejected');
  if (closeFailure) throw closeFailure.reason;
  const results = completed.map((result) => result.value);
  const eventIds = [...new Set(variants.map((args) => args.p_event_id))], sessionIds = [...new Set(variants.map((args) => args.p_object_id))];
  const committed = await control.query('SELECT event_id,receipt FROM vida_aide.stripe_events WHERE event_id=ANY($1::text[])', [eventIds]);
  assert.equal(committed.rowCount, eventIds.length);
  for (const [index, result] of results.entries()) {
    const args = variants[index], stored = committed.rows.find((row) => row.event_id === args.p_event_id)?.receipt;
    assert.equal(stored.duplicate, false); assert.equal(result.event_id, args.p_event_id);
    assert.deepEqual(result, { ...stored, duplicate: result.duplicate });
    assert.equal(result.version, 1); assert.equal(result.status, 'applied');
    assert.equal(result.profile_id, args.p_profile_id); assert.equal(result.object_id, args.p_object_id);
    assert.equal(result.payload_hash, args.p_payload_hash); assert.equal(result.event_type, args.p_event_type);
    assert.equal(typeof result.duplicate, 'boolean');
    for (const key of ['payment_id', 'wallet_transaction_id']) assert.match(result[key], /^[0-9a-f-]{36}$/i);
  }
  assert.equal(results.filter((result) => result.duplicate).length, expectedDuplicates);
  const payments = await control.query('SELECT id,user_id,stripe_checkout_id,(amount*100)::bigint::text AS cents,currency,status FROM vida_aide.payments WHERE stripe_checkout_id=ANY($1::text[])', [sessionIds]);
  const ledger = await control.query('SELECT id,user_id,stripe_checkout_id,(amount*100)::bigint::text AS cents,status FROM vida_aide.wallet_transactions WHERE stripe_checkout_id=ANY($1::text[])', [sessionIds]);
  assert.equal(payments.rowCount, expectedCredits); assert.equal(ledger.rowCount, expectedCredits);
  const commission = (BigInt(variants[0].p_checkout.amount_total) + 1n) / 2n;
  for (const row of payments.rows) {
    const args = variants.find((value) => value.p_object_id === row.stripe_checkout_id);
    assert.equal(row.user_id, args.p_profile_id); assert.equal(BigInt(row.cents), BigInt(args.p_checkout.amount_total));
    assert.equal(row.currency, 'eur'); assert.equal(row.status, 'succeeded');
  }
  for (const row of ledger.rows) { assert.equal(row.user_id, referrerId); assert.equal(BigInt(row.cents), commission); assert.equal(row.status, 'completed'); }
  for (const result of results) {
    assert.ok(payments.rows.some((row) => row.id === result.payment_id && row.stripe_checkout_id === result.object_id));
    assert.ok(ledger.rows.some((row) => row.id === result.wallet_transaction_id && row.stripe_checkout_id === result.object_id));
  }
  const after = (await control.query('SELECT (wallet_balance*100)::bigint::text AS cents FROM vida_aide.profiles WHERE id=$1', [referrerId])).rows[0];
  assert.equal(BigInt(after.cents), BigInt(before.cents) + commission * BigInt(expectedCredits));
  const notificationsAfter = Number((await control.query("SELECT count(*) AS n FROM vida_aide.notifications WHERE user_id=$1 AND type='referral'", [referrerId])).rows[0].n);
  assert.equal(notificationsAfter - notificationsBefore, expectedCredits);
  if (name === 'distinct_events_same_session') assert.ok(evidence.workers.reduce((sum, worker) => sum + worker.serialization_retries, 0) >= 11);
  Object.assign(evidence, { status: 'PASS', event_rows: committed.rowCount, payment_rows: payments.rowCount, wallet_rows: ledger.rowCount,
    notification_rows: notificationsAfter - notificationsBefore, balance_before_cents: before.cents, balance_after_cents: after.cents });
  save(); console.log(JSON.stringify({ scenario: name, status: 'PASS', calls: 12, credits: expectedCredits }));
}
async function main(context) {
  const { control, contents, receipt, output, environment, dependencies } = context;
  for (const name of ['verification/profiles-permissions/setup.sql', 'schema.sql', 'verification/stripe-fulfillment/seed.sql',
    'migrations/0004_profiles_client_permissions.sql', 'migrations/0005_stripe_atomic_fulfillment.sql']) await control.query(contents[name].toString());
  await control.query('SET ROLE authenticated');
  assert.equal((await control.query("SELECT row_security_active('vida_aide.profiles') AS active")).rows[0].active, true);
  await control.query('RESET ROLE');
  const emitted = spawnSync(process.execPath, ['--preserve-symlinks', '--max-old-space-size=256', path.join(__dirname, 'emit-fixture.cjs')], {
    cwd: repository, encoding: 'utf8', timeout: 30000, env: { ...environment, VIDA_AIDE_VERIFICATION_NODE_MODULES: dependencies,
      ...(process.env.VIDA_AIDE_STRIPE_NODE_MODULES ? { VIDA_AIDE_STRIPE_NODE_MODULES: process.env.VIDA_AIDE_STRIPE_NODE_MODULES } : {}) } });
  fs.writeFileSync(path.join(output, 'fixture-stderr.log'), emitted.stderr || '');
  if (emitted.error || emitted.status !== 0) throw new Error('Actual signed handler fixture emission failed');
  const fixture = JSON.parse(emitted.stdout);
  fs.writeFileSync(path.join(output, 'actual-handler-fixture.json'), JSON.stringify(fixture, null, 2) + '\n');
  assert.equal(fixture.p_checkout.payment_status, 'paid'); assert.equal(fixture.p_checkout.currency, 'eur');
  assert.equal(fixture.p_checkout.referral_code, 'REFTEST'); assert.ok(Number.isSafeInteger(fixture.p_checkout.amount_total) && fixture.p_checkout.amount_total > 0);
  const moment = (await control.query('SELECT ceil(extract(epoch FROM activated_at))::bigint+1 AS epoch FROM vida_aide.stripe_fulfillment_settings')).rows[0].epoch;
  const referrerId = (await control.query("SELECT id FROM vida_aide.profiles WHERE referral_code='REFTEST'")).rows[0].id;
  function variant(event, session, index) {
    const args = structuredClone(fixture);
    Object.assign(args, { p_event_id: event, p_object_id: session, p_event_created: Number(moment) });
    Object.assign(args.p_checkout, { id: session, created: Number(moment), payment_id: 'pi_' + session });
    if (index !== undefined) {
      args.p_profile_id = '10000000-0000-4000-8000-' + String(100 + index).padStart(12, '0');
      args.p_checkout.customer_id = args.p_subscription.customer_id = 'cus_parallel_' + index;
      args.p_checkout.subscription_id = args.p_subscription.id = 'sub_parallel_' + index;
    }
    args.p_payload_hash = hash(JSON.stringify({ event, checkout: args.p_checkout, subscription: args.p_subscription, profile: args.p_profile_id }));
    return args;
  }
  const same = Array.from({ length: 12 }, () => variant('evt_parallel_same', 'cs_parallel_same'));
  const differentEvents = Array.from({ length: 12 }, (_, i) => variant('evt_parallel_relay_' + i, 'cs_parallel_relay'));
  const differentPayers = Array.from({ length: 12 }, (_, i) => variant('evt_parallel_payer_' + i, 'cs_parallel_payer_' + i, i));
  for (const [index, args] of differentPayers.entries()) {
    const authId = 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(100 + index).padStart(12, '0');
    await control.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [authId, `payer-${index}@example.invalid`]);
    assert.equal((await control.query('UPDATE vida_aide.profiles SET id=$1 WHERE auth_user_id=$2', [args.p_profile_id, authId])).rowCount, 1);
  }
  fs.writeFileSync(path.join(output, 'derived-concurrency-fixtures.json'), JSON.stringify({ same, differentEvents, differentPayers }, null, 2) + '\n');
  receipt.fixture_note = 'Actual signed handler normalization; only synthetic identity/time variants for concurrent SQL. Provider state remains fixed on retry.';
  await scenario(context, 'same_event', same, referrerId, fixture.p_profile_id, 1, 11);
  await scenario(context, 'distinct_events_same_session', differentEvents, referrerId, fixture.p_profile_id, 1, 0);
  await scenario(context, 'distinct_sessions_shared_wallet', differentPayers, referrerId, referrerId, 12, 0);
  assert.equal((await control.query("SELECT count(*)::int AS n FROM vida_aide.payments WHERE stripe_checkout_id IS NOT NULL")).rows[0].n, 14);
  assert.equal((await control.query("SELECT count(*)::int AS n FROM vida_aide.wallet_transactions WHERE stripe_checkout_id IS NOT NULL")).rows[0].n, 14);
  assert.equal((await control.query("SELECT to_jsonb(p)-'stripe_checkout_id'=h.row AS preserved FROM vida_aide.payments p CROSS JOIN stripe_test.historical_payments h WHERE stripe_payment_id='sub_historical'")).rows[0].preserved, true);
  assert.equal((await control.query('SELECT total_money_recovered::text AS amount FROM vida_aide.profiles WHERE id=$1', [fixture.p_profile_id])).rows[0].amount, '1234.56');
  assert.equal((await control.query('SELECT total_money_recovered::text AS amount FROM vida_aide.profiles WHERE id=$1', [referrerId])).rows[0].amount, '789.01');
}
runLocalPostgres({ repository, sources, mode: 'real local PostgreSQL UNIX socket; 12 independent sessions' }, main)
  .catch((error) => { console.error(error.message); process.exitCode = 1; });
