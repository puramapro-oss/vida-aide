// One counter-example using the unmodified original handler supplied as a file.
// Database replies are synthetic: the final contest UPDATE always reports failure.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const [sourcePath, evidenceDirectory] = process.argv.slice(2);
if (!sourcePath || !evidenceDirectory) throw new Error('Supply original-handler.ts and a new evidence directory');
const dependencies = process.env.VIDA_AIDE_VERIFICATION_NODE_MODULES;
if (!dependencies) throw new Error('Set VIDA_AIDE_VERIFICATION_NODE_MODULES');
const requireTools = createRequire(path.join(path.dirname(dependencies), 'package.json'));
const ts = requireTools('typescript');
const source = fs.readFileSync(sourcePath, 'utf8');
const contest = { id: '00000000-0000-4000-8000-000000000900', title: 'Synthetic original contest', type: 'weekly',
  total_pool_cents: 10000, status: 'live', end_date: new Date(Date.now() - 60000).toISOString() };
const profile = { id: '00000000-0000-4000-8000-000000000001', full_name: 'Synthetic winner',
  email: 'fixture@example.invalid', total_demarches_launched: 0, level: 1, streak_days: 0, wallet_balance: 25.50 };
const state = { wallet: [], notifications: [], closure_errors: 0 };
function from(table) {
  const query = { operation: 'select', columns: '', value: undefined }, builder = {};
  for (const method of ['select', 'update', 'insert']) builder[method] = (value) => {
    query.operation = method; if (method === 'select') query.columns = value; else query.value = value;
    return builder;
  };
  for (const method of ['eq', 'gte', 'lte', 'in', 'order', 'limit', 'single']) builder[method] = () => builder;
  let pending;
  builder.then = (resolve, reject) => {
    if (!pending) pending = Promise.resolve().then(() => {
      if (table === 'contests' && query.operation === 'update') {
        state.closure_errors += 1;
        return { data: null, error: { code: '22000', message: 'Synthetic final closure failure' } };
      }
      if (table === 'contests' && query.operation === 'select') return { data: [structuredClone(contest)], error: null };
      if (table === 'profiles' && query.operation === 'select') return {
        data: query.columns === 'wallet_balance' ? { wallet_balance: profile.wallet_balance } : [structuredClone(profile)], error: null,
      };
      if (table === 'profiles' && query.operation === 'update') { Object.assign(profile, query.value); return { data: null, error: null }; }
      if (table === 'wallet_transactions' && query.operation === 'insert') { state.wallet.push(structuredClone(query.value)); return { data: null, error: null }; }
      if (table === 'notifications' && query.operation === 'insert') { state.notifications.push(structuredClone(query.value)); return { data: null, error: null }; }
      if (['referrals', 'mission_completions', 'scans'].includes(table) && query.operation === 'select') return { data: [], error: null };
      throw new Error('Unexpected original handler database operation: ' + table + '/' + query.operation);
    });
    return pending.then(resolve, reject);
  };
  return builder;
}
const mod = { exports: {} };
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
} }).outputText;
new Function('require', 'module', 'exports', compiled)((name) => {
  if (name === '@/lib/supabase') return { createServiceClient: () => ({ from }) };
  if (name === 'next/server') return requireTools(name);
  throw new Error('Unexpected baseline dependency: ' + name);
}, mod, mod.exports);
async function main() {
  fs.mkdirSync(evidenceDirectory, { recursive: false });
  fs.writeFileSync(path.join(evidenceDirectory, 'original-handler.ts'), source);
  const previousSecret = process.env.CRON_SECRET, previousFetch = globalThis.fetch;
  process.env.CRON_SECRET = 'synthetic_contest_baseline_only';
  globalThis.fetch = async () => { throw new Error('No network is permitted in the baseline counter-example'); };
  const receipt = { status: 'RUNNING', mode: 'actual original handler, synthetic persistence failure',
    source_sha256: crypto.createHash('sha256').update(source).digest('hex'), responses: [],
    real_provider_calls: 0, real_database_connections: 0, original_balance: profile.wallet_balance };
  try {
    for (let call = 0; call < 2; call += 1) {
      const response = await mod.exports.POST(new Request('https://fixture.invalid/api/cron/contest-weekly', {
        method: 'POST', headers: { Authorization: 'Bearer synthetic_contest_baseline_only' },
      }));
      const body = await response.json();
      receipt.responses.push({ status: response.status, body, wallet_balance: profile.wallet_balance,
        ledger_entries: state.wallet.length, closure_errors: state.closure_errors });
      assert.equal(response.status, 200); assert.equal(body.ok, true);
      assert.equal(body.results[0].total_paid_cents, 3300);
    }
    assert.equal(contest.status, 'live'); assert.equal(state.closure_errors, 2);
    assert.equal(state.wallet.length, 2); assert.equal(state.notifications.length, 2);
    assert.equal(profile.wallet_balance, 91.50);
    assert.deepEqual(state.wallet.map((row) => [row.source_id, row.user_id, row.amount]),
      Array(2).fill([contest.id, profile.id, 33]));
    receipt.status = 'DEFECT_REPRODUCED'; receipt.final_balance = profile.wallet_balance;
    receipt.false_success_responses = 2; receipt.repeat_prizes = 2; receipt.contest_status = contest.status;
  } catch (error) { receipt.status = 'HARNESS_FAILED'; receipt.error = error.message; process.exitCode = 1; }
  finally {
    globalThis.fetch = previousFetch;
    if (previousSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previousSecret;
    fs.writeFileSync(path.join(evidenceDirectory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({ status: receipt.status, receipt: path.join(evidenceDirectory, 'receipt.json') }));
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
