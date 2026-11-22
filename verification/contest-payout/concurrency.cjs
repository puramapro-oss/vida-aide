// Actual HTTP handler -> actual settlement RPCs on an isolated CI PostgreSQL.
// NON TESTE locally: only CI socket/server execution can qualify these scenarios.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { runLocalPostgres } = require('../local-postgres-fixture.cjs');
const { createContestHarness, withSecret, secret, uuid, profiles } = require('./harness.cjs');
const repository = path.resolve(__dirname, '../..');
const sources = ['schema.sql', 'migrations/0004_profiles_client_permissions.sql',
  'migrations/0005_stripe_atomic_fulfillment.sql', 'migrations/0006_scan_admission.sql',
  'migrations/0007_weekly_contest_receipts.sql', 'verification/profiles-permissions/setup.sql',
  'verification/contest-payout/seed.sql', 'verification/contest-payout/support.sql',
  'verification/contest-payout/cases.sql', 'verification/contest-payout/harness.cjs',
  'verification/contest-payout/emit-fixture.cjs', 'verification/contest-payout/concurrency.cjs',
  'verification/package-lock.json', 'src/app/api/cron/contest-weekly/route.ts'];

async function sessions(context) {
  const settled = await Promise.allSettled([context.connect(true), context.connect(true)]);
  const rejected = settled.find((result) => result.status === 'rejected'); if (rejected) throw rejected.reason;
  const clients = settled.map((result) => result.value);
  const ids = await Promise.all(clients.map(async (client) => (await client.query('SELECT pg_backend_pid() AS pid,current_user AS role')).rows[0]));
  assert.ok(ids.every((row) => row.role === 'service_role'));
  assert.equal(new Set(ids.map((row) => row.pid)).size, 2);
  return { clients, pids: ids.map((row) => row.pid) };
}
function handler(client, contest, candidates) {
  const failures = [];
  const harness = createContestHarness({ contests: [contest], profiles: candidates,
    rpc: async (name, args) => {
      assert.equal(name, 'settle_weekly_contest_v1');
      try {
        const result = await client.query('SELECT vida_aide.settle_weekly_contest_v1($1::uuid,$2::integer,$3::timestamptz,$4::jsonb) AS receipt',
          [args.p_contest_id, args.p_expected_pool, args.p_expected_end, JSON.stringify(args.p_winners)]);
        assert.equal(result.rowCount, 1);
        return { data: result.rows[0].receipt, error: null };
      } catch (error) {
        failures.push({ code: error.code || null, message: error.message });
        return { data: null, error: { code: error.code, message: error.message } };
      }
    },
  });
  harness.databaseFailures = failures;
  return harness;
}
async function post(harness) {
  const response = await harness.POST(harness.request());
  assert.equal(harness.calls.forbiddenWrites.length, 0);
  assert.equal(harness.calls.rpc.length, 1);
  return { status: response.status, body: await response.json(), database_errors: harness.databaseFailures };
}
async function overlap(context, name, table, identifier, pool, handlers) {
  assert.ok(['contests', 'profiles'].includes(table));
  const evidence = { name, status: 'RUNNING', simultaneous_sessions: 2, backend_pids: pool.pids };
  context.receipt.scenarios.push(evidence); context.save();
  await context.control.query('BEGIN');
  assert.equal((await context.control.query(`SELECT id FROM vida_aide.${table} WHERE id=$1 FOR UPDATE`, [identifier])).rowCount, 1);
  const pending = handlers.map((harness) => Promise.resolve().then(() => post(harness)));
  const settled = Promise.allSettled(pending);
  let observationError;
  try { evidence.overlap = await context.observeLockOverlap(context.control, pool.pids); }
  catch (error) { observationError = error; }
  finally { await context.control.query('ROLLBACK'); }
  const completed = await settled;
  evidence.responses = completed.map((result) => result.status === 'fulfilled' ? result.value : { error: result.reason?.message });
  context.save();
  const rejected = completed.find((result) => result.status === 'rejected');
  if (observationError || rejected) throw observationError || rejected.reason;
  for (const result of completed) {
    assert.equal(result.value.status, 200); assert.equal(result.value.body.ok, true);
    assert.equal(result.value.body.processed, 1); assert.deepEqual(result.value.database_errors, []);
  }
  return evidence;
}
async function verifyContest(context, id, awards, total) {
  const stored = (await context.control.query('SELECT * FROM vida_aide.contests WHERE id=$1', [id])).rows[0];
  assert.equal(stored.status, 'completed'); assert.ok(stored.payout_tracking_started_at);
  assert.deepEqual(stored.winners, awards);
  assert.deepEqual(stored.payout_receipt, { version: 1, contest_id: id, duplicate: false,
    winners_count: awards.length, total_paid_cents: total, awards });
  const ledger = await context.control.query('SELECT * FROM vida_aide.wallet_transactions WHERE source_id=$1 ORDER BY (metadata->>\'rank\')::int', [id]);
  assert.equal(ledger.rowCount, awards.length);
  for (const [index, row] of ledger.rows.entries()) {
    const award = awards[index];
    assert.equal(row.user_id, award.user_id); assert.equal(Number(row.amount) * 100, award.amount_cents);
    assert.equal(row.status, 'completed'); assert.equal(row.type, 'contest_prize');
    assert.deepEqual(row.metadata, { contest_id: id, rank: award.rank, score: award.score, payout_version: 1 });
  }
}
async function main(context) {
  for (const name of ['verification/profiles-permissions/setup.sql', 'schema.sql', 'verification/contest-payout/seed.sql',
    'migrations/0004_profiles_client_permissions.sql', 'migrations/0005_stripe_atomic_fulfillment.sql',
    'migrations/0006_scan_admission.sql', 'migrations/0007_weekly_contest_receipts.sql']) {
    await context.control.query(context.contents[name].toString());
  }
  const emitted = spawnSync(process.execPath, ['--preserve-symlinks', '--max-old-space-size=256', path.join(__dirname, 'emit-fixture.cjs')], {
    encoding: 'utf8', timeout: 30000, env: { ...context.environment, VIDA_AIDE_VERIFICATION_NODE_MODULES: context.dependencies },
  });
  assert.equal(emitted.status, 0, emitted.stderr || emitted.error?.message);
  const fixture = JSON.parse(emitted.stdout);
  assert.equal(fixture.source_sha256['src/app/api/cron/contest-weekly/route.ts'], context.receipt.source_sha256['src/app/api/cron/contest-weekly/route.ts']);
  fs.writeFileSync(path.join(context.output, 'actual-handler-fixture.json'), JSON.stringify(fixture, null, 2) + '\n');
  await context.control.query('INSERT INTO contest_test.fixture VALUES($1::jsonb)', [JSON.stringify(fixture)]);
  await context.control.query(context.contents['verification/contest-payout/support.sql'].toString());
  await context.control.query('SET ROLE authenticated');
  const gate = (await context.control.query("SELECT row_security_active('vida_aide.contests') AS active,has_function_privilege(current_user,'vida_aide.settle_weekly_contest_v1(uuid,integer,timestamptz,jsonb)','EXECUTE') AS can_settle")).rows[0];
  assert.equal(gate.active, true); assert.equal(gate.can_settle, false);
  await context.control.query('RESET ROLE');
  const pool = await sessions(context);
  const contest = { id: fixture.args.p_contest_id, title: 'Synthetic weekly contest', type: 'weekly', status: 'live',
    total_pool_cents: fixture.args.p_expected_pool, end_date: fixture.args.p_expected_end };
  await withSecret(secret, async () => {
    const same = await overlap(context, 'two_actual_handlers_same_contest', 'contests', contest.id, pool,
      pool.clients.map((client) => handler(client, contest, structuredClone(profiles))));
    assert.deepEqual(same.responses.map((result) => result.body.results[0].duplicate).sort(), [false, true]);
    await verifyContest(context, contest.id, fixture.args.p_winners, 10000);
    const balances = (await context.control.query('SELECT id,wallet_balance::text FROM vida_aide.profiles ORDER BY id')).rows;
    assert.equal(balances.length, 10);
    balances.forEach((row, index) => assert.equal(Number(row.wallet_balance), 25.50 + fixture.args.p_winners[index].amount_cents / 100));
    assert.equal((await context.control.query("SELECT count(*)::int AS n FROM vida_aide.notifications WHERE type='contest_won'")).rows[0].n, 10);
    Object.assign(same, { status: 'PASS', committed_prizes: 10, duplicate_responses: 1 }); context.save();

    const identifiers = [uuid(930), uuid(931)];
    for (const id of identifiers) await context.control.query('SELECT contest_test.new_contest($1::uuid)', [id]);
    const distinct = await overlap(context, 'two_contests_share_one_wallet', 'profiles', profiles[0].id, pool,
      pool.clients.map((client, index) => handler(client, { ...contest, id: identifiers[index] }, [structuredClone(profiles[0])])));
    assert.ok(distinct.responses.every((result) => result.body.results[0].duplicate === false));
    for (const id of identifiers) await verifyContest(context, id, fixture.args.p_winners.slice(0, 1), 3300);
    const final = (await context.control.query('SELECT id,wallet_balance::text,total_money_recovered::text,purama_points,xp FROM vida_aide.profiles ORDER BY id')).rows;
    final.forEach((row, index) => {
      const expected = 25.50 + fixture.args.p_winners[index].amount_cents / 100 + (index === 0 ? 66 : 0);
      assert.equal(Number(row.wallet_balance), expected); assert.equal(row.total_money_recovered, '9734.56');
      assert.equal(row.purama_points, 30); assert.equal(row.xp, 101);
    });
    assert.equal(final[0].wallet_balance, '124.50');
    assert.equal((await context.control.query("SELECT count(*)::int AS n FROM vida_aide.notifications WHERE type='contest_won'")).rows[0].n, 12);
    assert.equal((await context.control.query('SELECT count(*)::int AS n FROM vida_aide.wallet_transactions WHERE source_id=ANY($1::uuid[])', [[contest.id, ...identifiers]])).rows[0].n, 12);
    Object.assign(distinct, { status: 'PASS', additional_prizes: 2, shared_wallet_final: '124.50' }); context.save();
  });
  const history = context.contents['verification/contest-payout/cases.sql'].toString().split('-- CASE: historical_rows_and_marker_preserved\n')[1];
  assert.ok(history); await context.control.query(history);
  const closed = await Promise.allSettled(pool.clients.map(context.closeClient));
  const rejected = closed.find((result) => result.status === 'rejected'); if (rejected) throw rejected.reason;
  context.receipt.limits = ['Contest/profile/activity reads and cron authorization are synthetic; the actual handler calls the real PostgreSQL settlement RPC.',
    'No provider, external database or real payment.', 'Only observed simultaneous server lock waits qualify concurrency.',
    'The independent Stripe/contest lock-order interaction is not exercised by these two scenarios.'];
}
runLocalPostgres({ repository, sources, mode: 'real local PostgreSQL concurrent contest settlement with actual HTTP handlers' }, main)
  .catch((error) => { console.error(error.message); process.exitCode = 1; });
