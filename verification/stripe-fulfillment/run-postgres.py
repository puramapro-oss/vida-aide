"""Exercise the real Stripe migration on a fresh native PostgreSQL single-user DB.

No external account, socket, server, real payment or concurrency assertion.
The normalized RPC fixture is emitted by the actual signed HTTP handler.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin-dir', type=Path, required=True)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    args = parser.parse_args()
    directory = Path(__file__).resolve().parent
    repository = directory.parents[1]
    postgres = args.pg_bin_dir.resolve() / 'postgres'
    initdb = args.pg_bin_dir.resolve() / 'initdb'
    if not postgres.is_file() or not initdb.is_file():
        raise SystemExit('An existing PostgreSQL binary directory is required')
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix='stripe-', dir=args.evidence_dir.resolve()))
    cluster = output / 'cluster'
    inputs = {
        'setup': repository / 'verification/profiles-permissions/setup.sql',
        'schema': repository / 'schema.sql',
        'profile_migration': repository / 'migrations/0004_profiles_client_permissions.sql',
        'stripe_migration': repository / 'migrations/0005_stripe_atomic_fulfillment.sql',
        'seed': directory / 'seed.sql', 'support': directory / 'support.sql',
        'cases': directory / 'cases.sql',
    }
    source = {key: path.read_text() for key, path in inputs.items()}
    receipt = {
        'status': 'RUNNING', 'mode': 'native PostgreSQL single-user',
        'version': subprocess.check_output([str(postgres), '--version'], text=True).strip(),
        'binary_sha256': hashlib.sha256(postgres.read_bytes()).hexdigest(),
        'source_sha256': {name: hashlib.sha256(text.encode()).hexdigest() for name, text in source.items()},
        'cases': [], 'remote_connections': 0, 'concurrent_sessions': 0,
        'evidence': str(output), 'cluster_removed': False,
        'http_fixture_source_sha256': {name: hashlib.sha256((repository / name).read_bytes()).hexdigest() for name in [
            'src/lib/stripe-fulfillment.ts', 'src/app/api/stripe/webhook/route.ts',
            'src/app/api/internal/stripe-fulfillment/route.ts', 'verification/stripe-fulfillment/harness.cjs',
            'verification/stripe-fulfillment/emit-fixture.cjs', 'verification/stripe-fulfillment/runtime.cjs',
        ]},
    }
    def save():
        (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    def run(name, sql):
        marker = 'VIDA_STRIPE_PASS_' + name
        transport = '\n'.join(line for line in sql.splitlines() if line.strip())
        transport += "\nSELECT '" + marker + "';\n\n"
        (output / (name + '.sql')).write_text(sql)
        result = subprocess.run([str(postgres), '--single', '-D', str(cluster), '-j',
                                 '-c', 'shared_buffers=16MB', 'postgres'],
                                input=transport, text=True, capture_output=True, timeout=40)
        log = result.stdout + result.stderr
        (output / (name + '.log')).write_text(log)
        errors = re.findall(r'^.*(?:ERROR:|FATAL:|PANIC:).*$', log, re.M)
        passed = result.returncode == 0 and not errors and marker in log
        case = {'case': name, 'status': 'PASS' if passed else 'FAIL', 'exit_code': result.returncode, 'errors': errors}
        receipt['cases'].append(case)
        save()
        print(json.dumps(case), flush=True)
        if not passed:
            raise RuntimeError('PostgreSQL verification failed: ' + name)
    try:
        initialized = subprocess.run([str(initdb), '-D', str(cluster), '--auth=trust', '--encoding=UTF8', '--no-locale', '--no-sync'],
                                     capture_output=True, text=True, timeout=40)
        (output / 'initdb.log').write_text(initialized.stdout + initialized.stderr)
        if initialized.returncode:
            raise RuntimeError('Cannot initialize disposable cluster')
        run('normal_user_oid_calibration', """
DO $$ DECLARE observed oid; attempts integer:=0; BEGIN LOOP
  CREATE TEMP TABLE stripe_oid_probe(id integer);
  SELECT 'pg_temp.stripe_oid_probe'::regclass::oid INTO observed;
  DROP TABLE stripe_oid_probe;
  attempts:=attempts+1;
  IF observed>=16384 THEN RAISE NOTICE 'NORMAL_OID_READY %, allocations %',observed,attempts; EXIT; END IF;
  IF attempts>4096 THEN RAISE EXCEPTION 'OID calibration bound exceeded'; END IF;
END LOOP; END; $$;
""")
        run('setup', source['setup'] + '\n' + source['schema'] + '\n' + source['seed'])
        run('apply_migrations', source['profile_migration'] + '\n' + source['stripe_migration'])
        emitted = subprocess.run(['node', '--max-old-space-size=256', str(directory / 'emit-fixture.cjs')],
                                 cwd=repository, capture_output=True, text=True, timeout=30, env=os.environ.copy())
        if emitted.returncode:
            raise RuntimeError('Signed handler fixture failed: ' + emitted.stderr[-1000:])
        runtime = subprocess.run(['node', str(directory / 'runtime.cjs')], cwd=repository,
                                 capture_output=True, text=True, timeout=30, env=os.environ.copy())
        if runtime.returncode:
            raise RuntimeError('Cannot identify fixture runtime')
        receipt['http_fixture_runtime'] = json.loads(runtime.stdout)
        fixture = json.loads(emitted.stdout)
        (output / 'actual-handler-fixture.json').write_text(json.dumps(fixture, indent=2) + '\n')
        literal = json.dumps(fixture).replace("'", "''")
        run('actual_handler_fixture', "INSERT INTO stripe_test.fixture VALUES('" + literal + "'::jsonb);\n" + source['support'])
        pieces = re.split(r'^-- CASE: ([a-z_]+)\s*$', source['cases'], flags=re.M)
        cases = {pieces[i]: pieces[i+1] for i in range(1, len(pieces), 2)}
        if len(cases) != 16:
            raise RuntimeError('Expected sixteen Stripe behavior cases')
        for name, sql in cases.items():
            run(name, sql)
        run('reapply_both_migrations', source['profile_migration'] + '\n' + source['stripe_migration'])
        run('reapplied_permissions', cases['private_registry_and_rpc'])
        run('reapplied_history', cases['historical_values_and_cutover_preserved'])
        receipt['status'] = 'PASS'
        receipt['behavior_cases'] = len(cases)
    except Exception as error:
        receipt['status'] = 'FAIL'
        receipt['error'] = str(error)
        raise
    finally:
        if cluster.exists():
            shutil.rmtree(cluster)
        receipt['cluster_removed'] = not cluster.exists()
        save()
        print(json.dumps({'status': receipt['status'], 'receipt': str(output / 'receipt.json')}), flush=True)


if __name__ == '__main__':
    main()
