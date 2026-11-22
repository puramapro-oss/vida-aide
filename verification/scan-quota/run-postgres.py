"""Verify real scan admission SQL on a fresh, native PostgreSQL single-user DB.

No socket, production URL, paid provider or concurrency claim. The separate CI
gate proves simultaneous sessions; this gate proves values, ACLs and rollback.
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
    postgres, initdb = (args.pg_bin_dir.resolve() / name for name in ('postgres', 'initdb'))
    if not postgres.is_file() or not initdb.is_file():
        raise SystemExit('An existing PostgreSQL binary directory is required')
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix='scan-', dir=args.evidence_dir.resolve()))
    cluster = output / 'cluster'
    paths = {
        'setup': repository / 'verification/profiles-permissions/setup.sql',
        'schema': repository / 'schema.sql',
        'profiles': repository / 'migrations/0004_profiles_client_permissions.sql',
        'stripe': repository / 'migrations/0005_stripe_atomic_fulfillment.sql',
        'scan': repository / 'migrations/0006_scan_admission.sql',
        'seed': directory / 'seed.sql', 'cases': directory / 'cases.sql', 'support': directory / 'support.sql',
    }
    sources = {name: path.read_text() for name, path in paths.items()}
    handler_sources = [
        'src/app/api/scan/route.ts', 'src/lib/scan-result.ts', 'src/lib/scan-admission.ts',
        'src/lib/scan-provider.ts', 'src/lib/claude.ts', 'src/lib/constants.ts',
        'verification/scan/scan-route-harness.cjs', 'verification/scan/scan-rpc-double.cjs',
        'verification/scan-quota/emit-fixture.cjs',
    ]
    receipt = {
        'status': 'RUNNING', 'mode': 'native PostgreSQL single-user',
        'version': subprocess.check_output([str(postgres), '--version'], text=True).strip(),
        'binary_sha256': hashlib.sha256(postgres.read_bytes()).hexdigest(),
        'source_sha256': {name: hashlib.sha256(value.encode()).hexdigest() for name, value in sources.items()},
        'handler_source_sha256': {name: hashlib.sha256((repository / name).read_bytes()).hexdigest() for name in handler_sources},
        'cases': [], 'remote_connections': 0, 'concurrent_sessions': 0,
        'cluster_removed': False,
    }
    def save():
        (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    def run(name, sql, expected_failure=None):
        marker = 'VIDA_SCAN_PASS_' + name
        transport = '\n'.join(line for line in sql.splitlines() if line.strip())
        transport += "\nSELECT '" + marker + "';\n\n"
        (output / (name + '.sql')).write_text(sql)
        result = subprocess.run([str(postgres), '--single', '-D', str(cluster), '-j', '-c', 'shared_buffers=16MB', 'postgres'],
                                input=transport, text=True, capture_output=True, timeout=40)
        log = result.stdout + result.stderr
        (output / (name + '.log')).write_text(log)
        errors = re.findall(r'^.*(?:ERROR:|FATAL:|PANIC:).*$', log, re.M)
        passed = len(errors) == 1 and expected_failure in errors[0] if expected_failure else result.returncode == 0 and not errors and marker in log
        case = {'case': name, 'status': ('EXPECTED_FAILURE_PROVED' if expected_failure else 'PASS') if passed else 'FAIL', 'exit_code': result.returncode, 'errors': errors}
        receipt['cases'].append(case); save(); print(json.dumps(case), flush=True)
        if not passed:
            raise RuntimeError('PostgreSQL scan verification failed: ' + name)
    try:
        initialized = subprocess.run([str(initdb), '-D', str(cluster), '--auth=trust', '--encoding=UTF8', '--no-locale', '--no-sync'],
                                     capture_output=True, text=True, timeout=40)
        (output / 'initdb.log').write_text(initialized.stdout + initialized.stderr)
        if initialized.returncode:
            raise RuntimeError('Cannot initialize disposable cluster')
        run('normal_user_oid_calibration', """
DO $$ DECLARE observed oid; attempts integer:=0; BEGIN LOOP
 CREATE TEMP TABLE scan_oid_probe(id integer);
 SELECT 'pg_temp.scan_oid_probe'::regclass::oid INTO observed;
 DROP TABLE scan_oid_probe;
 attempts:=attempts+1;
 IF observed>=16384 THEN RAISE NOTICE 'NORMAL_OID_READY %, allocations %',observed,attempts; EXIT; END IF;
 IF attempts>4096 THEN RAISE EXCEPTION 'OID calibration bound exceeded'; END IF;
END LOOP; END; $$;
""")
        run('setup', sources['setup'] + '\n' + sources['schema'] + '\n' + sources['seed'])
        run('apply_migrations', sources['profiles'] + '\n' + sources['stripe'] + '\n' + sources['scan'])
        emitted = subprocess.run(['node', str(directory / 'emit-fixture.cjs')], cwd=repository,
                                 capture_output=True, text=True, timeout=30, env=os.environ.copy())
        if emitted.returncode:
            raise RuntimeError('Actual POST fixture failed: ' + emitted.stderr[-1000:])
        fixture = json.loads(emitted.stdout)
        (output / 'actual-handler-fixture.json').write_text(json.dumps(fixture, indent=2) + '\n')
        literal = json.dumps(fixture).replace("'", "''")
        run('actual_handler_fixture', "INSERT INTO scan_test.fixture VALUES('" + literal + "'::jsonb);\n" + sources['support'])
        parts = re.split(r'^-- CASE: ([a-z_]+)\s*$', sources['cases'], flags=re.M)
        cases = {parts[i]: parts[i+1] for i in range(1, len(parts), 2)}
        if len(cases) != 16:
            raise RuntimeError('Expected sixteen scan behavior cases')
        for name, sql in cases.items():
            run(name, sql)
        run('reapply_all_migrations', sources['profiles'] + '\n' + sources['stripe'] + '\n' + sources['scan'])
        run('reapplied_history', cases['historical_rows_and_money_preserved'])
        run('reapplied_acl', cases['client_cannot_forge_admission_or_completion'])
        run('unexpected_rpc_grant', """
CREATE ROLE scan_unexpected_executor NOLOGIN;
GRANT EXECUTE ON FUNCTION vida_aide.reserve_scan_v1(uuid,uuid,text,jsonb) TO scan_unexpected_executor;
GRANT scan_unexpected_executor TO authenticated;
""")
        run('inherited_rpc_grant_refuses_migration', sources['scan'], 'Unexpected inherited scan RPC privileges')
        run('restore_fixture_role', """
REVOKE scan_unexpected_executor FROM authenticated;
REVOKE EXECUTE ON FUNCTION vida_aide.reserve_scan_v1(uuid,uuid,text,jsonb) FROM scan_unexpected_executor;
DROP ROLE scan_unexpected_executor;
""" + sources['scan'])
        run('final_history', cases['historical_rows_and_money_preserved'])
        receipt['status'] = 'PASS'; receipt['behavior_cases'] = len(cases)
    except Exception as error:
        receipt['status'] = 'FAIL'; receipt['error'] = str(error)
        raise
    finally:
        if cluster.exists():
            shutil.rmtree(cluster)
        receipt['cluster_removed'] = not cluster.exists()
        save(); print(json.dumps({'status': receipt['status'], 'receipt': str(output / 'receipt.json')}), flush=True)


if __name__ == '__main__':
    main()
