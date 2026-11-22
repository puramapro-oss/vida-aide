const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { harness, profile, scan, testing } = require('./presentation-harness.cjs');
const web = 'src/app/(dashboard)/';
const native = 'mobile/app/(tabs)/';
const text = (view) => view.container.textContent.replace(/\s+/g, ' ');
afterEach(() => testing.cleanup());

test('dashboard: current estimate and historical amount remain distinct', async () => {
  const h = harness({ db: async () => ({ data: [scan], error: null }) });
  const view = await h.render(`${web}dashboard/page.tsx`);
  assert.match(text(view), /Estimation du dernier scan/i);
  assert.equal(view.container.querySelector('[data-counter-value]').getAttribute('data-counter-value'), '1200');
  assert.match(text(view), /historique non vérifié/i);
  assert.match(text(view), /9 734/);
  assert.doesNotMatch(text(view), /récupérer cet argent/i);
  assert.ok(h.state.queries[0].operations.some(([op, field, value]) => op === 'eq' && field === 'user_id' && value === profile.id));
});

test('dashboard: no scan never repurposes the historical field as an estimate', async () => {
  const h = harness({ db: async () => ({ data: [], error: null }) });
  const view = await h.render(`${web}dashboard/page.tsx`);
  assert.equal(view.container.querySelector('[data-counter-value]'), null);
  assert.match(text(view), /Aucune estimation/i);
  assert.match(text(view), /9 734/);
  assert.match(text(view), /non vérifié/i);
});

test('dashboard: failed read does not become an empty list or zero estimate', async () => {
  const h = harness({ db: async () => ({ data: null, error: { message: 'synthetic failure' } }) });
  const view = await h.render(`${web}dashboard/page.tsx`);
  assert.match(text(view), /Impossible de charger/i);
  assert.doesNotMatch(text(view), /Aucun scan pour/);
  assert.equal(view.container.querySelector('[data-counter-value]'), null);
});

test('dashboard: a completed zero estimate is shown, an invalid amount is unavailable', async () => {
  for (const amount of [0, null, 'not-a-number', -1]) {
    const row = { ...scan, total_recoverable: amount, ...(amount === 0 ? { results: [], total_recoverable_monthly: 0 } : {}) };
    const h = harness({ db: async () => ({ data: [row], error: null }) });
    const view = await h.render(`${web}dashboard/page.tsx`);
    const counter = view.container.querySelector('[data-counter-value]');
    if (amount === 0) assert.equal(counter?.getAttribute('data-counter-value'), '0');
    else { assert.equal(counter, null); assert.match(text(view), /indisponible/i); }
    view.unmount();
  }
});

test('profile: original counter remains readable only as unverified history', async () => {
  const h = harness();
  const view = await h.render(`${web}dashboard/profile/page.tsx`);
  assert.match(text(view), /9 734,00/);
  assert.match(text(view), /historique non vérifié/i);
  assert.match(text(view), /versement/i);
  assert.doesNotMatch(text(view), /Total récupéré/);
});

test('profile: missing historical value does not become zero', async () => {
  const h = harness();
  h.state.auth.profile.total_money_recovered = null;
  const view = await h.render(`${web}dashboard/profile/page.tsx`);
  assert.match(text(view), /Non renseigné/i);
  assert.doesNotMatch(text(view), /0,00/);
});

function adminDb({ invalid = false, failure = false, count = 1 } = {}) {
  return async (q) => {
    if (failure) return { data: null, count: null, error: { message: 'synthetic failure' } };
    if (q.operations[0][2]?.head) return { data: null, count, error: null };
    return { data: [{ total_money_recovered: invalid ? null : 9734, subscription_plan: 'premium' }], error: null };
  };
}

test('admin: sum is historical, never money verified as recovered', async () => {
  const h = harness({ db: adminDb() });
  const view = await h.render(`${web}dashboard/admin/page.tsx`);
  assert.match(text(view), /9 734,00/);
  assert.match(text(view), /Historique non vérifié/i);
  assert.doesNotMatch(text(view), /€ récupérés/);
});

test('admin: failed, incomplete or invalid reads never produce a fabricated aggregate', async () => {
  for (const opts of [{ failure: true }, { invalid: true }, { count: 2 }]) {
    const h = harness({ db: adminDb(opts) });
    const view = await h.render(`${web}dashboard/admin/page.tsx`);
    assert.match(text(view), /Impossible|indisponible|incompl/i);
    assert.doesNotMatch(text(view), /9 734,00|0,00/);
    view.unmount();
  }
});

test('scan detail: estimated result and share text cannot imply a payment or guaranteed timing', async () => {
  const h = harness({ db: async () => ({ data: scan, error: null }) });
  const view = await h.render(`${web}scanner/[id]/page.tsx`, { params: Promise.resolve({ id: scan.id }) });
  assert.match(text(view), /Estimation indicative/i);
  assert.match(text(view), /non vérifiée/i);
  assert.match(text(view), /versement/i);
  assert.equal(view.container.querySelector('[data-counter-value]').getAttribute('data-counter-value'), '1200');
  const share = h.state.shares.at(-1);
  assert.match(share.headline, /Estimation/i);
  assert.match(share.sub, /versement|non vérifi/i);
  assert.doesNotMatch(`${share.headline} ${share.value} ${share.sub}`, /\+|30 secondes|laissais sur la table/);
  assert.ok(h.state.queries[0].operations.some(([op, field, value]) => op === 'eq' && field === 'user_id' && value === profile.id));
});

test('scan detail: malformed or unfinished scan has no numerical success or share', async () => {
  for (const row of [{ ...scan, total_recoverable: null }, { ...scan, status: 'processing' }, { ...scan, results: null }, { ...scan, total_recoverable: 9999 }]) {
    const h = harness({ db: async () => ({ data: row, error: null }) });
    const view = await h.render(`${web}scanner/[id]/page.tsx`, { params: Promise.resolve({ id: scan.id }) });
    assert.match(text(view), /indisponible|en cours/i);
    assert.equal(view.container.querySelector('[data-counter-value]'), null);
    assert.equal(h.state.shares.length, 0);
    view.unmount();
  }
});

test('web wallet: sharing balance never turns it into recovered aid or a transfer receipt', async () => {
  const h = harness({ db: async () => ({ data: [], error: null }) });
  await h.render(`${web}dashboard/wallet/page.tsx`);
  const share = h.state.shares.at(-1);
  assert.match(share.headline, /solde|portefeuille/i);
  assert.match(share.value.replace(/\s+/g, ' '), /25,50 €/);
  assert.match(share.sub, /versement/i);
  assert.doesNotMatch(`${share.headline} ${share.value} ${share.sub}`, /\+|récupérés via/i);
});

test('web wallet: unknown balance is not shared as a fabricated zero', async () => {
  const h = harness({ db: async () => ({ data: [], error: null }) });
  h.state.auth.profile.wallet_balance = null;
  await h.render(`${web}dashboard/wallet/page.tsx`);
  assert.equal(h.state.shares.length, 0);
});

test('native dashboard: historical counter and actual wallet balance are separate', async () => {
  const h = harness();
  const view = await h.render(`${native}dashboard.tsx`);
  const hero = view.getByTestId('dashboard-total-card').textContent.replace(/\s+/g, ' ');
  assert.match(hero, /9 734/);
  assert.match(hero, /historique non vérifié/i);
  assert.match(hero, /versement/i);
  assert.doesNotMatch(hero, /Argent récupérable détecté|débloquer ton montant/);
  assert.match(view.getByTestId('dashboard-wallet-card').textContent, /25\.50/);
});

test('native dashboard: missing profile and read errors show unknown, never zero money', async () => {
  for (const response of [{ data: null, error: null }, { data: null, error: { message: 'synthetic failure' } }]) {
    const h = harness({ db: async () => response });
    const view = await h.render(`${native}dashboard.tsx`);
    assert.match(text(view), /indisponible|Impossible|introuvable/i);
    assert.doesNotMatch(view.getByTestId('dashboard-total-card').textContent, /\b0\s*€/);
    assert.doesNotMatch(view.getByTestId('dashboard-wallet-card').textContent, /0\.00/);
    view.unmount();
  }
});

test('native wallet: balance and transaction values remain intact, history stays unverified', async () => {
  const h = harness({ db: async (q) => ({ data: q.table === 'profiles' ? profile : [{ id: 'tx-fixture', type: 'referral', amount: 2.5, description: null, created_at: scan.created_at }], error: null }) });
  const view = await h.render(`${native}wallet.tsx`);
  assert.match(view.getByTestId('wallet-balance-card').textContent, /25\.50/);
  assert.equal(view.getByTestId('wallet-withdraw-cta').disabled, false);
  assert.match(view.getByTestId('wallet-tx-tx-fixture').textContent, /\+2\.50/);
  assert.match(view.getByTestId('wallet-lifetime-card').textContent, /9734/);
  assert.match(view.getByTestId('wallet-lifetime-card').textContent, /historique non vérifié/i);
  assert.match(view.getByTestId('wallet-lifetime-card').textContent, /versement/i);
  assert.doesNotMatch(text(view), /Tes gains réels/);
});

test('native wallet: failed profile or transaction read does not mean zero or no transactions', async () => {
  for (const brokenTable of ['profiles', 'wallet_transactions']) {
    const h = harness({ db: async (q) => q.table === brokenTable ? { data: null, error: { message: 'synthetic failure' } } : { data: profile, error: null } });
    const view = await h.render(`${native}wallet.tsx`);
    assert.match(text(view), /Impossible|indisponible/i);
    assert.equal(view.queryByTestId('wallet-empty-card'), null);
    if (brokenTable === 'profiles') {
      assert.doesNotMatch(view.getByTestId('wallet-balance-card').textContent, /0\.00/);
      assert.equal(view.getByTestId('wallet-withdraw-cta').disabled, true);
    }
    view.unmount();
  }
});

test('native profile reads cannot restore a previous account after account switch or sign-out', async () => {
  for (const name of ['dashboard', 'wallet']) {
    let release;
    const delayed = new Promise((resolve) => { release = resolve; });
    const other = { ...profile, id: 'profile-other', auth_user_id: 'auth-other', total_money_recovered: 4321, wallet_balance: 12 };
    const h = harness({ db: async (q) => {
      if (q.table === 'wallet_transactions') return { data: [], error: null };
      const owner = q.operations.find(([op, field]) => op === 'eq' && field === 'auth_user_id')?.[2];
      return owner === profile.auth_user_id ? delayed : { data: other, error: null };
    } });
    const file = `${native}${name}.tsx`;
    const view = await h.render(file);
    h.state.nativeAuth = { user: { id: other.auth_user_id } };
    await h.React.act(async () => view.rerender(h.React.createElement(h.load(file).default)));
    await h.React.act(async () => release({ data: profile, error: null }));
    const card = name === 'wallet' ? 'wallet-lifetime-card' : 'dashboard-total-card';
    assert.match(view.getByTestId(card).textContent.replace(/\s+/g, ''), /4321/);
    assert.doesNotMatch(view.getByTestId(card).textContent.replace(/\s+/g, ''), /9734/);
    h.state.nativeAuth = { user: null };
    await h.React.act(async () => view.rerender(h.React.createElement(h.load(file).default)));
    assert.match(view.getByTestId(card).textContent, /Indisponible/);
    if (name === 'wallet') assert.equal(view.getByTestId('wallet-withdraw-cta').disabled, true);
    view.unmount();
  }
});
