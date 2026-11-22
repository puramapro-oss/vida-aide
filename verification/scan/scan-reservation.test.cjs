const test = require('node:test');
const assert = require('node:assert/strict');
const { createScanHarness, ids, modelResult } = require('./scan-route-harness.cjs');
const input = { emploi: 'salarie', revenus_mensuels_nets: 1500 };
const body = (id = ids.scan, situation = input, type = 'financial') => ({ request_id: id, type, situation });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
async function submit(h, data = body()) { const response = await h.POST(h.request(data)); return { response, data: await response.json() }; }

test('two concurrent handlers cannot both spend the final free slot before calling the provider', async () => {
  const h = createScanHarness({ quotaResult: { count: 4, error: null } });
  const replies = await Promise.all([submit(h), submit(h, body(ids.other))]);
  assert.deepEqual(replies.map((r) => r.response.status).sort(), [200, 429]);
  assert.equal(h.calls.provider.length, 1);
  assert.equal(h.calls.inserts.filter((q) => q.table === 'scans').length, 1);
  assert.equal(h.calls.finalizations.length, 1);
});

test('one request identity invokes the provider once across concurrent and completed retries', async () => {
  const started = deferred(), release = deferred();
  const h = createScanHarness({ provider: async () => { started.resolve(); await release.promise; return modelResult; } });
  const first = submit(h);
  await started.promise;
  const pending = await submit(h);
  assert.equal(pending.response.status, 409);
  assert.equal(pending.data.code, 'scan_in_progress');
  assert.equal(h.calls.provider.length, 1);
  release.resolve();
  const confirmed = await first, replay = await submit(h);
  assert.equal(confirmed.response.status, 200);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.scan_id, ids.scan);
  assert.equal(h.calls.provider.length, 1);
  assert.equal(h.calls.updates.length, 1);
  assert.equal(h.calls.inserts.filter((q) => q.table === 'notifications').length, 1);
});

test('structurally identical JSON with reordered keys replays without another admission', async () => {
  const h = createScanHarness();
  await submit(h);
  const replay = await submit(h, body(ids.scan, { revenus_mensuels_nets: 1500, emploi: 'salarie' }));
  assert.equal(replay.response.status, 200);
  assert.equal(replay.data.replayed, true);
  assert.equal(h.calls.provider.length, 1);
});

for (const changed of [body(ids.scan, { revenus_mensuels_nets: 0 }), body(ids.scan, input, 'fiscal')]) {
  test(`a request identity cannot be reassigned to another input or scan type: ${changed.type}`, async () => {
    const h = createScanHarness();
    await submit(h);
    const reply = await submit(h, changed);
    assert.equal(reply.response.status, 409);
    assert.equal(reply.data.code, 'scan_request_conflict');
    assert.equal(h.calls.provider.length, 1);
    assert.equal(h.state.scans.size, 1);
  });
}

test('a UUID belonging to another owner cannot disclose or overwrite that scan', async () => {
  const first = createScanHarness();
  await submit(first);
  const second = createScanHarness({ scans: first.state.scans });
  second.state.authResult.data.user.id = ids.other;
  second.state.profileResult.data.auth_user_id = ids.other;
  second.state.profileResult.data.id = ids.other;
  const reply = await submit(second);
  assert.equal(reply.response.status, 409);
  assert.equal(reply.data.code, 'scan_request_conflict');
  assert.equal('results' in reply.data, false);
  assert.equal(second.calls.provider.length, 0);
  assert.equal(second.calls.updates.length, 0);
  assert.equal(first.state.scans.get(ids.scan).user_id, ids.profile);
});

test('a lost completion response replays the saved result without a second provider call', async () => {
  let lost = false;
  const h = createScanHarness({ rpc: async (name, args, run) => {
    const reply = await run(name, args);
    if (name === 'finish_scan_v1' && args.p_result && !lost) { lost = true; throw new Error('response lost after commit'); }
    return reply;
  } });
  assert.equal((await submit(h)).data.code, 'scan_save_unconfirmed');
  assert.equal(h.state.scans.get(ids.scan).status, 'completed');
  const replay = await submit(h);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.data.replayed, true);
  assert.equal(h.calls.provider.length, 1);
  assert.equal(h.calls.updates.length, 0, 'no invented acknowledgement of ancillary bookkeeping');
});

test('a lost reservation never authorizes retrying the provider, even after lease expiration', async () => {
  let lost = false;
  const h = createScanHarness({ quotaResult: { count: 4, error: null }, rpc: async (name, args, run) => {
    const reply = await run(name, args);
    if (name === 'reserve_scan_v1' && !lost) { lost = true; throw new Error('response lost after reservation'); }
    return reply;
  } });
  assert.equal((await submit(h)).data.code, 'scan_reservation_unconfirmed');
  assert.equal((await submit(h)).data.code, 'scan_in_progress');
  h.state.scans.get(ids.scan).processing_expires_at = new Date(Date.now() - 1).toISOString();
  assert.equal((await submit(h)).data.code, 'scan_attempt_failed');
  assert.equal(h.state.scans.get(ids.scan).failure_code, 'result_unconfirmed');
  assert.equal((await submit(h, body(ids.other))).response.status, 429);
  assert.equal(h.calls.provider.length, 0);
});

test('provider failure stays counted and cannot automatically restart with the same identity', async () => {
  const h = createScanHarness({ quotaResult: { count: 4, error: null }, providerThrow: new Error('private provider error') });
  assert.equal((await submit(h)).response.status, 502);
  assert.equal((await submit(h)).data.code, 'scan_attempt_failed');
  assert.equal((await submit(h, body(ids.other))).response.status, 429);
  assert.equal(h.calls.provider.length, 1);
});

test('a late provider result cannot finalize an expired reservation or award XP', async () => {
  let h;
  h = createScanHarness({ provider: async () => {
    h.state.scans.get(ids.scan).processing_expires_at = new Date(Date.now() - 1).toISOString();
    return modelResult;
  } });
  h.state.savedProfile.xp = 0;
  const reply = await submit(h);
  assert.equal(reply.response.status, 409);
  assert.equal(reply.data.code, 'scan_attempt_failed');
  assert.equal(h.calls.finalizations.length, 0);
  assert.equal(h.state.savedProfile.xp, 0);
  assert.deepEqual(h.state.scans.get(ids.scan).results, []);
});

test('the 100-second deadline aborts the SDK signal and prevents a late result from mutating storage', async () => {
  const started = deferred(), release = deferred();
  let timeout, cleared = false;
  const h = createScanHarness({
    setTimeout(callback, milliseconds) { assert.equal(milliseconds, 100000); timeout = callback; return {}; },
    clearTimeout() { cleared = true; },
    provider: async () => { started.resolve(); return release.promise; },
  });
  const pending = submit(h);
  await started.promise;
  timeout();
  const reply = await pending;
  assert.equal(reply.response.status, 504);
  assert.equal(reply.data.code, 'scan_provider_timeout');
  assert.equal(h.calls.provider[0][3].aborted, true);
  assert.equal(cleared, true);
  release.resolve(modelResult);
  await Promise.resolve();
  assert.equal(h.state.scans.get(ids.scan).status, 'failed');
  assert.equal(h.calls.finalizations.length, 0);
  assert.equal((await submit(h)).data.code, 'scan_attempt_failed');
  assert.equal(h.calls.provider.length, 1);
});

test('client cancellation closes the reserved attempt without automatic provider retry', async () => {
  const started = deferred(), release = deferred(), controller = new AbortController();
  const h = createScanHarness({ provider: async () => { started.resolve(); return release.promise; } });
  const pending = h.POST(new Request(h.request(body()), { signal: controller.signal }));
  await started.promise;
  controller.abort();
  const response = await pending;
  assert.equal(response.status, 499);
  assert.equal((await response.json()).code, 'scan_provider_interrupted');
  assert.equal(h.calls.provider[0][3].aborted, true);
  release.resolve(modelResult);
  await Promise.resolve();
  assert.equal(h.state.scans.get(ids.scan).failure_code, 'result_unconfirmed');
  assert.equal(h.calls.finalizations.length, 0);
});

for (const mutate of [
  (r) => { r.data.scan.id = ids.other; }, (r) => { r.data.scan.user_id = ids.other; },
  (r) => { r.data.scan.input_data = { revenus_mensuels_nets: 0 }; },
  (r) => { r.data.scan.processing_expires_at = new Date(0).toISOString(); },
  (r) => { delete r.data.plan; }, (r) => { r.error = { message: 'uncertain reservation' }; },
]) {
  test('a nonconforming reservation cannot authorize paid work: ' + mutate.toString(), async () => {
    const h = createScanHarness({ reservationReply: (r) => { mutate(r); return r; } });
    const reply = await submit(h);
    assert.equal(reply.response.status, 503);
    assert.equal(reply.data.code, 'scan_reservation_unconfirmed');
    assert.equal(h.calls.provider.length, 0);
    assert.equal(h.calls.updates.length, 0);
  });
}

test('a completed receipt for different input cannot be presented as this request', async () => {
  const h = createScanHarness({ scanReply: (row) => ({ data: { ...row, input_data: {} }, error: null }) });
  assert.equal((await submit(h)).data.code, 'scan_save_unconfirmed');
  assert.equal(h.calls.updates.length, 0);
});

for (const initial of [0, 450]) {
  test(`scan completion preserves higher XP and the existing initial floor: ${initial}`, async () => {
    const h = createScanHarness(); h.state.savedProfile.xp = initial;
    assert.equal((await submit(h)).response.status, 200);
    assert.equal(h.state.savedProfile.xp, Math.max(initial, 100));
    assert.ok(h.calls.updates.every((q) => !('xp' in q.data)));
    h.state.savedProfile.xp = 630;
    assert.equal((await submit(h)).data.replayed, true);
    assert.equal(h.state.savedProfile.xp, 630);
  });
}

test('invalid request identity is refused before reservation and paid work', async () => {
  const h = createScanHarness();
  assert.equal((await submit(h, body('not-an-id'))).response.status, 400);
  assert.equal(h.calls.rpc.length, 0);
  assert.equal(h.calls.provider.length, 0);
});

test('a legacy caller receives the server-generated reservation identity', async () => {
  const h = createScanHarness();
  const reply = await submit(h, { type: 'financial', situation: input });
  assert.equal(reply.response.status, 200);
  assert.match(reply.data.scan_id, /^[0-9a-f-]{36}$/);
  assert.equal(reply.data.scan_id, h.calls.rpc[0].args.p_request_id);
});
