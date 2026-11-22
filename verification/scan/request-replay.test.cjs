// Both real callers -> real HTTP handler. Only storage/platform and server external boundaries are adapted.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { harness, profile, testing, React } = require('./presentation-harness.cjs');
const { createScanHarness, ids, modelResult } = require('./scan-route-harness.cjs');
const originalFetch = global.fetch;
afterEach(() => { testing.cleanup(); global.fetch = originalFetch; });
const files = { web: 'src/app/(dashboard)/scanner/page.tsx', native: 'mobile/app/(tabs)/scanner.tsx' };
const primary = { web: 'btn-launch-scan', native: 'scanner-submit' };
const fresh = { web: 'btn-new-scan-intent', native: 'scanner-new-intent' };
const income = { web: 'field-revenus', native: 'scanner-revenus' };
const plain = (view) => view.container.textContent.replace(/\s+/g, ' ');

function fixture(platform, options = {}) {
  const backend = createScanHarness(options);
  const h = harness();
  h.state.auth.profile = { ...profile, id: ids.profile, auth_user_id: ids.user };
  h.state.auth.user = { id: ids.user };
  h.state.nativeAuth = { user: { id: ids.user } };
  h.state.session = { data: { session: { user: { id: ids.user }, access_token: 'synthetic-session-token' } }, error: null };
  const transport = async (url, init) => {
    const body = JSON.parse(init.body);
    h.state.calls.push(body);
    return backend.POST(new Request(new URL(url, 'https://fixture.invalid'), init));
  };
  global.fetch = transport;
  async function render() { return h.render(files[platform]); }
  function fill(view, amount = '1500') {
    if (platform === 'web') {
      h.fireEvent.change(view.getByTestId('field-age'), { target: { value: '32' } });
      h.fireEvent.change(view.getByTestId('field-emploi'), { target: { value: 'salarie' } });
    } else {
      h.fireEvent.click(view.getByTestId('scanner-emploi-salarie'));
      h.fireEvent.click(view.getByTestId('scanner-logement-locataire'));
      h.fireEvent.change(view.getByTestId('scanner-age'), { target: { value: '32' } });
    }
    h.fireEvent.change(view.getByTestId(income[platform]), { target: { value: amount } });
  }
  async function submit(view) { await React.act(async () => h.fireEvent.click(view.getByTestId(primary[platform]))); }
  function success(view, id) {
    if (platform === 'web') assert.equal(h.state.navigations.at(-1), `/scanner/${id}`);
    else { assert.ok(view.getByTestId('scan-total')); assert.match(plain(view), /ESTIMATION ENREGISTRÉE/); }
  }
  function absent(view) {
    if (platform === 'web') assert.equal(h.state.navigations.length, 0);
    else assert.equal(view.queryByTestId('scan-total'), null);
  }
  return { platform, h, backend, transport, render, fill, submit, success, absent };
}

for (const platform of ['web', 'native']) {
  test(`${platform}: same intent survives remount and replays the exact receipt without another provider call`, async () => {
    const f = fixture(platform);
    let view = await f.render(); f.fill(view, '0'); await f.submit(view);
    const first = f.h.state.calls[0];
    assert.match(first.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    f.success(view, first.request_id);
    view.unmount(); view = await f.render();
    assert.equal(view.getByTestId(income[platform]).value, '0');
    assert.match(view.getByTestId(primary[platform]).textContent, /Reprendre/);
    await f.submit(view);
    assert.deepEqual(f.h.state.calls[1], first);
    assert.equal(f.backend.calls.provider.length, 1);
    assert.equal(f.backend.state.scans.size, 1);
    f.success(view, first.request_id);
  });

  test(`${platform}: lost acknowledgement is recovered after remount with the same key and content`, async () => {
    const f = fixture(platform);
    let first = true;
    global.fetch = async (...args) => {
      const response = await f.transport(...args);
      if (first) { first = false; assert.equal(response.status, 200); throw new TypeError('synthetic acknowledgement loss'); }
      return response;
    };
    let view = await f.render(); f.fill(view); await f.submit(view);
    f.absent(view);
    const request = f.h.state.calls[0];
    assert.equal(f.backend.state.scans.get(request.request_id).status, 'completed');
    assert.match(plain(view), /non confirmée|pas confirmé/i);
    view.unmount(); view = await f.render();
    assert.equal(view.getByTestId(income[platform]).value, '1500');
    await f.submit(view);
    assert.deepEqual(f.h.state.calls[1], request);
    assert.equal(f.backend.calls.provider.length, 1);
    f.success(view, request.request_id);
  });

  test(`${platform}: processing409 keeps the key, then retrieves the completed original request`, async () => {
    let release, started;
    const gate = new Promise((resolve) => { release = resolve; });
    const entered = new Promise((resolve) => { started = resolve; });
    const f = fixture(platform, { provider: async () => { started(); return gate; } });
    let first = true, originalResponse;
    global.fetch = async (...args) => {
      if (!first) return f.transport(...args);
      first = false; originalResponse = f.transport(...args);
      await entered;
      throw new TypeError('synthetic lost connection while processing');
    };
    const view = await f.render(); f.fill(view);
    try {
      await f.submit(view); f.absent(view);
      const request = f.h.state.calls[0];
      await f.submit(view);
      assert.deepEqual(f.h.state.calls[1], request);
      assert.match(plain(view), /encore en cours/);
      assert.equal(f.backend.calls.provider.length, 1);
      assert.equal(f.backend.state.scans.size, 1);
      release(modelResult); await originalResponse;
      await f.submit(view);
      assert.deepEqual(f.h.state.calls[2], request);
      assert.equal(f.backend.calls.provider.length, 1);
      f.success(view, request.request_id);
    } finally { release(modelResult); if (originalResponse) await originalResponse; }
  });

  test(`${platform}: failed409 is terminal until an explicitly new intention`, async () => {
    const f = fixture(platform, { providerThrow: new Error('synthetic provider failure') });
    const view = await f.render(); f.fill(view); await f.submit(view); f.absent(view);
    const first = f.h.state.calls[0];
    await f.submit(view);
    assert.deepEqual(f.h.state.calls[1], first);
    assert.match(plain(view), /terminée sans résultat.*décomptée/);
    assert.equal(f.backend.calls.provider.length, 1);
    assert.equal(f.backend.state.scans.get(first.request_id).status, 'failed');
    f.backend.state.providerThrow = null;
    await React.act(async () => f.h.fireEvent.click(view.getByTestId(fresh[platform])));
    await f.submit(view);
    const next = f.h.state.calls[2];
    assert.notEqual(next.request_id, first.request_id);
    assert.deepEqual(next.situation, first.situation);
    assert.equal(f.backend.calls.provider.length, 2);
    assert.equal(f.backend.state.scans.size, 2);
    f.success(view, next.request_id);
  });

  test(`${platform}: changed content is a new explicit input intent, never a key conflict`, async () => {
    const f = fixture(platform, { providerThrow: new Error('synthetic provider failure') });
    const view = await f.render(); f.fill(view); await f.submit(view);
    const first = f.h.state.calls[0];
    f.backend.state.providerThrow = null;
    f.h.fireEvent.change(view.getByTestId(income[platform]), { target: { value: '1501' } });
    assert.match(view.getByTestId(primary[platform]).textContent, /nouveau scan/);
    await f.submit(view);
    const next = f.h.state.calls[1];
    assert.notEqual(next.request_id, first.request_id);
    assert.equal(next.situation.revenus_mensuels_nets, 1501);
    assert.equal(f.backend.calls.provider.length, 2);
    f.success(view, next.request_id);
  });

  test(`${platform}: a valid result with a different receipt ID cannot become success`, async () => {
    const f = fixture(platform);
    let first = true;
    global.fetch = async (...args) => {
      const response = await f.transport(...args);
      if (!first) return response;
      first = false;
      return Response.json({ ...(await response.json()), scan_id: ids.other });
    };
    const view = await f.render(); f.fill(view); await f.submit(view);
    f.absent(view);
    assert.match(plain(view), /non confirmée/);
    await f.submit(view);
    assert.equal(f.h.state.calls[1].request_id, f.h.state.calls[0].request_id);
    assert.equal(f.backend.calls.provider.length, 1);
    f.success(view, f.h.state.calls[0].request_id);
  });

  test(`${platform}: a non-final 202 cannot confirm an otherwise well-formed receipt`, async () => {
    const f = fixture(platform);
    let first = true;
    global.fetch = async (...args) => {
      const response = await f.transport(...args);
      if (!first) return response;
      first = false;
      return Response.json(await response.json(), { status: 202 });
    };
    const view = await f.render(); f.fill(view); await f.submit(view);
    f.absent(view);
    assert.match(plain(view), /non confirmée/);
    await f.submit(view);
    assert.equal(f.h.state.calls[1].request_id, f.h.state.calls[0].request_id);
    assert.equal(f.backend.calls.provider.length, 1);
    f.success(view, f.h.state.calls[0].request_id);
  });

  test(`${platform}: storage failure prevents POST and leaves the form available for a safe retry`, async () => {
    const f = fixture(platform);
    const view = await f.render(); f.fill(view);
    f.h.state.storageError = true;
    await f.submit(view);
    assert.equal(f.h.state.calls.length, 0);
    assert.equal(f.backend.calls.provider.length, 0);
    assert.match(plain(view), /Impossible de conserver.*Aucun scan n’a été lancé/);
    assert.equal(view.getByTestId(income[platform]).value, '1500');
    f.h.state.storageError = false;
    await f.submit(view);
    assert.equal(f.backend.calls.provider.length, 1);
    if (platform === 'native') assert.equal(f.h.state.uuidCalls, 1);
    f.success(view, f.h.state.calls[0].request_id);
  });

  test(`${platform}: a corrupt local intent requires explicit reset instead of silently creating a new request`, async () => {
    const f = fixture(platform);
    let view = await f.render(); f.fill(view); await f.submit(view);
    const [key] = f.h.state.storage.keys();
    f.h.state.storage.set(key, '{');
    view.unmount(); view = await f.render();
    assert.equal(view.getByTestId(primary[platform]).disabled, true);
    assert.match(plain(view), /Impossible de lire/);
    assert.equal(f.backend.calls.provider.length, 1);
    await React.act(async () => f.h.fireEvent.click(view.getByTestId(fresh[platform])));
    f.fill(view); await f.submit(view);
    assert.equal(f.backend.calls.provider.length, 2);
    assert.notEqual(f.h.state.calls[0].request_id, f.h.state.calls[1].request_id);
  });
}

test('native: unavailable UUID generator never falls back to an unsafe identifier or calls the server', async () => {
  const f = fixture('native');
  f.h.state.uuidError = true;
  const view = await f.render(); f.fill(view); await f.submit(view);
  assert.match(plain(view), /Impossible de créer un identifiant sûr/);
  assert.equal(f.h.state.calls.length, 0);
  assert.equal(f.backend.calls.provider.length, 0);
  assert.equal(f.h.state.storage.size, 0);
});

test('web: user changes before profile fetch completes, so old form and late success disappear immediately', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = fixture('web', { provider: async () => gate });
  const view = await f.render(); f.fill(view); await f.submit(view);
  try {
    f.h.state.auth.user = { id: ids.other };
    await React.act(async () => view.rerender(React.createElement(f.h.load(files.web).default)));
    assert.equal(f.h.state.auth.profile.auth_user_id, ids.user);
    assert.equal(view.queryByTestId('field-revenus'), null);
    assert.match(plain(view), /Vérification du compte/);
    await React.act(async () => release(modelResult));
    assert.equal(f.h.state.navigations.length, 0);
    assert.equal(f.h.state.alerts.length, 0);
    f.h.state.auth.profile = { ...profile, id: ids.other, auth_user_id: ids.other };
    await React.act(async () => view.rerender(React.createElement(f.h.load(files.web).default)));
    assert.equal(view.getByTestId('field-revenus').value, '');
  } finally { release(modelResult); }
});

test('native: reset and submit are blocked until the stored intention has finished loading', async () => {
  const f = fixture('native');
  let view = await f.render(); f.fill(view); await f.submit(view);
  const original = f.h.state.calls[0];
  view.unmount();
  let release, deletes = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  f.h.state.secureGet = async (key, storage) => { const snapshot = storage.getItem(key); await gate; return snapshot; };
  f.h.state.secureDelete = async (key, storage) => { deletes += 1; storage.removeItem(key); };
  view = await f.render();
  assert.equal(view.getByTestId(fresh.native).disabled, true);
  assert.equal(view.getByTestId(primary.native).disabled, true);
  f.h.fireEvent.click(view.getByTestId(fresh.native));
  f.h.fireEvent.click(view.getByTestId(fresh.native));
  assert.equal(deletes, 0);
  await React.act(async () => release());
  assert.equal(view.getByTestId(income.native).value, '1500');
  await f.submit(view);
  assert.deepEqual(f.h.state.calls[1], original);
  assert.equal(f.backend.calls.provider.length, 1);
});

test('native: double reset cannot leave a late deletion that erases a freshly saved intention', async () => {
  const f = fixture('native');
  const view = await f.render(); f.fill(view); await f.submit(view);
  const original = f.h.state.calls[0];
  let release, deletes = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  f.h.state.secureDelete = async (key, storage) => { deletes += 1; await gate; storage.removeItem(key); };
  await React.act(async () => f.h.fireEvent.click(view.getByTestId('scan-new')));
  assert.equal(view.getByTestId(fresh.native).disabled, true);
  assert.equal(view.getByTestId(primary.native).disabled, true);
  f.h.fireEvent.click(view.getByTestId(fresh.native));
  f.h.fireEvent.click(view.getByTestId(fresh.native));
  assert.equal(deletes, 1);
  await React.act(async () => release());
  await f.submit(view);
  const next = f.h.state.calls[1];
  assert.notEqual(next.request_id, original.request_id);
  assert.equal(f.backend.calls.provider.length, 2);
  assert.equal(JSON.parse([...f.h.state.storage.values()][0]).requestId, next.request_id);
  f.success(view, next.request_id);
});

test('native: an old write cannot overwrite the durable request after remount and a lost receipt', async () => {
  const f = fixture('native');
  let release, writes = 0, first = true;
  const gate = new Promise((resolve) => { release = resolve; });
  f.h.state.secureSet = async (key, value, storage) => {
    writes += 1;
    if (writes === 1) await gate;
    storage.setItem(key, value);
  };
  global.fetch = async (...args) => {
    const response = await f.transport(...args);
    if (first) { first = false; throw new TypeError('synthetic lost acknowledgement'); }
    return response;
  };
  let view = await f.render(); f.fill(view); await f.submit(view);
  assert.equal(writes, 1); assert.equal(f.h.state.calls.length, 0);
  view.unmount(); view = await f.render();
  try {
    assert.equal(view.getByTestId(primary.native).disabled, true);
    await React.act(async () => release());
    f.fill(view); await f.submit(view);
    const original = f.h.state.calls[0];
    f.absent(view);
    assert.equal(f.backend.calls.provider.length, 1);
    view.unmount(); view = await f.render();
    assert.equal(view.getByTestId(income.native).value, '1500');
    await f.submit(view);
    assert.deepEqual(f.h.state.calls[1], original);
    assert.equal(f.backend.calls.provider.length, 1);
    assert.equal(f.backend.state.scans.size, 1);
    f.success(view, original.request_id);
  } finally { release(); }
});
