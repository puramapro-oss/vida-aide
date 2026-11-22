const test = require('node:test');
const assert = require('node:assert/strict');
const { createScanHarness, item, modelResult } = require('./scan-route-harness.cjs');
async function submit(harness) {
  const response = await harness.POST(harness.request());
  return { response, body: await response.json() };
}
function assertBeforeProfile(harness) {
  assert.equal(harness.calls.updates.length, 0);
  assert.equal(harness.calls.inserts.filter((q) => q.table === 'notifications').length, 0);
}

test('mixed periods are summed in cents; annual and one-time candidates do not inflate the monthly total', async () => {
  const h = createScanHarness({ providerResult: {
    summary: modelResult.summary,
    results: [
      { ...item, montant_estime: 10.005, unite: 'mois' },
      { ...item, montant_estime: 25.125, unite: 'an' },
      { ...item, montant_estime: 5.015, unite: 'unique' },
    ], total_recoverable: 150.27, total_recoverable_monthly: 10.01,
  } });
  const { response, body } = await submit(h);
  assert.equal(response.status, 200);
  assert.equal(body.total_recoverable, 150.27);
  assert.equal(body.total_recoverable_monthly, 10.01);
});

test('decimal half cents use decimal rounding, including 10.075', async () => {
  const h = createScanHarness({ providerResult: {
    ...modelResult, results: [{ ...item, montant_estime: 10.075 }],
    total_recoverable: 120.96, total_recoverable_monthly: 10.08,
  } });
  assert.equal((await submit(h)).response.status, 200);
});

test('binary representation does not inflate 0.1 plus 0.2', async () => {
  const h = createScanHarness({ providerResult: {
    ...modelResult, results: [{ ...item, montant_estime: 0.1 }, { ...item, montant_estime: 0.2 }],
    total_recoverable: 3.6, total_recoverable_monthly: 0.3,
  } });
  assert.equal((await submit(h)).response.status, 200);
});

test('the tolerance is at most one cent for each declared total', async () => {
  const h = createScanHarness({ providerResult: {
    ...modelResult, total_recoverable: 1200.01, total_recoverable_monthly: 99.99,
  } });
  assert.equal((await submit(h)).response.status, 200);
});

for (const delta of [
  { total_recoverable: 2400 }, { total_recoverable_monthly: 1200 },
  { total_recoverable: 1200.02 }, { total_recoverable_monthly: 99.98 },
  { results: [], total_recoverable: 1200, total_recoverable_monthly: 100 },
]) {
  test(`incoherent model aggregates cannot finalize a reserved result: ${JSON.stringify(delta)}`, async () => {
    const h = createScanHarness({ providerResult: { ...modelResult, ...delta } });
    assert.equal((await submit(h)).response.status, 502);
    assert.equal(h.calls.inserts.filter((q) => q.table === 'scans').length, 1);
    assert.equal(h.calls.finalizations.length, 0);
    assert.deepEqual(h.calls.failures.map((f) => f.code), ['invalid_model_result']);
    assertBeforeProfile(h);
  });
}

test('a receipt with correct ownership but inflated aggregates remains unconfirmed', async () => {
  const h = createScanHarness({ scanReply: (receipt) => ({ data: { ...receipt, total_recoverable: 2400 }, error: null }) });
  const { response, body } = await submit(h);
  assert.equal(response.status, 500);
  assert.equal(body.code, 'scan_save_unconfirmed');
  assertBeforeProfile(h);
});

test('an empty set of candidates with zero estimates is a valid saved result', async () => {
  const h = createScanHarness({ providerResult: {
    ...modelResult, results: [], total_recoverable: 0, total_recoverable_monthly: 0,
  } });
  const { response, body } = await submit(h);
  assert.equal(response.status, 200);
  assert.deepEqual(body.results, []);
  assert.equal(body.total_recoverable, 0);
});
