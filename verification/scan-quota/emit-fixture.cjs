const assert = require('node:assert/strict');
const { createScanHarness } = require('../scan/scan-route-harness.cjs');
(async () => {
  const h = createScanHarness();
  const response = await h.POST(h.request());
  assert.equal(response.status, 200);
  assert.equal(h.calls.provider.length, 1);
  const reserve = h.calls.rpc.find((call) => call.name === 'reserve_scan_v1');
  const finish = h.calls.rpc.find((call) => call.name === 'finish_scan_v1' && call.args.p_result);
  assert.ok(reserve && finish);
  assert.equal(reserve.args.p_request_id, finish.args.p_request_id);
  process.stdout.write(JSON.stringify({ reserve: reserve.args, finish: finish.args }) + '\n');
})().catch((error) => { console.error(error); process.exitCode = 1; });
