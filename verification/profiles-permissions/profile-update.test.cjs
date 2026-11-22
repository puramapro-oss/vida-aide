// Actual POST /api/profile/update, with only auth/storage boundaries simulated.
// No SDK request, provider, remote database or real identity is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const dependencies = process.env.VIDA_AIDE_VERIFICATION_NODE_MODULES;
if (!dependencies) throw new Error('Set VIDA_AIDE_VERIFICATION_NODE_MODULES to the isolated verification dependencies');
const ts = require(path.join(dependencies, 'typescript'));
const zod = require(path.join(dependencies, 'zod'));
const nextServer = require(path.join(dependencies, 'next/server.js'));
const root = path.resolve(__dirname, '../..');
const filename = path.join(root, 'src/app/api/profile/update/route.ts');
const source = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(options = {}) {
  const writes = [];
  let serviceClients = 0;
  const user = { id: '11111111-1111-4111-8111-111111111111' };
  const storage = {
    from(table) {
      let patch;
      let filter;
      const query = {
        update(value) { patch = value; return query; },
        eq(key, value) { filter = { key, value }; return query; },
        select() { return query; },
        async single() {
          writes.push({ table, patch, filter });
          return { data: { id: '22222222-2222-4222-8222-222222222222', ...patch }, error: null };
        },
      };
      return query;
    },
  };
  const modules = {
    'next/server': nextServer,
    zod,
    '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: options.authError ?? null }) } }) },
    '@/lib/supabase': { createServiceClient: () => { serviceClients += 1; return storage; } },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (!(name in modules)) throw new Error('Unexpected module: ' + name);
      return modules[name];
    },
  }, { filename });
  return {
    writes,
    get serviceClients() { return serviceClients; },
    post: (body) => exports.POST(new Request('https://local.invalid/api/profile/update', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })),
  };
}

const forbidden = {
  id: '33333333-3333-4333-8333-333333333333',
  auth_user_id: '33333333-3333-4333-8333-333333333333',
  email: 'forged@example.test', role: 'super_admin', subscription_plan: 'premium',
  subscription_interval: 'yearly', trial_ends_at: '2099-01-01',
  stripe_customer_id: 'cus_synthetic', stripe_subscription_id: 'sub_synthetic',
  referral_code: 'FORGED', referred_by: 'FORGED', wallet_balance: 9000,
  purama_points: 9000, total_money_recovered: 9000, total_demarches_launched: 9000,
  level: 9000, xp: 9000, streak_days: 9000, metadata: { role: 'super_admin' },
  created_at: '2099-01-01', updated_at: '2099-01-01',
};
for (const [field, value] of Object.entries(forbidden)) {
  test('profile API refuses protected field ' + field + ' before a storage write', async () => {
    const h = harness();
    const response = await h.post({ full_name: 'Allowed personal field', [field]: value });
    assert.equal(response.status, 400);
    assert.equal(h.serviceClients, 0);
    assert.equal(h.writes.length, 0);
  });
}

test('existing personal editing contract remains server-owned and owner-filtered', async () => {
  const h = harness();
  const patch = {
    full_name: 'Personal fixture', phone: 'synthetic', birth_date: '2000-01-01',
    address: { city: 'Fixture' }, situation: { age: 26 }, language: 'fr', theme: 'light',
    iban: 'synthetic', onboarded: true, tutorial_completed: true,
  };
  const response = await h.post(patch);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].table, 'profiles');
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0].patch)), patch);
  assert.deepEqual(h.writes[0].filter, { key: 'auth_user_id', value: '11111111-1111-4111-8111-111111111111' });
});

test('empty profile mutation does not acquire the service client', async () => {
  const h = harness();
  const response = await h.post({});
  assert.equal(response.status, 400);
  assert.equal(h.serviceClients, 0);
});

test('failed authentication rejects a residual user before any service client or profile write', async () => {
  const h = harness({ authError: { message: 'Synthetic authentication verification failure' } });
  const response = await h.post({ full_name: 'Personal fixture' });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Connexion requise.' });
  assert.equal(h.serviceClients, 0);
  assert.equal(h.writes.length, 0);
});

console.log(JSON.stringify({
  scope: 'actual profile update route; auth/storage simulated',
  source_sha256: crypto.createHash('sha256').update(source).digest('hex'),
  remoteCalls: 0,
}));
