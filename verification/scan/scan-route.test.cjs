const test = require('node:test');
const assert = require('node:assert/strict');
const { createScanHarness, ids, item, modelResult } = require('./scan-route-harness.cjs');

async function submit(harness, request = harness.request()) {
  const response = await harness.POST(request);
  return { response, body: await response.json() };
}
function assertBeforeProvider(harness) {
  assert.equal(harness.calls.provider.length, 0, 'no paid model call');
  assert.equal(harness.calls.inserts.length, 0, 'no inserted rows');
  assert.equal(harness.calls.updates.length, 0, 'no profile mutation');
}
function assertBeforeProfile(harness) {
  assert.equal(harness.calls.updates.length, 0, 'no profile mutation without scan receipt');
  assert.equal(harness.calls.inserts.filter((q) => q.table === 'notifications').length, 0);
}
function assertFailedAttempt(harness, code) {
  assert.equal(harness.calls.inserts.filter((q) => q.table === 'scans').length, 1, 'one quota reservation');
  assert.equal(harness.calls.finalizations.length, 0, 'no invalid final result');
  const row = harness.state.scans.get(ids.scan);
  assert.equal(row.status, 'failed');
  assert.equal(row.failure_code, code);
  assert.deepEqual(row.results, []);
  assert.equal(row.total_recoverable, 0);
  assertBeforeProfile(harness);
}

test('an estimate is saved as a scan without rewriting historical money or crediting a wallet', async () => {
  const h = createScanHarness();
  const historical = structuredClone(h.state.savedProfile);
  const { response, body } = await submit(h);
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.scan_id, ids.scan);
  assert.deepEqual(body.results, modelResult.results);
  for (const field of ['total_money_recovered', 'wallet_balance', 'purama_points']) {
    assert.equal(h.state.savedProfile[field], historical[field], `${field} stays untouched`);
    assert.ok(h.calls.updates.every((q) => !(field in q.data)), `${field} is never in an UPDATE`);
  }
  assert.equal(h.calls.inserts.filter((q) => q.table === 'scans').length, 1);
  assert.ok(h.calls.inserts.every((q) => ['scans', 'notifications'].includes(q.table)));
  const notice = h.calls.inserts.find((q) => q.table === 'notifications').data.body;
  assert.match(notice, /estimation/i);
});

test('success is derived from the persisted scan receipt, including stored decimal rounding', async () => {
  const h = createScanHarness({
    providerResult: { ...modelResult, results: [{ ...item, montant_estime: 100.0004 }], total_recoverable: 1200.0048, total_recoverable_monthly: 100.0004 },
    scanReply: (receipt) => ({ data: {
      ...receipt, total_recoverable: 1200, total_recoverable_monthly: 100,
      results: [{ ...item, montant_estime: 100 }], ai_summary: 'Synthèse enregistrée.',
    }, error: null }),
  });
  const { response, body } = await submit(h);
  assert.equal(response.status, 200);
  assert.equal(body.total_recoverable, 1200);
  assert.equal(body.total_recoverable_monthly, 100);
  assert.equal(body.summary, 'Synthèse enregistrée.');
  assert.equal(body.results[0].montant_estime, 100);
  const finalization = h.calls.rpc.find((q) => q.name === 'finish_scan_v1');
  assert.equal(finalization.args.p_request_id, ids.scan);
  assert.equal(finalization.args.p_auth_user_id, ids.user);
  assert.equal(finalization.args.p_type, 'financial');
  assert.deepEqual(finalization.args.p_input_data, { emploi: 'salarie', revenus_mensuels_nets: 1500 });
});

test('cookie authentication verifies the user without an explicit token', async () => {
  const h = createScanHarness();
  assert.equal((await submit(h)).response.status, 200);
  assert.deepEqual(h.calls.auth, [[]]);
  const query = h.calls.queries.find((q) => q.table === 'profiles');
  assert.ok(query.operations.some(([op, key, value]) => op === 'eq' && key === 'auth_user_id' && value === ids.user));
});

test('native Bearer authentication verifies exactly the supplied token', async () => {
  const h = createScanHarness();
  const { response } = await submit(h, h.request(undefined, { Authorization: 'Bearer synthetic-session-token' }));
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls.auth, [['synthetic-session-token']]);
});

for (const header of ['Basic synthetic', 'Bearer', 'Bearer one two', 'Bearer token, Bearer other']) {
  test(`malformed authorization is rejected without using a cookie session: ${header}`, async () => {
    const h = createScanHarness();
    assert.equal((await submit(h, h.request(undefined, { Authorization: header }))).response.status, 401);
    assert.equal(h.calls.auth.length, 0);
    assertBeforeProvider(h);
  });
}

for (const token of [undefined, 'Bearer rejected-token']) {
  test(`auth error wins over a returned user (${token ? 'Bearer' : 'cookie'})`, async () => {
    const h = createScanHarness({ authResult: { data: { user: { id: ids.user } }, error: { message: 'expired' } } });
    const { response } = await submit(h, h.request(undefined, token ? { Authorization: token } : {}));
    assert.equal(response.status, 401);
    assert.equal(h.calls.auth.length, 1, 'no fallback authentication attempt');
    assert.equal(h.calls.queries.length, 0);
    assertBeforeProvider(h);
  });
}

test('no session is rejected without invoking the provider', async () => {
  const h = createScanHarness({ authResult: { data: { user: null }, error: null } });
  assert.equal((await submit(h)).response.status, 401);
  assertBeforeProvider(h);
});

test('an unavailable auth verifier fails closed without exposing its error', async () => {
  const h = createScanHarness({ authThrow: new Error('private-auth-diagnostic') });
  const { response, body } = await submit(h);
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(body), /private-auth-diagnostic/);
  assertBeforeProvider(h);
});

test('invalid request is refused before profile lookup and paid work', async () => {
  const h = createScanHarness();
  assert.equal((await submit(h, h.request({ situation: {} }))).response.status, 400);
  assert.equal(h.calls.queries.length, 0);
  assertBeforeProvider(h);
});

test('a failed profile read is unavailable even when stale data accompanies the error', async () => {
  const h = createScanHarness();
  h.state.profileResult.error = { message: 'private-db-diagnostic' };
  const { response, body } = await submit(h);
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(body), /private-db-diagnostic/);
  assertBeforeProvider(h);
});

test('a missing profile has a distinct not-found response', async () => {
  const h = createScanHarness({ profileResult: { data: null, error: null } });
  assert.equal((await submit(h)).response.status, 404);
  assertBeforeProvider(h);
});

for (const delta of [
  { subscription_plan: 'unknown' }, { subscription_plan: null }, { role: 'administrator' },
  { id: 'not-a-profile-id' }, { auth_user_id: ids.other },
]) {
  test(`invalid profile cannot obtain premium admission: ${JSON.stringify(delta)}`, async () => {
    const h = createScanHarness();
    Object.assign(h.state.profileResult.data, delta);
    assert.equal((await submit(h)).response.status, 503);
    assertBeforeProvider(h);
  });
}

for (const quotaResult of [
  { count: 0, error: { message: 'unavailable' } }, { count: null, error: null },
  { count: -1, error: null }, { count: 0.5, error: null }, { count: '0', error: null },
]) {
  test(`an unreadable quota is never treated as zero: ${JSON.stringify(quotaResult)}`, async () => {
    const h = createScanHarness({ quotaResult });
    assert.equal((await submit(h)).response.status, 503);
    assertBeforeProvider(h);
  });
}

test('quota exactly at the existing limit refuses paid work', async () => {
  const h = createScanHarness({ quotaResult: { count: 5, error: null } });
  const { response, body } = await submit(h);
  assert.equal(response.status, 429);
  assert.equal(body.code, 'scan_daily_limit');
  assertBeforeProvider(h);
});

test('the last admitted free scan finalizes the reserved owner and identity', async () => {
  const h = createScanHarness({ quotaResult: { count: 4, error: null } });
  const before = Date.now();
  assert.equal((await submit(h)).response.status, 200);
  const reservation = h.calls.rpc.find((q) => q.name === 'reserve_scan_v1');
  assert.equal(reservation.args.p_auth_user_id, ids.user);
  assert.equal(reservation.args.p_request_id, ids.scan);
  const stored = h.state.scans.get(ids.scan);
  assert.equal(stored.user_id, ids.profile);
  assert.equal(stored.status, 'completed');
  assert.ok(Date.parse(stored.created_at) >= before && Date.parse(stored.created_at) <= Date.now());
});

for (const entitlement of [{ subscription_plan: 'premium' }, { role: 'super_admin' }]) {
  test(`existing premium entitlement is preserved: ${JSON.stringify(entitlement)}`, async () => {
    const h = createScanHarness({ quotaResult: { count: 999, error: { message: 'unused' } } });
    Object.assign(h.state.profileResult.data, entitlement);
    assert.equal((await submit(h)).response.status, 200);
    assert.equal(h.calls.provider[0][2], 'premium');
    assert.ok(!h.calls.queries.some((q) => q.operations.some(([op, , options]) => op === 'select' && options?.count)));
  });
}

test('provider diagnostics never reach the client', async () => {
  const h = createScanHarness({ providerThrow: new Error('provider-secret-key-and-private-situation') });
  const { response, body } = await submit(h);
  assert.equal(response.status, 502);
  assert.doesNotMatch(JSON.stringify(body), /provider-secret|private-situation/);
  assertFailedAttempt(h, 'provider_unavailable');
});

for (const result of [
  null, { ...modelResult, total_recoverable: -1 }, { ...modelResult, total_recoverable: Infinity },
  { ...modelResult, total_recoverable: 10000000000 }, { ...modelResult, total_recoverable_monthly: '100' },
  { ...modelResult, results: [{}] }, { ...modelResult, results: [{ ...item, montant_estime: -1 }] },
  { ...modelResult, results: [{ ...item, unite: 'jour' }] },
  { ...modelResult, results: [{ ...item, lien_officiel: 'javascript:alert(1)' }] },
  { ...modelResult, summary: null },
]) {
  test(`malformed model output cannot finalize its reserved scan: ${JSON.stringify(result)}`, async () => {
    const h = createScanHarness({ providerResult: result });
    assert.equal((await submit(h)).response.status, 502);
    assertFailedAttempt(h, 'invalid_model_result');
  });
}

for (const delta of [
  { id: '' }, { id: 'not-a-scan-id' }, { user_id: ids.other }, { type: 'fiscal' },
  { status: 'processing' }, { total_recoverable: -1 }, { total_recoverable_monthly: null },
  { results: [{}] }, { ai_summary: null },
]) {
  test(`a nonconforming persisted receipt cannot produce success: ${JSON.stringify(delta)}`, async () => {
    const h = createScanHarness({ scanReply: (receipt) => ({ data: { ...receipt, ...delta }, error: null }) });
    const { response, body } = await submit(h);
    assert.equal(response.status, 500);
    assert.notEqual(body.ok, true);
    assert.equal(body.code, 'scan_save_unconfirmed');
    assertBeforeProfile(h);
  });
}

test('a database error accompanying a receipt remains unconfirmed', async () => {
  const h = createScanHarness({ scanReply: (receipt) => ({ data: receipt, error: { message: 'private-db-error' } }) });
  const { response, body } = await submit(h);
  assert.equal(response.status, 500);
  assert.equal(body.code, 'scan_save_unconfirmed');
  assert.doesNotMatch(JSON.stringify(body), /private-db-error/);
  assertBeforeProfile(h);
});

test('a lost reservation response performs no paid call or bookkeeping side effects', async () => {
  const h = createScanHarness({ rpc: async (name, args, run) => {
    const reply = await run(name, args);
    if (name === 'reserve_scan_v1') throw new Error('lost reservation response');
    return reply;
  } });
  const { response, body } = await submit(h);
  assert.equal(response.status, 503);
  assert.equal(body.code, 'scan_reservation_unconfirmed');
  assert.equal(h.calls.provider.length, 0);
  assert.equal(h.state.scans.get(ids.scan).status, 'processing');
  assertBeforeProfile(h);
});

test('a confirmed scan stays available when profile or notification bookkeeping fails', async () => {
  const h = createScanHarness({ profileUpdateError: { message: 'profile unavailable' }, notificationError: { message: 'notification unavailable' } });
  const { response, body } = await submit(h);
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.scan_id, ids.scan);
  assert.deepEqual(body.warnings, ['profile_update_failed', 'notification_failed']);
  assert.equal(h.calls.provider.length, 1);
});

test('a thrown ancillary request does not turn a saved scan into an invitation to rerun it', async () => {
  const h = createScanHarness({ query: async (q, run) => {
    if (q.table === 'profiles' && q.operations.some(([op]) => op === 'update')) throw new Error('profile response lost');
    if (q.table === 'notifications') throw new Error('notification response lost');
    return run(q);
  } });
  const { response, body } = await submit(h);
  assert.equal(response.status, 200);
  assert.equal(body.scan_id, ids.scan);
  assert.deepEqual(body.warnings, ['profile_update_failed', 'notification_failed']);
});

