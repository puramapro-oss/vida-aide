// Real React + source components. Only rendering primitives and external boundaries are adapted.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const toolsRoot = process.env.VIDA_PRESENTATION_TOOLS || (process.env.VIDA_AIDE_VERIFICATION_NODE_MODULES
  ? path.dirname(process.env.VIDA_AIDE_VERIFICATION_NODE_MODULES) : path.resolve(__dirname, '..'));
const requireTools = createRequire(path.join(toolsRoot, 'package.json'));
const ts = requireTools('typescript');
const { JSDOM } = requireTools('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://fixture.invalid' });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.MutationObserver = dom.window.MutationObserver;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = requireTools('react');
const testing = requireTools('@testing-library/react');

const profile = {
  id: 'profile-fixture', auth_user_id: 'auth-fixture', email: 'fixture@example.invalid',
  full_name: 'Camille Test', phone: null, wallet_balance: 25.5, purama_points: 30,
  total_money_recovered: 9734, total_demarches_launched: 2, xp: 100, subscription_plan: 'free',
};
const item = {
  aide: 'Aide synthétique', category: 'logement', montant_estime: 100, unite: 'mois',
  eligibilite: 'À vérifier auprès de l’organisme', conditions: ['Condition synthétique'],
  demarche: 'Contacter l’organisme', difficulte: 'facile', organisme: 'Organisme synthétique',
};
const scan = {
  id: 'scan-fixture', user_id: profile.id, type: 'financial', status: 'completed',
  results: [item], total_recoverable: 1200, total_recoverable_monthly: 100,
  ai_summary: 'Synthèse synthétique', created_at: '2026-11-22T00:00:00Z',
};

function harness(options = {}) {
  const state = {
    auth: { user: { id: profile.auth_user_id }, profile: { ...profile }, isSuperAdmin: true, loading: false, refetch() {} },
    nativeAuth: { user: { id: profile.auth_user_id } },
    queries: [], shares: [], calls: [], navigations: [], haptics: [], alerts: [], focusEffects: new Set(), storage: new Map(), uuidCalls: 0,
    db: async (q) => ({ data: q.table === 'profiles' ? { ...profile } : [scan], error: null }),
    session: { data: { session: { access_token: 'synthetic-session-token', user: { id: profile.auth_user_id } } }, error: null },
    ...options,
  };
  const cache = new Map();
  const storage = {
    getItem(key) { if (state.storageError) throw new Error('synthetic storage failure'); return state.storage.get(key) ?? null; },
    setItem(key, value) { if (state.storageError) throw new Error('synthetic storage failure'); state.storage.set(key, value); },
    removeItem(key) { if (state.storageError) throw new Error('synthetic storage failure'); state.storage.delete(key); },
  };
  Object.defineProperty(window, 'sessionStorage', { value: storage, configurable: true });
  Object.defineProperty(global, 'sessionStorage', { value: storage, configurable: true });
  const tag = (name) => function Primitive({ children, testID, onPress, style, ...props }) {
    const clean = {};
    for (const [key, value] of Object.entries(props)) {
      if (['className', 'role', 'id', 'href', 'value', 'disabled', 'placeholder', 'onChange', 'onClick', 'type'].includes(key) || key.startsWith('data-') || key.startsWith('aria-')) clean[key] = value;
    }
    return React.createElement(name, { ...clean, 'data-testid': testID || clean['data-testid'], onClick: onPress || clean.onClick }, children);
  };
  const View = tag('div');
  const Text = tag('span');
  const Button = ({ loading, disabled, ...props }) => React.createElement(tag('button'), { ...props, disabled: disabled || loading });
  const Input = ({ label, onChangeText, testID, ...props }) => React.createElement('label', null, label,
    React.createElement('input', { value: props.value, placeholder: props.placeholder, 'data-testid': testID || props['data-testid'], onChange: onChangeText ? (e) => onChangeText(e.target.value) : props.onChange, disabled: props.disabled || props.editable === false }));
  const router = { push: (v) => state.navigations.push(v), replace: (v) => state.navigations.push(v) };
  const icons = new Proxy({}, { get: () => () => null });
  const motion = new Proxy({}, { get: (_, name) => {
    const key = `motion:${String(name)}`;
    if (!cache.has(key)) cache.set(key, tag(name));
    return cache.get(key);
  } });
  function from(table) {
    const query = { table, operations: [] };
    const builder = {};
    for (const name of ['select', 'eq', 'order', 'limit', 'gte', 'single', 'maybeSingle', 'insert', 'update']) {
      builder[name] = (...args) => { query.operations.push([name, ...args]); return builder; };
    }
    builder.then = (resolve, reject) => {
      state.queries.push(query);
      return Promise.resolve().then(() => state.db(query)).then(resolve, reject);
    };
    return builder;
  }
  const supabase = { from, auth: { getSession: async () => state.session } };
  function resolveLocal(file, request) {
    let candidate = request.startsWith('@/')
      ? path.join(root, file.includes(`${path.sep}mobile${path.sep}`) ? 'mobile' : 'src', request.slice(2))
      : path.resolve(path.dirname(file), request);
    for (const suffix of ['', '.ts', '.tsx', '/index.ts']) {
      if (fs.existsSync(candidate + suffix) && fs.statSync(candidate + suffix).isFile()) return candidate + suffix;
    }
    throw new Error(`Local module missing: ${request}`);
  }
  function load(filename) {
    const file = path.isAbsolute(filename) ? filename : path.join(root, filename);
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} };
    cache.set(file, mod.exports);
    function localRequire(request) {
      if (request === '@/hooks/useAuth') return { useAuth: () => state.auth };
      if (request === '@/store/auth') return { useAuth: (select) => select(state.nativeAuth) };
      if (request === '@/lib/supabase' || request === './supabase') return { createClient: () => supabase, supabase };
      if (request === 'next/navigation' || request === 'expo-router') return { useRouter: () => router, useFocusEffect: (effect) => React.useEffect(() => {
        const entry = { effect, cleanup: effect() };
        state.focusEffects.add(entry);
        return () => { entry.cleanup?.(); state.focusEffects.delete(entry); };
      }, [effect]) };
      if (request === 'next/link') return { default: tag('a'), __esModule: true };
      if (request === 'framer-motion') return { motion };
      if (request.startsWith('lucide-react')) return icons;
      if (request === 'sonner') return { toast: { success: (v) => state.alerts.push(v), error: (v) => state.alerts.push(v) } };
      if (request === 'react-native') return { Text, View, Pressable: Button, Platform: { OS: 'ios' }, ActivityIndicator: () => React.createElement('span', { role: 'status' }, 'Chargement…'), Alert: { alert: (...v) => state.alerts.push(v) }, Linking: { openURL: async (url) => state.calls.push({ url }) } };
      if (request === 'expo-modules-core') return { uuid: { v4: () => { state.uuidCalls += 1; if (state.uuidError) throw new Error('synthetic UUID failure'); return randomUUID(); } } };
      if (request === 'expo-secure-store') return {
        getItemAsync: async (key) => state.secureGet ? state.secureGet(key, storage) : storage.getItem(key),
        setItemAsync: async (key, value) => state.secureSet ? state.secureSet(key, value, storage) : storage.setItem(key, value),
        deleteItemAsync: async (key) => state.secureDelete ? state.secureDelete(key, storage) : storage.removeItem(key),
      };
      if (request === 'expo-haptics') return { selectionAsync: async () => {}, impactAsync: async () => {}, notificationAsync: async (kind) => state.haptics.push(kind), ImpactFeedbackStyle: { Medium: 'medium' }, NotificationFeedbackType: { Success: 'success', Error: 'error' } };
      if (request === '@/components/ui/AnimatedCounter') return { default: ({ value, suffix }) => React.createElement('span', { 'data-counter-value': value }, `${value}${suffix || ''}`), __esModule: true };
      if (request === '@/components/shared/ShareStoryButton') return { default: (props) => { state.shares.push(props); return React.createElement('button', { 'data-testid': 'share-props' }, `${props.headline} ${props.value} ${props.sub}`); }, __esModule: true };
      if (/^@\/components\/(ui\/)?(Card|Button|Input|Screen)$/.test(request)) {
        const name = request.split('/').pop();
        const component = name === 'Button' ? Button : name === 'Input' ? Input : View;
        return { default: component, [name]: component, __esModule: true };
      }
      if (request.startsWith('.') || request.startsWith('@/')) return load(resolveLocal(file, request));
      return requireTools(request);
    }
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    new Function('require', 'module', 'exports', js)(localRequire, mod, mod.exports);
    cache.set(file, mod.exports);
    return mod.exports;
  }
  async function render(filename, props = {}) {
    const Component = load(filename).default;
    let view;
    await React.act(async () => { view = testing.render(React.createElement(React.Suspense, { fallback: 'Chargement…' }, React.createElement(Component, props))); });
    return view;
  }
  function blur() { for (const entry of state.focusEffects) { entry.cleanup?.(); entry.cleanup = null; } }
  function focus() { for (const entry of state.focusEffects) entry.cleanup = entry.effect(); }
  return { ...testing, state, load, render, React, blur, focus };
}

module.exports = { harness, profile, item, scan, testing, React };
