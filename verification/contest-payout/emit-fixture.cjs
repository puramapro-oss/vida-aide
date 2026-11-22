const { createContestHarness, withSecret, secret } = require('./harness.cjs');
withSecret(secret, async () => {
  const harness = createContestHarness();
  const response = await harness.POST(harness.request());
  if (response.status !== 200 || harness.calls.rpc.length !== 1 || harness.calls.forbiddenWrites.length !== 0) {
    throw new Error('The real weekly handler did not emit one atomic settlement fixture');
  }
  process.stdout.write(JSON.stringify({ args: harness.calls.rpc[0].args, source_sha256: harness.calls.source_sha256 }));
}).catch((error) => { process.stderr.write(error.message); process.exitCode = 1; });
