// Shared lifecycle for isolated CI database tests. No production URL or TCP listener.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runLocalPostgres(configuration, run) {
  const options = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i], value = process.argv[i + 1];
    if (!['--pg-bin-dir', '--evidence-dir'].includes(name) || !value || options.has(name)) throw new Error('Expected --pg-bin-dir DIR --evidence-dir DIR');
    options.set(name, path.resolve(value));
  }
  if (options.size !== 2) throw new Error('Both local directory arguments are required');
  const { repository, mode } = configuration;
  const dependencies = process.env.VIDA_AIDE_VERIFICATION_NODE_MODULES;
  if (!dependencies) throw new Error('Set VIDA_AIDE_VERIFICATION_NODE_MODULES to the isolated verification dependencies');
  const { Client } = createRequire(path.join(path.dirname(dependencies), 'package.json'))('pg');
  const binaries = fs.realpathSync(options.get('--pg-bin-dir'));
  for (const name of ['initdb', 'postgres', 'pg_ctl']) assert.ok(fs.statSync(path.join(binaries, name)).isFile(), name);
  fs.mkdirSync(options.get('--evidence-dir'), { recursive: true });
  const output = fs.mkdtempSync(path.join(fs.realpathSync(options.get('--evidence-dir')), 'pg-'));
  const cluster = path.join(output, 'cluster'), socket = path.join(output, 's');
  assert.ok(Buffer.byteLength(path.join(socket, '.s.PGSQL.5432')) < 108, 'Use a shorter evidence directory for the UNIX socket');
  const sources = [...new Set([...configuration.sources, 'verification/local-postgres-fixture.cjs'])];
  const contents = Object.fromEntries(sources.map((name) => [name, fs.readFileSync(path.join(repository, name))]));
  const receipt = { status: 'RUNNING', mode, remote_connections: 0, provider_calls: 0, scenarios: [], transport_errors: [],
    source_sha256: Object.fromEntries(sources.map((name) => [name, hash(contents[name])])),
    binary_sha256: hash(fs.readFileSync(path.join(binaries, 'postgres'))),
    cleanup: { server_stopped: false, cluster_removed: false, socket_removed: false } };
  const clients = new Set();
  const save = () => fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  const environment = { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
  function command(name, args, logName, allowed = [0]) {
    const result = spawnSync(path.join(binaries, name), args, { encoding: 'utf8', timeout: 45000, env: environment });
    fs.writeFileSync(path.join(output, logName + '.log'), (result.stdout || '') + (result.stderr || ''));
    if (result.error || !allowed.includes(result.status)) throw new Error(`${name} failed: ${result.error?.message || result.status}`);
    return result;
  }
  async function connect(serviceRole = false) {
    const client = new Client({ host: socket, port: 5432, database: 'postgres', user: 'postgres',
      password: 'offline_fixture_only', ssl: false, application_name: 'vida-local-postgres-fixture',
      connectionTimeoutMillis: 10000, query_timeout: 30000, statement_timeout: 20000 });
    clients.add(client);
    client.on('error', (error) => receipt.transport_errors.push({ code: error.code || null, message: error.message }));
    await client.connect();
    if (serviceRole) await client.query('SET ROLE service_role');
    return client;
  }
  async function closeClient(client) { await client.end(); clients.delete(client); }
  async function observeLockOverlap(control, pids) {
    const until = Date.now() + 12000;
    while (Date.now() < until) {
      await control.query('SELECT pg_stat_clear_snapshot()');
      const result = await control.query("SELECT pid,state,wait_event_type FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND state='active' AND wait_event_type='Lock'", [pids]);
      if (result.rows.length === pids.length) return result.rows;
      await sleep(25);
    }
    throw new Error(`${pids.length} simultaneous server-side lock waits were not observed`);
  }
  async function cleanup() {
    const ended = await Promise.allSettled([...clients].map((client) => client.end()));
    if (ended.some((result) => result.status === 'rejected')) receipt.cleanup.client_end_error = true;
    if (fs.existsSync(path.join(cluster, 'PG_VERSION'))) {
      const status = command('pg_ctl', ['status', '-D', cluster], 'status-before-stop', [0, 3]);
      if (status.status === 0) command('pg_ctl', ['stop', '-D', cluster, '-m', 'fast', '-w', '-t', '30'], 'stop');
      assert.equal(command('pg_ctl', ['status', '-D', cluster], 'status-after-stop', [3]).status, 3);
    }
    receipt.cleanup.server_stopped = true;
    for (const directory of [cluster, socket]) fs.rmSync(directory, { recursive: true, force: true });
    receipt.cleanup.cluster_removed = !fs.existsSync(cluster); receipt.cleanup.socket_removed = !fs.existsSync(socket);
    assert.ok(receipt.cleanup.cluster_removed && receipt.cleanup.socket_removed);
    assert.ok(!receipt.cleanup.client_end_error, 'A PostgreSQL client failed to close cleanly');
  }
  try {
    for (const name of sources) { const destination = path.join(output, 'sources', name); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, contents[name]); }
    receipt.version = command('postgres', ['--version'], 'version').stdout.trim(); save();
    command('initdb', ['-D', cluster, '--username=postgres', '--auth=trust', '--encoding=UTF8', '--no-locale', '--no-sync'], 'initdb');
    fs.mkdirSync(socket, { mode: 0o700 });
    assert.ok(!/[\r\n]/.test(socket), 'Invalid socket directory');
    const quotedSocket = socket.replace(/\\/g, '\\\\').replace(/'/g, "''");
    fs.appendFileSync(path.join(cluster, 'postgresql.conf'), `\nlisten_addresses = ''\nunix_socket_directories = '${quotedSocket}'\nunix_socket_permissions = 0700\nport = 5432\nmax_connections = 24\nshared_buffers = '16MB'\n`);
    command('pg_ctl', ['start', '-D', cluster, '-l', path.join(output, 'postgres.log'), '-w', '-t', '30'], 'start');
    const control = await connect(false);
    assert.equal((await control.query('SHOW listen_addresses')).rows[0].listen_addresses, '');
    assert.equal((await control.query('SHOW unix_socket_directories')).rows[0].unix_socket_directories, socket);
    await control.query(`DO $$ DECLARE observed oid; attempts integer:=0; BEGIN LOOP
      CREATE TEMP TABLE fixture_oid_probe(id integer); SELECT 'pg_temp.fixture_oid_probe'::regclass::oid INTO observed; DROP TABLE fixture_oid_probe;
      attempts:=attempts+1; EXIT WHEN observed>=16384; IF attempts>4096 THEN RAISE EXCEPTION 'OID calibration exceeded bound'; END IF;
      END LOOP; END; $$;`);
    await run({ repository, output, contents, receipt, save, environment, dependencies, control, connect, closeClient, observeLockOverlap });
    for (const name of sources) assert.equal(hash(fs.readFileSync(path.join(repository, name))), receipt.source_sha256[name], 'Source changed during test: ' + name);
    assert.equal(receipt.transport_errors.length, 0, 'Unexpected PostgreSQL connection failure');
    receipt.status = 'PASS';
  } catch (error) { receipt.status = 'FAIL'; receipt.error = error.message; receipt.error_stack = error.stack; process.exitCode = 1; }
  finally {
    try { await cleanup(); } catch (error) { receipt.status = 'FAIL'; receipt.cleanup.error = error.message; process.exitCode = 1; }
    save(); console.log(JSON.stringify({ status: receipt.status, receipt: path.join(output, 'receipt.json') }));
  }
}
module.exports = { runLocalPostgres };
