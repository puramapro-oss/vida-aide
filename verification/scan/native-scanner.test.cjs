// Actual mobile screen -> actual api helper -> actual POST. No provider/network/database operation.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { harness, testing, React } = require('./presentation-harness.cjs');
const { createScanHarness, ids, modelResult } = require('./scan-route-harness.cjs');
const file = 'mobile/app/(tabs)/scanner.tsx';
const originalFetch = global.fetch;
afterEach(() => { testing.cleanup(); global.fetch = originalFetch; });
function fixture(options = {}) {
  const backend = createScanHarness(options);
  const h = harness({
    nativeAuth: { user: { id: ids.user } },
    session: { data: { session: { user: { id: ids.user }, access_token: 'synthetic-session-token' } }, error: null },
  });
  global.fetch = async (url, init) => {
    h.state.calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return backend.POST(new Request(url, init));
  };
  return { h, backend };
}
function fill(h, view, revenues = '0') {
  h.fireEvent.click(view.getByTestId('scanner-emploi-salarie'));
  h.fireEvent.change(view.getByTestId('scanner-revenus'), { target: { value: revenues } });
  h.fireEvent.click(view.getByTestId('scanner-logement-locataire'));
}
async function submit(h, view) {
  await React.act(async () => h.fireEvent.click(view.getByTestId('scanner-submit')));
}
function plain(view) { return view.container.textContent.replace(/\s+/g, ' '); }

test('native scan: real POST accepts financial type, verified Bearer and exact zero income', async () => {
  const { h, backend } = fixture();
  const view = await h.render(file);
  fill(h, view);
  await submit(h, view);
  assert.equal(h.state.calls.length, 1);
  assert.equal(h.state.calls[0].body.type, 'financial');
  assert.equal(h.state.calls[0].body.situation.revenus_mensuels_nets, 0);
  assert.equal(h.state.calls[0].headers.Authorization, 'Bearer synthetic-session-token');
  assert.deepEqual(backend.calls.auth, [['synthetic-session-token']]);
  assert.match(plain(view), /ESTIMATION ENREGISTRÉE/);
  assert.match(view.getByTestId('scan-result-0').textContent, /Aide de démonstration/);
  assert.match(view.getByTestId('scan-result-0').textContent, /100 €\/mois/);
  assert.match(plain(view), /non vérifiée|non vérifié/i);
  assert.match(plain(view), /aucun versement attesté/);
  assert.doesNotMatch(plain(view), /mois récurrent|200\+|30 secondes|SCAN TERMINÉ/);
  assert.equal(backend.state.savedProfile.total_money_recovered, 9734.56);
  assert.equal(backend.state.savedProfile.wallet_balance, 25.5);
  assert.equal(backend.state.savedProfile.purama_points, 30);
  assert.deepEqual(h.state.haptics, ['success']);
});

test('native scan: decimal comma is parsed, all existing units render without invented fields', async () => {
  const results = ['mois', 'an', 'unique'].map((unite) => ({ ...modelResult.results[0], aide: `Piste ${unite}`, unite }));
  const { h } = fixture({ providerResult: { ...modelResult, results, total_recoverable: 1400 } });
  const view = await h.render(file);
  fill(h, view, '1234,50');
  await submit(h, view);
  assert.equal(h.state.calls[0].body.situation.revenus_mensuels_nets, 1234.5);
  assert.match(view.getByTestId('scan-result-0').textContent, /100 €\/mois/);
  assert.match(view.getByTestId('scan-result-1').textContent, /100 €\/an/);
  assert.match(view.getByTestId('scan-result-2').textContent, /100 € ponctuels/);
});

test('native scan: invalid numbers do not trigger the provider or silently disappear', async () => {
  for (const invalid of ['abc', '-1', 'Infinity', '1000001']) {
    const { h, backend } = fixture();
    const view = await h.render(file);
    fill(h, view, invalid);
    await submit(h, view);
    assert.equal(h.state.calls.length, 0);
    assert.equal(backend.calls.provider.length, 0);
    assert.match(plain(view), /Revenus : saisis/);
    assert.equal(view.getByTestId('scanner-revenus').value, invalid);
    view.unmount();
  }
});

test('native scan: rejected session never submits old account inputs', async () => {
  for (const session of [
    { data: { session: null }, error: null },
    { data: { session: { access_token: 'synthetic', user: { id: ids.other } } }, error: null },
    { data: { session: { access_token: 'synthetic', user: { id: ids.user } } }, error: { message: 'synthetic failure' } },
  ]) {
    const { h, backend } = fixture();
    h.state.session = session;
    const view = await h.render(file);
    fill(h, view);
    await submit(h, view);
    assert.equal(h.state.calls.length, 0);
    assert.equal(backend.calls.provider.length, 0);
    assert.match(plain(view), /session a changé|Connexion requise/);
    assert.equal(view.queryByTestId('scan-total'), null);
    view.unmount();
  }
});

test('native scan: HTTP success without exact response shape is not a completed scan', async () => {
  const good = { ok: true, scan_id: ids.scan, ...modelResult };
  for (const body of [
    { ...good, ok: false }, { ...good, scan_id: '' }, { ...good, total_recoverable: null }, { ...good, total_recoverable: 9999 },
    { ...good, results: [{ title: 'Legacy wrong format', amount: 100, frequency: 'monthly' }] },
    { ...good, results: [{ ...modelResult.results[0], montant_estime: '100' }] },
    { ...good, results: [{ ...modelResult.results[0], unite: ['mois'], difficulte: ['facile'] }], total_recoverable: 100, total_recoverable_monthly: 0 },
    { ...good, results: [{ ...modelResult.results[0], unite: ['mois'] }], total_recoverable: 100, total_recoverable_monthly: 0 },
    { ...good, results: [{ ...modelResult.results[0], difficulte: ['facile'] }] },
  ]) {
    const { h } = fixture();
    global.fetch = async (_url, init) => Response.json({ ...body, scan_id: body.scan_id === '' ? '' : JSON.parse(init.body).request_id });
    const view = await h.render(file);
    fill(h, view, '1500');
    await submit(h, view);
    assert.equal(view.queryByTestId('scan-total'), null);
    assert.match(plain(view), /Réponse du scan non confirmée/);
    assert.equal(view.getByTestId('scanner-revenus').value, '1500');
    assert.ok(!h.state.haptics.includes('success'));
    view.unmount();
  }
});

test('native scan: persistence receipt failure retains draft and has no numerical success', async () => {
  const { h, backend } = fixture({ scanReply: { data: null, error: { message: 'synthetic failure' } } });
  const view = await h.render(file);
  fill(h, view, '1500');
  await submit(h, view);
  assert.equal(backend.calls.provider.length, 1);
  assert.equal(view.queryByTestId('scan-total'), null);
  assert.equal(view.getByTestId('scanner-revenus').value, '1500');
  assert.match(plain(view), /sauvegard|confirm/i);
  assert.ok(!h.state.haptics.includes('success'));
});

test('native scan: network loss keeps the draft without claiming a saved result or retrying', async () => {
  const { h, backend } = fixture();
  let requests = 0;
  global.fetch = async () => { requests += 1; throw new TypeError('synthetic transport failure'); };
  const view = await h.render(file);
  fill(h, view, '1500');
  await submit(h, view);
  assert.equal(requests, 1);
  assert.equal(backend.calls.provider.length, 0);
  assert.equal(view.queryByTestId('scan-total'), null);
  assert.equal(view.getByTestId('scanner-revenus').value, '1500');
  assert.match(plain(view), /Réponse du scan non confirmée.*Reprends cette même demande/);
  assert.doesNotMatch(plain(view), /synthetic transport failure/);
  assert.ok(!h.state.haptics.includes('success'));
});

test('native scan: saved scan survives secondary warning without duplicate provider call', async () => {
  const { h, backend } = fixture({ notificationError: { message: 'synthetic failure' } });
  const view = await h.render(file);
  fill(h, view);
  await submit(h, view);
  assert.ok(view.getByTestId('scan-total'));
  assert.match(plain(view), /scan est enregistré.*notifications restent indisponibles/);
  assert.equal(backend.calls.provider.length, 1);
});

test('native scan: same tick double submit makes one request and permits explicit new scan', async () => {
  const { h, backend } = fixture();
  const fetchHandler = global.fetch;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let count = 0;
  global.fetch = async (...args) => { count += 1; await gate; return fetchHandler(...args); };
  const view = await h.render(file);
  fill(h, view);
  await React.act(async () => {
    h.fireEvent.click(view.getByTestId('scanner-submit'));
    h.fireEvent.click(view.getByTestId('scanner-submit'));
  });
  assert.equal(count, 1);
  await React.act(async () => release());
  assert.equal(backend.calls.provider.length, 1);
  await React.act(async () => h.fireEvent.click(view.getByTestId('scan-new')));
  await submit(h, view);
  assert.equal(backend.calls.provider.length, 2);
});

test('native scan: late response after unmount or blur/refocus has no stale success', async () => {
  for (const mode of ['unmount', 'blur', 'refocus']) {
    const { h } = fixture();
    let resolve;
    global.fetch = () => new Promise((done) => { resolve = done; });
    const view = await h.render(file);
    fill(h, view);
    await submit(h, view);
    await React.act(async () => {
      if (mode === 'unmount') view.unmount();
      else { h.blur(); if (mode === 'refocus') h.focus(); }
    });
    await React.act(async () => resolve(Response.json({ ok: true, scan_id: ids.scan, ...modelResult })));
    assert.equal(view.queryByTestId('scan-total'), null);
    assert.ok(!h.state.haptics.includes('success'));
    if (mode === 'refocus') assert.equal(view.getByTestId('scanner-submit').disabled, false);
    view.unmount();
  }
});

test('native scan: account switch clears the old form and rejects an outstanding result', async () => {
  const { h } = fixture();
  let resolve;
  global.fetch = () => new Promise((done) => { resolve = done; });
  const view = await h.render(file);
  fill(h, view, '1500');
  await submit(h, view);
  h.state.nativeAuth = { user: { id: ids.other } };
  await React.act(async () => view.rerender(React.createElement(h.load(file).default)));
  assert.equal(view.getByTestId('scanner-revenus').value, '');
  await React.act(async () => resolve(Response.json({ ok: true, scan_id: ids.scan, ...modelResult })));
  assert.equal(view.queryByTestId('scan-total'), null);
  assert.ok(!h.state.haptics.includes('success'));
});

test('native and server validation agree on cent rounding without rewriting estimates', () => {
  const { h, backend } = fixture();
  const { readScanResponse } = h.load('mobile/lib/scan.ts');
  const { ScanResultSchema } = backend.load('src/lib/scan-result.ts');
  for (const [estimate, annual, monthly, valid] of [
    [0.29, 3.48, 0.29, true], [10.075, 120.96, 10.08, true],
    [0.0000001, 0, 0, true], [100, 1200.01, 100.01, true],
    [100, 1200.02, 100, false], [100, 1200, 100.02, false],
  ]) {
    const value = { ...modelResult, results: [{ ...modelResult.results[0], montant_estime: estimate }], total_recoverable: annual, total_recoverable_monthly: monthly };
    assert.equal(ScanResultSchema.safeParse(value).success, valid);
    const response = { ...value, ok: true, scan_id: ids.scan };
    if (valid) assert.equal(readScanResponse(response, ids.scan), response);
    else assert.throws(() => readScanResponse(response, ids.scan), /totaux sont incohérents/);
  }
});
