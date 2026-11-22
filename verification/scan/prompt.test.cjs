// Real claude.ts; the SDK constructor, environment and paid response are simulated.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requireTools, modelResult } = require('./scan-route-harness.cjs');
const ts = requireTools('typescript');

function fixture() {
  const calls = [];
  const options = [];
  class MockAnthropic {
    constructor() {
      this.messages = { create: async (request, transport) => {
        calls.push(structuredClone(request));
        options.push(transport);
        return { content: [{ type: 'text', text: JSON.stringify(modelResult) }] };
      } };
    }
  }
  const filename = path.resolve(__dirname, '../../src/lib/claude.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  const requireBoundary = (name) => {
    if (name !== '@anthropic-ai/sdk') throw new Error(`Unexpected runtime import: ${name}`);
    return { default: MockAnthropic, __esModule: true };
  };
  new Function('require', 'module', 'exports', 'process', code)(requireBoundary, mod, mod.exports,
    { env: { ANTHROPIC_API_KEY: 'synthetic-unused-key' } });
  return { calls, options, ...mod.exports };
}

test('real structured scan sends unverified-estimate rules and preserves existing models/schema', async () => {
  const f = fixture();
  for (const [plan, model, maxTokens] of [
    ['free', 'claude-haiku-4-5-20251001', 4096], ['premium', 'claude-sonnet-4-20250514', 16384],
  ]) {
    for (const type of ['financial', 'fiscal', 'forgotten_money']) {
      const result = await f.scanFinancialJSON({ emploi: 'salarie', revenus_mensuels_nets: 1500 }, type, plan);
      assert.deepEqual(result, modelResult);
      const request = f.calls.at(-1);
      assert.equal(request.model, model);
      assert.equal(request.max_tokens, maxTokens);
      assert.equal(f.options.at(-1).maxRetries, 0);
      assert.equal(request.system, f.getAideIASystemPrompt());
      assert.match(request.system, /assistant IA/);
      assert.match(request.system, /ne prouve ni l'éligibilité, ni un droit acquis, ni un versement/);
      assert.match(request.system, /Ne confonds jamais estimation du scan, historique déclaratif, solde du portefeuille/);
      assert.match(request.system, /exclut les aides annuelles et ponctuelles/);
      assert.match(request.system, /Ne fabrique ni citation légale, ni URL précise/);
      const content = request.messages[0].content;
      for (const field of ['summary', 'total_recoverable', 'total_recoverable_monthly', 'results', 'aide', 'montant_estime', 'unite', 'conditions', 'organisme']) {
        assert.ok(content.includes(`"${field}"`), `missing existing field ${field}`);
      }
      assert.match(content, /Revenus mensuels nets : 1500€/);
    }
  }
  assert.equal(f.calls.length, 6);
});

test('real scan passes the cancellation signal to the SDK and disables hidden HTTP retries', async () => {
  const f = fixture();
  const controller = new AbortController();
  await f.scanFinancialJSON({ revenus_mensuels_nets: 0 }, 'financial', 'free', controller.signal);
  assert.equal(f.options[0].signal, controller.signal);
  assert.equal(f.options[0].maxRetries, 0);
  controller.abort();
  assert.equal(f.options[0].signal.aborted, true);
  assert.equal(f.calls.length, 1);
});

test('real prompt preserves declared zero income, rent, dependents and negative disability declaration', async () => {
  const f = fixture();
  await f.scanFinancialJSON({ revenus_mensuels_nets: 0, revenus_annuels_bruts: 0, loyer_mensuel: 0,
    enfants: 0, enfants_a_charge: 0, handicap: false, handicap_taux: 0 }, 'financial');
  const content = f.calls[0].messages[0].content;
  assert.match(content, /Revenus mensuels nets : 0€/);
  assert.match(content, /Revenus annuels bruts : 0€/);
  assert.match(content, /Loyer : 0€\/mois/);
  assert.match(content, /Enfants : 0/);
  assert.match(content, /Enfants à charge : 0/);
  assert.match(content, /Handicap déclaré : non/);
  assert.doesNotMatch(content, /Handicap déclaré : oui/);
  await f.scanFinancialJSON({ handicap: true, handicap_taux: 0 }, 'financial');
  assert.match(f.calls[1].messages[0].content, /Handicap déclaré : oui \(taux 0%\)/);
});
