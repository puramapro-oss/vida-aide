// Actual scan RPCs and actual POST on a disposable local PostgreSQL server.
// Auth, profile reads/ancillary bookkeeping and model calls remain synthetic.
// NON TESTE until the CI actually executes the simultaneous transactions.
const path = require('node:path');
const assert = require('node:assert/strict');
const { runLocalPostgres } = require('../local-postgres-fixture.cjs');
const { createScanHarness, ids, modelResult } = require('../scan/scan-route-harness.cjs');
const repository = path.resolve(__dirname, '../..');
const sources = ['schema.sql', 'migrations/0004_profiles_client_permissions.sql',
  'migrations/0005_stripe_atomic_fulfillment.sql', 'migrations/0006_scan_admission.sql',
  'verification/profiles-permissions/setup.sql', 'verification/scan-quota/concurrency.cjs',
  'verification/scan/scan-route-harness.cjs', 'verification/scan/scan-rpc-double.cjs', 'verification/package-lock.json',
  'src/app/api/scan/route.ts', 'src/lib/scan-admission.ts', 'src/lib/scan-provider.ts', 'src/lib/scan-result.ts', 'src/lib/constants.ts'];
const uuid = (index) => '00000000-0000-4000-8000-' + String(index).padStart(12, '0');
const input = { emploi: 'salarie', revenus_mensuels_nets: 1500 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function intent(owner, id, data = input) {
  return { p_auth_user_id: owner.auth, p_request_id: id, p_type: 'financial', p_input_data: data };
}
async function invoke(client, name, args) {
  const values = [args.p_auth_user_id, args.p_request_id, args.p_type, JSON.stringify(args.p_input_data)];
  let sql = 'SELECT vida_aide.reserve_scan_v1($1::uuid,$2::uuid,$3,$4::jsonb) AS result';
  if (name === 'finish_scan_v1') {
    sql = 'SELECT vida_aide.finish_scan_v1($1::uuid,$2::uuid,$3,$4::jsonb,$5::jsonb,$6) AS result';
    values.push(args.p_result == null ? null : JSON.stringify(args.p_result), args.p_failure_code ?? null);
  } else assert.equal(name, 'reserve_scan_v1', 'No alternate persistence path is allowed');
  const result = await client.query(sql, values);
  assert.equal(result.rowCount, 1);
  return result.rows[0].result;
}
async function owner(context, index, auth = uuid(100 + index), profile = uuid(200 + index)) {
  await context.control.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, `scan-${index}@example.invalid`]);
  const row = await context.control.query('UPDATE vida_aide.profiles SET id=$1,wallet_balance=25.50,total_money_recovered=9734.56,purama_points=30 WHERE auth_user_id=$2 RETURNING *', [profile, auth]);
  assert.equal(row.rowCount, 1); assert.equal(row.rows[0].subscription_plan, 'free');
  return { auth, profile, row: row.rows[0] };
}
async function seedFour(context, account, offset) {
  for (const [index, status] of ['completed', 'failed', 'processing', 'completed'].entries()) {
    await context.control.query("INSERT INTO vida_aide.scans(id,user_id,type,input_data,status,created_at) VALUES($1,$2,'financial','{}',$3,clock_timestamp()-interval '1 hour')", [uuid(offset + index), account.profile, status]);
  }
}
async function count(context, account) {
  return (await context.control.query('SELECT count(*)::int AS n FROM vida_aide.scans WHERE user_id=$1', [account.profile])).rows[0].n;
}
async function sessions(context, amount) {
  const results = await Promise.allSettled(Array.from({ length: amount }, () => context.connect(true)));
  const failed = results.find((result) => result.status === 'rejected'); if (failed) throw failed.reason;
  const clients = results.map((result) => result.value);
  const identities = await Promise.all(clients.map(async (client) => (await client.query('SELECT pg_backend_pid() AS pid,current_user AS role')).rows[0]));
  assert.ok(identities.every((row) => row.role === 'service_role'));
  assert.equal(new Set(identities.map((row) => row.pid)).size, amount);
  return { clients, pids: identities.map((row) => row.pid) };
}
async function concurrent(context, name, profiles, pool, jobs, afterUnlock) {
  const evidence = { name, status: 'RUNNING', simultaneous_sessions: pool.clients.length, backend_pids: pool.pids };
  context.receipt.scenarios.push(evidence); context.save();
  await context.control.query('BEGIN');
  assert.equal((await context.control.query('SELECT id FROM vida_aide.profiles WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [profiles])).rowCount, profiles.length);
  const pending = jobs.map((job, index) => Promise.resolve().then(() => job(pool.clients[index])));
  const settlement = Promise.allSettled(pending);
  let failure;
  try { evidence.overlap = await context.observeLockOverlap(context.control, pool.pids); }
  catch (error) { failure = error; }
  finally { await context.control.query('ROLLBACK'); }
  try { if (afterUnlock) await afterUnlock(pending); } catch (error) { failure ||= error; }
  const completed = await settlement;
  const rejected = completed.find((result) => result.status === 'rejected');
  evidence.responses = completed.map((result) => result.status === 'fulfilled' ? result.value : { error: result.reason?.message });
  context.save();
  if (failure || rejected) throw failure || rejected.reason;
  return { evidence, results: completed.map((result) => result.value) };
}
function passed(context, evidence, observations) {
  Object.assign(evidence, observations, { status: 'PASS' }); context.save();
  console.log(JSON.stringify({ scenario: evidence.name, status: evidence.status, simultaneous_sessions: evidence.simultaneous_sessions }));
}
async function close(context, pool) {
  const results = await Promise.allSettled(pool.clients.map(context.closeClient));
  const failed = results.find((result) => result.status === 'rejected'); if (failed) throw failed.reason;
}
function handler(client, account, provider) {
  return createScanHarness({ authResult: { data: { user: { id: account.auth } }, error: null },
    profileResult: { data: structuredClone(account.row), error: null }, savedProfile: structuredClone(account.row), provider,
    rpc: async (name, args) => {
      try { return { data: await invoke(client, name, args), error: null }; }
      catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    } });
}
async function post(harness, requestId) {
  const response = await harness.POST(harness.request({ request_id: requestId, type: 'financial', situation: input }));
  return { status: response.status, body: await response.json() };
}
async function main(context) {
  const { control, contents } = context;
  for (const name of ['verification/profiles-permissions/setup.sql', 'schema.sql',
    'migrations/0004_profiles_client_permissions.sql', 'migrations/0005_stripe_atomic_fulfillment.sql',
    'migrations/0006_scan_admission.sql']) await control.query(contents[name].toString());
  await control.query('SET ROLE authenticated');
  const gate = (await control.query("SELECT row_security_active('vida_aide.scans') AS active,has_function_privilege(current_user,'vida_aide.reserve_scan_v1(uuid,uuid,text,jsonb)','EXECUTE') AS can_reserve")).rows[0];
  assert.equal(gate.active, true); assert.equal(gate.can_reserve, false);
  await control.query('RESET ROLE');
  const last = await owner(context, 1), same = await owner(context, 2), crossA = await owner(context, 3), crossB = await owner(context, 4);
  const rollback = await owner(context, 5), http = await owner(context, 6, ids.user, ids.profile);
  await seedFour(context, last, 1000); await seedFour(context, rollback, 1100);
  const first = await sessions(context, 2);
  const admissions = await concurrent(context, 'last_slot_distinct_requests', [last.profile], first,
    [1200, 1201].map((id) => (client) => invoke(client, 'reserve_scan_v1', intent(last, uuid(id)))));
  assert.deepEqual(admissions.results.map((result) => result.outcome).sort(), ['quota_exceeded', 'reserved']);
  const rejected = admissions.results.find((result) => result.outcome === 'quota_exceeded');
  assert.equal(rejected.limit, 5); assert.equal(rejected.used, 5); assert.equal(rejected.scan, undefined);
  const admitted = admissions.results.find((result) => result.outcome === 'reserved');
  assert.equal(admitted.scan.user_id, last.profile); assert.equal(admitted.scan.status, 'processing');
  assert.equal(await count(context, last), 5);
  assert.equal(Number((await control.query('SELECT extract(epoch FROM processing_expires_at-created_at) AS seconds FROM vida_aide.scans WHERE id=$1', [admitted.scan.id])).rows[0].seconds), 300);
  passed(context, admissions.evidence, { admitted: 1, rejected: 1, persisted_total: 5 }); await close(context, first);

  const repeated = await sessions(context, 12), sameId = uuid(1300);
  const replays = await concurrent(context, 'same_key_twelve_requests', [same.profile], repeated,
    repeated.clients.map(() => (client) => invoke(client, 'reserve_scan_v1', intent(same, sameId))));
  assert.equal(replays.results.filter((result) => result.outcome === 'reserved').length, 1);
  assert.equal(replays.results.filter((result) => result.outcome === 'in_progress').length, 11);
  const durable = (await control.query('SELECT to_jsonb(s) AS row FROM vida_aide.scans s WHERE id=$1', [sameId])).rows[0].row;
  for (const result of replays.results) { assert.deepEqual(result.scan, durable); assert.equal(result.plan, 'free'); }
  assert.equal(await count(context, same), 1);
  assert.deepEqual(await invoke(repeated.clients[0], 'reserve_scan_v1', intent(same, sameId, { ...input, revenus_mensuels_nets: 42 })), { version: 1, outcome: 'conflict' });
  passed(context, replays.evidence, { admitted: 1, in_progress: 11, persisted_total: 1 });
  const finishPool = { clients: repeated.clients.slice(0, 2), pids: repeated.pids.slice(0, 2) };
  const finishes = await concurrent(context, 'competing_finalization_keeps_first_receipt', [same.profile], finishPool, [
    (client) => invoke(client, 'finish_scan_v1', { ...intent(same, sameId), p_result: modelResult, p_failure_code: null }),
    (client) => invoke(client, 'finish_scan_v1', { ...intent(same, sameId), p_result: null, p_failure_code: 'provider_timeout' }),
  ]);
  assert.equal(finishes.results.filter((result) => result.changed === true).length, 1);
  assert.equal(finishes.results.filter((result) => result.changed === false).length, 1);
  const finalScan = (await control.query('SELECT to_jsonb(s) AS row FROM vida_aide.scans s WHERE id=$1', [sameId])).rows[0].row;
  assert.ok(['completed', 'failed'].includes(finalScan.status));
  for (const result of finishes.results) { assert.deepEqual(result.scan, finalScan); assert.equal(result.outcome, finalScan.status); }
  assert.equal(await count(context, same), 1);
  passed(context, finishes.evidence, { changed_once: true, persisted_status: finalScan.status, persisted_total: 1 });
  await close(context, repeated);

  const crossed = await sessions(context, 2), crossedId = uuid(1400);
  const accounts = [crossA, crossB];
  const owners = await concurrent(context, 'same_uuid_different_accounts', accounts.map((account) => account.profile), crossed,
    accounts.map((account) => (client) => invoke(client, 'reserve_scan_v1', intent(account, crossedId))));
  assert.deepEqual(owners.results.map((result) => result.outcome).sort(), ['conflict', 'reserved']);
  assert.deepEqual(owners.results.find((result) => result.outcome === 'conflict'), { version: 1, outcome: 'conflict' });
  const winningIndex = owners.results.findIndex((result) => result.outcome === 'reserved'), losingIndex = 1 - winningIndex;
  assert.equal(owners.results[winningIndex].scan.user_id, accounts[winningIndex].profile);
  assert.equal(await count(context, accounts[winningIndex]), 1); assert.equal(await count(context, accounts[losingIndex]), 0);
  assert.deepEqual(await invoke(crossed.clients[losingIndex], 'reserve_scan_v1', intent(accounts[losingIndex], crossedId)), { version: 1, outcome: 'conflict' });
  passed(context, owners.evidence, { admitted: 1, conflicts: 1, persisted_total: 1, other_owner_data_disclosed: false }); await close(context, crossed);

  await control.query(`CREATE FUNCTION profile_test.fail_scan_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF current_setting('profile_test.fail_scan',true)='yes' THEN RAISE EXCEPTION 'Synthetic scan reservation failure' USING ERRCODE='22000'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER quota_test_insert BEFORE INSERT ON vida_aide.scans FOR EACH ROW EXECUTE FUNCTION profile_test.fail_scan_insert();`);
  const rollbackPool = await sessions(context, 1), rollbackClient = rollbackPool.clients[0];
  const rollbackEvidence = { name: 'real_post_reservation_rollback_and_explicit_retry', status: 'RUNNING', simultaneous_sessions: 1 };
  context.receipt.scenarios.push(rollbackEvidence); context.save();
  let rollbackProvider = 0;
  const retry = handler(rollbackClient, rollback, async () => { rollbackProvider += 1; return structuredClone(modelResult); });
  await rollbackClient.query("SET profile_test.fail_scan='yes'");
  const failure = await post(retry, uuid(1500));
  rollbackEvidence.initial_response = failure; context.save();
  assert.equal(failure.status, 503); assert.equal(failure.body.code, 'scan_reservation_unconfirmed');
  assert.equal(rollbackProvider, 0); assert.equal(await count(context, rollback), 4);
  assert.equal((await control.query('SELECT count(*)::int AS n FROM vida_aide.scans WHERE id=$1', [uuid(1500)])).rows[0].n, 0);
  await rollbackClient.query("SET profile_test.fail_scan='no'");
  const recovered = await post(retry, uuid(1500));
  assert.equal(recovered.status, 200); assert.equal(recovered.body.scan_id, uuid(1500)); assert.equal(recovered.body.ok, true);
  assert.equal(rollbackProvider, 1); assert.equal(await count(context, rollback), 5);
  const again = await post(retry, uuid(1500));
  assert.equal(again.status, 200); assert.equal(again.body.replayed, true); assert.equal(rollbackProvider, 1);
  assert.equal(retry.calls.rpc.filter((call) => call.name === 'finish_scan_v1').length, 1);
  passed(context, rollbackEvidence, { initial_provider_calls: 0, synthetic_provider_calls_after_retry: 1, persisted_total: 5 }); await close(context, rollbackPool);

  const httpPool = await sessions(context, 12), requestId = ids.scan;
  let providerCalls = 0, releaseProvider;
  const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
  const handlers = httpPool.clients.map((client) => handler(client, http, async () => {
    providerCalls += 1; await providerGate; return structuredClone(modelResult);
  }));
  const ready = [];
  const actualPost = await concurrent(context, 'real_post_same_key_one_provider', [http.profile], httpPool,
    handlers.map((harness) => async () => { const result = await post(harness, requestId); ready.push(result); return result; }),
    async () => {
      try {
        const deadline = Date.now() + 8000;
        while (ready.length < 11 && Date.now() < deadline) await sleep(10);
        assert.equal(ready.length, 11); assert.equal(providerCalls, 1);
        for (const result of ready) { assert.equal(result.status, 409); assert.equal(result.body.code, 'scan_in_progress'); assert.equal(result.body.scan_id, requestId); assert.notEqual(result.body.ok, true); }
      } finally { releaseProvider(); }
    });
  assert.equal(actualPost.results.filter((result) => result.status === 200).length, 1);
  assert.equal(actualPost.results.filter((result) => result.status === 409).length, 11);
  const success = actualPost.results.find((result) => result.status === 200).body;
  assert.equal(success.ok, true); assert.equal(success.scan_id, requestId); assert.deepEqual(success.results, modelResult.results);
  assert.equal(providerCalls, 1); assert.equal(await count(context, http), 1);
  const stored = (await control.query('SELECT * FROM vida_aide.scans WHERE id=$1', [requestId])).rows[0];
  assert.equal(stored.status, 'completed'); assert.equal(stored.user_id, http.profile); assert.deepEqual(stored.input_data, input);
  assert.deepEqual(stored.results, success.results); assert.equal(Number(stored.total_recoverable), success.total_recoverable);
  assert.equal(Number(stored.total_recoverable_monthly), success.total_recoverable_monthly); assert.equal(stored.ai_summary, success.summary);
  const replay = await post(handlers[0], requestId);
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true); assert.equal(providerCalls, 1);
  assert.deepEqual(replay.body, { ...success, replayed: true });
  assert.equal(handlers.flatMap((harness) => harness.calls.rpc).filter((call) => call.name === 'finish_scan_v1').length, 1);
  assert.equal(handlers.flatMap((harness) => harness.calls.provider).length, 1);
  passed(context, actualPost.evidence, { completed_responses: 1, in_progress_responses: 11, synthetic_provider_calls: 1, persisted_total: 1, explicit_replay_calls_provider: false });
  await close(context, httpPool);
  const amounts = await control.query('SELECT wallet_balance::text,total_money_recovered::text,purama_points FROM vida_aide.profiles');
  assert.equal(amounts.rowCount, 6);
  for (const row of amounts.rows) { assert.equal(row.wallet_balance, '25.50'); assert.equal(row.total_money_recovered, '9734.56'); assert.equal(row.purama_points, 30); }
  context.receipt.limits = ['No real model/provider call or external database.', 'Auth, profile reads and ancillary writes use explicit fixtures; admission/finalization execute real PostgreSQL RPCs.', 'Only recorded simultaneous lock waits count as concurrency evidence.'];
}
runLocalPostgres({ repository, sources, mode: 'real local PostgreSQL scan admission, isolation, rollback and actual POST bridge' }, main)
  .catch((error) => { console.error(error.message); process.exitCode = 1; });
