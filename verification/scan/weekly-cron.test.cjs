const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requireTools } = require('./scan-route-harness.cjs');
const ts = requireTools('typescript');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/app/api/cron/contest-weekly/route.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(active = false) {
  const queries = [], updates = [];
  let clients = 0;
  const profiles = ['completed-owner', 'pending-owner', 'failed-owner'].map((id) => ({ id, full_name: id, email: `${id}@example.invalid`, streak_days: 0, level: 0 }));
  const scans = profiles.map((p, i) => ({ user_id: p.id, status: ['completed', 'processing', 'failed'][i] }));
  function from(table) {
    const q = { table, operations: [] }, builder = {};
    for (const op of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'in', 'single', 'insert', 'update']) {
      builder[op] = (...args) => { q.operations.push([op, ...args]); return builder; };
    }
    builder.then = (resolve, reject) => Promise.resolve().then(() => {
      queries.push(q);
      const write = q.operations.find(([op]) => op === 'insert' || op === 'update');
      if (write) { updates.push({ table, operation: write[0], data: write[1] }); return { data: null, error: null }; }
      if (table === 'contests') return { data: active ? [{ id: 'synthetic-contest', type: 'weekly', title: 'Fixture only', total_pool_cents: 0 }] : [], error: null };
      if (table === 'profiles') return { data: profiles, error: null };
      if (table === 'scans') {
        const status = q.operations.find(([op, column]) => op === 'eq' && column === 'status')?.[2];
        return { data: status ? scans.filter((s) => s.status === status) : scans, error: null };
      }
      if (['referrals', 'mission_completions'].includes(table)) return { data: [], error: null };
      throw new Error(`Unexpected query: ${table}`);
    }).then(resolve, reject);
    return builder;
  }
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((name) => {
    if (name === 'next/server') return requireTools(name);
    if (name === '@/lib/supabase') return { createServiceClient: () => { clients++; return { from }; } };
    throw new Error(`Unexpected module: ${name}`);
  }, mod, mod.exports);
  return { ...mod.exports, queries, updates, get clients() { return clients; } };
}

async function withSecret(secret, work) {
  const before = process.env.CRON_SECRET;
  if (secret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = secret;
  try { return await work(); } finally {
    if (before === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = before;
  }
}
const request = (headers = {}) => new Request('https://fixture.invalid/api/cron/contest-weekly', { method: 'POST', headers });

for (const [label, secret, headers] of [
  ['no configured secret', undefined, { Authorization: 'Bearer synthetic-cron-secret', 'x-vercel-cron': '1' }],
  ['only x-vercel-cron', 'synthetic-cron-secret', { 'x-vercel-cron': '1' }],
  ['wrong bearer and claimed scheduler', 'synthetic-cron-secret', { Authorization: 'Bearer wrong', 'x-vercel-cron': 'true' }],
  ['missing bearer', 'synthetic-cron-secret', {}],
  ['partial bearer', 'synthetic-cron-secret', { Authorization: 'Bearer synthetic-cron' }],
]) {
  test(`weekly cron rejects ${label} before acquiring a database client`, async () => {
    await withSecret(secret, async () => {
      const h = harness();
      assert.equal((await h.POST(request(headers))).status, 401);
      assert.equal(h.clients, 0);
      assert.equal(h.queries.length, 0);
    });
  });
}

test('the exact configured bearer authorizes the existing POST and GET entrypoints', async () => {
  await withSecret('synthetic-cron-secret', async () => {
    for (const name of ['POST', 'GET']) {
      const h = harness();
      const response = await h[name](request({ Authorization: 'Bearer synthetic-cron-secret' }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).processed, 0);
      assert.equal(h.clients, 1);
    }
  });
});

test('pending and failed reservations cannot increase the weekly scan score', async () => {
  await withSecret('synthetic-cron-secret', async () => {
    const h = harness(true);
    const response = await h.POST(request({ Authorization: 'Bearer synthetic-cron-secret' }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.results[0].winners_count, 1);
    const closure = h.updates.find((q) => q.table === 'contests' && q.operation === 'update');
    assert.deepEqual(closure.data.winners.map((w) => [w.user_id, w.score]), [['completed-owner', 2]]);
    assert.ok(h.updates.every((q) => !['profiles', 'wallet_transactions'].includes(q.table)), 'fixture makes no monetary write');
  });
});
