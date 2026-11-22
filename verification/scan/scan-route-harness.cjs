// Execute the real POST and its real Zod/NextResponse dependencies. Only the
// authenticated session, persistence and paid model boundaries are simulated.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const modules = process.env.VIDA_AIDE_VERIFICATION_NODE_MODULES;
const requireTools = createRequire(path.join(modules ? path.dirname(modules) : root, 'package.json'));
const ts = requireTools('typescript');
const { createScanRpcDouble } = require('./scan-rpc-double.cjs');

const ids = Object.freeze({
  user: '10000000-0000-4000-8000-000000000001',
  profile: '20000000-0000-4000-8000-000000000002',
  scan: '30000000-0000-4000-8000-000000000003',
  other: '40000000-0000-4000-8000-000000000004',
});
const item = Object.freeze({
  aide: 'Aide de démonstration', category: 'logement', montant_estime: 100,
  unite: 'mois', eligibilite: 'À vérifier auprès de l’organisme',
  conditions: ['Condition de démonstration'], demarche: 'Vérifier les conditions',
  difficulte: 'facile', organisme: 'Organisme de démonstration',
  lien_officiel: 'https://example.invalid/aide', delai_jours: 30,
});
const modelResult = Object.freeze({
  results: [item], total_recoverable: 1200, total_recoverable_monthly: 100,
  summary: 'Estimation indicative, à vérifier auprès de l’organisme.',
});
const clone = (value) => structuredClone(value);

function createScanHarness(options = {}) {
  const profile = {
    id: ids.profile, auth_user_id: ids.user, subscription_plan: 'free', role: 'user',
    total_money_recovered: 9734.56, wallet_balance: 25.5, purama_points: 30, xp: 100,
  };
  const state = {
    authResult: { data: { user: { id: ids.user } }, error: null },
    profileResult: { data: clone(profile), error: null },
    quotaResult: { count: 0, error: null },
    providerResult: clone(modelResult),
    savedProfile: clone(profile),
    scanReply: null, profileUpdateError: null, notificationError: null,
    ...options,
  };
  const calls = { auth: [], queries: [], provider: [], inserts: [], updates: [], rpc: [], finalizations: [], failures: [] };
  const defaultRpc = createScanRpcDouble(state, calls);
  const rpc = async (name, args) => {
    calls.rpc.push({ name, args: clone(args) });
    return state.rpc ? state.rpc(name, args, defaultRpc) : defaultRpc(name, args);
  };
  async function defaultQuery(query) {
    const operation = query.operations.find(([name]) => name === 'insert' || name === 'update');
    if (operation?.[0] === 'insert') {
      calls.inserts.push({ table: query.table, data: clone(operation[1]) });
      if (query.table === 'scans') {
        const receipt = {
          id: ids.scan, ...clone(operation[1]), created_at: '2026-11-22T00:00:00.000Z',
        };
        if (typeof state.scanReply === 'function') return state.scanReply(receipt, query);
        return state.scanReply || { data: receipt, error: null };
      }
      return { data: null, error: state.notificationError };
    }
    if (operation?.[0] === 'update') {
      calls.updates.push({ table: query.table, data: clone(operation[1]) });
      if (!state.profileUpdateError) Object.assign(state.savedProfile, operation[1]);
      return { data: null, error: state.profileUpdateError };
    }
    if (query.table === 'profiles') return state.profileResult;
    if (query.table === 'scans') return state.quotaResult;
    throw new Error(`Unexpected fixture query: ${query.table}`);
  }
  function from(table) {
    const query = { table, operations: [] };
    const builder = {};
    for (const name of ['select', 'eq', 'gte', 'insert', 'update', 'single', 'maybeSingle']) {
      builder[name] = (...args) => { query.operations.push([name, ...args]); return builder; };
    }
    let result;
    builder.then = (resolve, reject) => {
      if (!result) {
        calls.queries.push(query);
        result = Promise.resolve().then(() => state.query ? state.query(query, defaultQuery) : defaultQuery(query));
      }
      return result.then(resolve, reject);
    };
    return builder;
  }
  const supabase = {
    auth: { getUser: async (...args) => {
      calls.auth.push(args);
      if (state.authThrow) throw state.authThrow;
      return state.authResult;
    } },
  };
  const cache = new Map();
  function load(relativePath) {
    const filename = path.resolve(root, relativePath);
    if (cache.has(filename)) return cache.get(filename);
    const mod = { exports: {} };
    cache.set(filename, mod.exports);
    function localRequire(request) {
      if (request === '@/lib/supabase-server') return { createServerSupabaseClient: async () => supabase };
      if (request === '@/lib/supabase') return { createServiceClient: () => ({ from, rpc }) };
      if (request === '@/lib/claude') return { scanFinancialJSON: async (...args) => {
        calls.provider.push(args);
        if (state.providerThrow) throw state.providerThrow;
        if (state.provider) return state.provider(...args);
        return state.providerResult;
      } };
      if (request.startsWith('@/') || request.startsWith('.')) {
        const base = request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : path.resolve(path.dirname(filename), request);
        const local = ['', '.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
        if (!local) throw new Error(`Unknown local module: ${request}`);
        return load(local);
      }
      return requireTools(request);
    }
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    });
    new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', compiled.outputText)(
      localRequire, mod, mod.exports, state.setTimeout || setTimeout,
      state.clearTimeout || (state.setTimeout ? () => {} : clearTimeout));
    cache.set(filename, mod.exports);
    return mod.exports;
  }
  const { POST } = load('src/app/api/scan/route.ts');
  function request(body = { request_id: ids.scan, type: 'financial', situation: { emploi: 'salarie', revenus_mensuels_nets: 1500 } }, headers = {}) {
    return new Request('https://fixture.invalid/api/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
  }
  return { POST, calls, state, request, load };
}

module.exports = { createScanHarness, ids, item, modelResult, requireTools };
