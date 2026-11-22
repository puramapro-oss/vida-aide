const test = require('node:test');
const assert = require('node:assert/strict');
const { createContestHarness, withSecret, secret, uuid, profiles, contestId } = require('./harness.cjs');

async function invoke(options = {}, method = 'POST') {
  const harness = createContestHarness(options);
  const response = await withSecret(secret, () => harness[method](harness.request(method)));
  assert.equal(harness.calls.forbiddenWrites.length, 0, 'The handler must use only the settlement RPC for writes');
  return { harness, response, body: await response.json() };
}
function unconfirmed(result, expectedRpc = 0) {
  assert.equal(result.response.status, 500);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.processed ?? 0, 0);
  assert.equal(result.harness.calls.rpc.length, expectedRpc);
  assert.ok(!JSON.stringify(result.body).includes('private_fixture_error'), 'Database diagnostics must not escape');
}

test('real cron preserves ten existing allocations, rounding, ranking and one atomic write', async () => {
  const result = await invoke();
  assert.equal(result.response.status, 200); assert.equal(result.body.ok, true);
  assert.deepEqual(result.body.results, [{ contest_id: contestId, winners_count: 10, total_paid_cents: 10000, duplicate: false }]);
  assert.equal(result.harness.calls.rpc.length, 1);
  const { name, args } = result.harness.calls.rpc[0];
  assert.equal(name, 'settle_weekly_contest_v1');
  assert.equal(args.p_contest_id, contestId); assert.equal(args.p_expected_pool, 10003);
  assert.equal(args.p_expected_end, result.harness.state.contests[0].end_date);
  assert.deepEqual(args.p_winners.map((winner) => winner.amount_cents), [3300, 1700, 1200, 800, 700, 500, 450, 450, 450, 450]);
  assert.deepEqual(args.p_winners.map((winner) => [winner.rank, winner.user_id, winner.score]), profiles.map((profile, index) => [index + 1, profile.id, 11 - index]));
  const contestRead = result.harness.calls.reads.find((read) => read.table === 'contests');
  assert.ok(contestRead.operations.some((op) => op[0] === 'eq' && op[1] === 'type' && op[2] === 'weekly'));
  assert.ok(contestRead.operations.some((op) => op[0] === 'eq' && op[1] === 'status' && op[2] === 'live'));
  assert.ok(contestRead.operations.some((op) => op[0] === 'lte' && op[1] === 'end_date'));
});

test('weights, completed scans and stable tied ranking remain the existing business rules', async () => {
  const candidates = profiles.slice(0, 3).map((profile) => ({ ...profile, streak_days: 0, level: 0 }));
  const result = await invoke({ profiles: candidates,
    referrals: [{ referrer_id: uuid(2) }], mission_completions: [{ user_id: uuid(1) }, { user_id: uuid(1) }],
    scans: [{ user_id: uuid(1), status: 'completed' }, { user_id: uuid(1), status: 'completed' },
      { user_id: uuid(3), status: 'processing' }, { user_id: uuid(3), status: 'failed' }],
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.harness.calls.rpc[0].args.p_winners.map((winner) => [winner.user_id, winner.score, winner.amount_cents]),
    [[uuid(1), 10, 3300], [uuid(2), 10, 1700]]);
  assert.ok(result.harness.calls.reads.find((read) => read.table === 'scans').operations.some((op) => op[0] === 'eq' && op[1] === 'status' && op[2] === 'completed'));
});

test('fewer winners leave the undistributed remainder and no candidates still require a receipt', async () => {
  const two = await invoke({ profiles: profiles.slice(0, 2) });
  assert.equal(two.body.results[0].total_paid_cents, 5000);
  const empty = await invoke({ profiles: [] });
  assert.equal(empty.response.status, 200); assert.equal(empty.harness.calls.rpc.length, 1);
  assert.deepEqual(empty.harness.calls.rpc[0].args.p_winners, []);
  assert.deepEqual(empty.body.results, [{ contest_id: contestId, winners_count: 0, total_paid_cents: 0, duplicate: false }]);
  assert.deepEqual(empty.harness.calls.reads.map((read) => read.table), ['contests', 'profiles']);
});

test('a zero pool records participation without fabricating money', async () => {
  const harness = createContestHarness();
  harness.state.contests[0].total_pool_cents = 0;
  const result = await invoke({ contests: harness.state.contests });
  assert.equal(result.response.status, 200); assert.equal(result.body.results[0].total_paid_cents, 0);
  assert.ok(result.harness.calls.rpc[0].args.p_winners.every((winner) => winner.amount_cents === 0));
});

test('no ended contest is a confirmed empty read, without any settlement', async () => {
  const result = await invoke({ contests: [] }, 'GET');
  assert.equal(result.response.status, 200); assert.equal(result.body.processed, 0);
  assert.equal(result.harness.calls.rpc.length, 0);
});

for (const table of ['contests', 'profiles', 'referrals', 'mission_completions', 'scans']) {
  for (const failure of ['error_with_data', 'null_data', 'wrong_shape']) {
    test(`${table}: ${failure} never closes or reports a successful contest`, async () => {
      const data = failure === 'null_data' ? null : failure === 'wrong_shape' ? {} : [];
      const error = failure === 'error_with_data' ? { message: 'private_fixture_error', code: 'fixture' } : null;
      unconfirmed(await invoke({ reads: { [table]: { data, error } } }));
    });
  }
}

for (const [label, options] of [
  ['duplicate profile', { profiles: [profiles[0], profiles[0]] }],
  ['invalid profile identity', { profiles: [{ ...profiles[0], id: 'unknown' }] }],
  ['noninteger candidate score input', { profiles: [{ ...profiles[0], level: 0.5 }] }],
  ['foreign referral', { referrals: [{ referrer_id: uuid(999) }] }],
  ['foreign mission', { mission_completions: [{ user_id: uuid(999) }] }],
  ['foreign completed scan', { scans: [{ user_id: uuid(999), status: 'completed' }] }],
  ['invalid activity identity', { referrals: [{ referrer_id: {} }] }],
]) test(`${label} fails before mutation`, async () => unconfirmed(await invoke(options)));

for (const [label, patch] of [
  ['invalid id', { id: 'bad' }], ['wrong type', { type: 'daily' }], ['wrong status', { status: 'completed' }],
  ['negative pool', { total_pool_cents: -1 }], ['fractional pool', { total_pool_cents: 0.5 }],
  ['overflow pool', { total_pool_cents: 2147483648 }], ['invalid end', { end_date: 'tomorrow' }],
]) test(`invalid contest ${label} cannot reach the RPC`, async () => {
  const harness = createContestHarness(); Object.assign(harness.state.contests[0], patch);
  unconfirmed(await invoke({ contests: harness.state.contests }));
});

for (const [label, options] of [
  ['RPC error', { reply: (receipt) => ({ data: receipt, error: { message: 'private_fixture_error' } }) }],
  ['RPC throw', { rpcThrow: new Error('private_fixture_error') }],
  ['missing receipt', { reply: () => ({ data: null, error: null }) }],
]) test(`${label} cannot claim an atomic commit`, async () => unconfirmed(await invoke(options), 1));

const corruptions = {
  'wrong version': (r) => { r.version = 2; },
  'wrong contest': (r) => { r.contest_id = uuid(999); },
  'missing duplicate flag': (r) => { delete r.duplicate; },
  'wrong count': (r) => { r.winners_count -= 1; },
  'wrong total': (r) => { r.total_paid_cents -= 1; },
  'wrong rank': (r) => { r.awards[0].rank = 2; },
  'duplicate recipient': (r) => { r.awards[1].user_id = r.awards[0].user_id; },
  'changed amount with same total': (r) => { r.awards[0].amount_cents += 1; r.awards[1].amount_cents -= 1; },
  'changed first result score': (r) => { r.awards[0].score += 1; },
  'changed first result name': (r) => { r.awards[0].name = 'Changed'; },
  'pool exceeded': (r) => { r.awards[0].amount_cents += 100; r.total_paid_cents += 100; },
};
for (const [label, change] of Object.entries(corruptions)) test(`receipt ${label} is explicitly unconfirmed`, async () => {
  unconfirmed(await invoke({ reply: (receipt) => { change(receipt); return { data: receipt, error: null }; } }), 1);
});

test('a canonical duplicate reports the committed awards, not a second calculation', async () => {
  const result = await invoke({ reply: (receipt) => {
    receipt.duplicate = true; receipt.awards = receipt.awards.slice(0, 2);
    receipt.awards[0].name = 'Name at original settlement'; receipt.awards[0].score = 99;
    receipt.winners_count = 2; receipt.total_paid_cents = 5000;
    return { data: receipt, error: null };
  } });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.results, [{ contest_id: contestId, winners_count: 2, total_paid_cents: 5000, duplicate: true }]);
  assert.equal(result.harness.calls.rpc.length, 1);
});

test('one unresolved historic contest stays failed while another independent receipt is reported', async () => {
  const base = createContestHarness().state.contests[0];
  const result = await invoke({ contests: [base, { ...base, id: uuid(901) }],
    reply: (receipt) => receipt.contest_id === contestId
      ? { data: null, error: { code: 'P0001', message: 'private_fixture_error' } }
      : { data: receipt, error: null },
  });
  assert.equal(result.response.status, 500); assert.equal(result.body.ok, false);
  assert.equal(result.body.processed, 1); assert.equal(result.body.results[0].contest_id, uuid(901));
  assert.deepEqual(result.body.failed, [{ contest_id: contestId, code: 'contest_settlement_unconfirmed' }]);
  assert.equal(result.harness.calls.rpc.length, 2);
});
