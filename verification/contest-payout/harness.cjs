// Real cron entrypoints and validation; only database reads/RPC are fixtures.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const repository = path.resolve(__dirname, '../..');
const dependencies = process.env.VIDA_AIDE_VERIFICATION_NODE_MODULES;
if (!dependencies) throw new Error('Set VIDA_AIDE_VERIFICATION_NODE_MODULES to isolated verification dependencies');
const requireTools = createRequire(path.join(path.dirname(dependencies), 'package.json'));
const ts = requireTools('typescript');
const secret = 'synthetic_contest_cron_only';
const uuid = (value) => '00000000-0000-4000-8000-' + String(value).padStart(12, '0');
const contestId = uuid(900);
const profiles = Array.from({ length: 10 }, (_, index) => ({ id: uuid(index + 1),
  full_name: `Fixture ${index + 1}`, email: `fixture-${index + 1}@example.invalid`,
  total_demarches_launched: 10 - index, streak_days: 10 - index, level: 1 }));
function createContestHarness(options = {}) {
  const state = { contests: [{ id: contestId, title: 'Synthetic weekly contest', type: 'weekly', total_pool_cents: 10003,
    end_date: new Date(Date.now() - 60000).toISOString(), status: 'live' }],
    profiles: structuredClone(profiles), referrals: [], mission_completions: [], scans: [], ...options };
  const calls = { reads: [], rpc: [], forbiddenWrites: [], clients: 0, source_sha256: {} };
  function read(query) {
    if (state.reads?.[query.table]) return state.reads[query.table];
    if (!(query.table in state)) throw new Error('Unexpected read table: ' + query.table);
    let data = structuredClone(state[query.table]);
    if (query.table === 'scans' && Array.isArray(data)) {
      const status = query.operations.find(([name, column]) => name === 'eq' && column === 'status')?.[2];
      if (status) data = data.filter((row) => row.status === status);
    }
    return { data, error: null };
  }
  function from(table) {
    const query = { table, operations: [] }, builder = {};
    for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'in', 'range', 'single', 'maybeSingle']) {
      builder[method] = (...args) => { query.operations.push([method, ...args]); return builder; };
    }
    for (const method of ['insert', 'update', 'delete', 'upsert']) {
      builder[method] = (...args) => { calls.forbiddenWrites.push({ table, method, args }); throw new Error('Direct write attempted outside atomic settlement'); };
    }
    let pending;
    builder.then = (resolve, reject) => {
      if (!pending) { calls.reads.push(query); pending = Promise.resolve().then(() => state.query ? state.query(query, read) : read(query)); }
      return pending.then(resolve, reject);
    };
    return builder;
  }
  async function rpc(name, args) {
    calls.rpc.push({ name, args: structuredClone(args) });
    if (name !== 'settle_weekly_contest_v1') throw new Error('Unexpected RPC: ' + name);
    if (state.rpc) return state.rpc(name, args);
    if (state.rpcThrow) throw state.rpcThrow;
    const receipt = { version: 1, contest_id: args.p_contest_id, duplicate: false,
      winners_count: args.p_winners.length, total_paid_cents: args.p_winners.reduce((sum, item) => sum + item.amount_cents, 0),
      awards: structuredClone(args.p_winners) };
    return state.reply ? state.reply(receipt, args) : { data: receipt, error: null };
  }
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(repository, filename);
    if (cache.has(filename)) return cache.get(filename);
    const mod = { exports: {} }; cache.set(filename, mod.exports);
    const source = fs.readFileSync(filename, 'utf8');
    calls.source_sha256[path.relative(repository, filename)] = crypto.createHash('sha256').update(source).digest('hex');
    const compiled = ts.transpileModule(source, { fileName: filename, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    function localRequire(name) {
      if (name === '@/lib/supabase') return { createServiceClient: () => { calls.clients += 1; return { from, rpc }; } };
      if (name.startsWith('@/')) return load(path.join('src', name.slice(2) + '.ts'));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name) + '.ts');
      return requireTools(name);
    }
    new Function('require', 'module', 'exports', compiled)(localRequire, mod, mod.exports);
    cache.set(filename, mod.exports);
    return mod.exports;
  }
  const routes = load('src/app/api/cron/contest-weekly/route.ts');
  const request = (method = 'POST', headers = { Authorization: `Bearer ${secret}` }) => new Request('https://fixture.invalid/api/cron/contest-weekly', { method, headers });
  return { ...routes, state, calls, request, load };
}
async function withSecret(value, work) {
  const previous = process.env.CRON_SECRET;
  if (value === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = value;
  try { return await work(); } finally { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; }
}
module.exports = { createContestHarness, withSecret, secret, uuid, profiles, contestId };
