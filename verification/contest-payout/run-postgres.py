"""Exercise actual contest allocations and migration on a fresh native database.

Single-user PostgreSQL: no socket, production URL, provider, or concurrency claim.
The RPC payload is emitted by the real cron handler, not reconstructed in SQL.
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
    output = Path(tempfile.mkdtemp(prefix='contest-', dir=args.evidence_dir.resolve()))
    cluster = output / 'cluster'
    paths = {
        'setup': 'verification/profiles-permissions/setup.sql', 'schema': 'schema.sql',
        'profiles': 'migrations/0004_profiles_client_permissions.sql',
        'stripe': 'migrations/0005_stripe_atomic_fulfillment.sql',
        'scan': 'migrations/0006_scan_admission.sql',
        'contest': 'migrations/0007_weekly_contest_receipts.sql',
        'seed': 'verification/contest-payout/seed.sql', 'support': 'verification/contest-payout/support.sql',
        'cases': 'verification/contest-payout/cases.sql',
    }
    other_sources = ['src/app/api/cron/contest-weekly/route.ts', 'verification/contest-payout/harness.cjs',
                     'verification/contest-payout/emit-fixture.cjs', 'verification/contest-payout/run-postgres.py',
                     'verification/package-lock.json']
    source_bytes = {name: (repository / name).read_bytes() for name in [*paths.values(), *other_sources]}
    sources = {key: source_bytes[name].decode() for key, name in paths.items()}
    receipt = {
        'status': 'RUNNING', 'mode': 'native PostgreSQL single-user',
        'version': subprocess.check_output([str(postgres), '--version'], text=True).strip(),
        'binary_sha256': hashlib.sha256(postgres.read_bytes()).hexdigest(),
        'source_sha256': {name: hashlib.sha256(value).hexdigest() for name, value in source_bytes.items()},
        'cases': [], 'remote_connections': 0, 'concurrent_sessions': 0, 'provider_calls': 0,
        'cluster_removed': False,
        'limits': ['Auth/DB acquisition in the emitted HTTP fixture is synthetic; all settlement SQL executes in PostgreSQL.',
                   'Single-user mode proves values, rollback and permissions, not simultaneous transactions.'],
    }

    def save():
        (output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')

    def run(name, sql, expected_failure=None):
        marker = 'VIDA_CONTEST_PASS_' + name
        transport = '\n'.join(line for line in sql.splitlines() if line.strip())
        transport += "\nSELECT '" + marker + "';\n\n"
        (output / (name + '.sql')).write_text(sql)
        result = subprocess.run([str(postgres), '--single', '-D', str(cluster), '-j',
                                 '-c', 'shared_buffers=16MB', 'postgres'],
                                input=transport, text=True, capture_output=True, timeout=40)
        log = result.stdout + result.stderr
        (output / (name + '.log')).write_text(log)
        errors = re.findall(r'^.*(?:ERROR:|FATAL:|PANIC:).*$', log, re.M)
        if expected_failure:
            passed = result.returncode == 0 and len(errors) == 1 and expected_failure in errors[0]
        else:
            passed = result.returncode == 0 and not errors and marker in log
        case = {'case': name, 'status': ('EXPECTED_FAILURE_PROVED' if expected_failure else 'PASS') if passed else 'FAIL',
                'exit_code': result.returncode, 'errors': errors}
        receipt['cases'].append(case)
        save()
        print(json.dumps(case), flush=True)
        if not passed:
            raise RuntimeError('PostgreSQL contest verification failed: ' + name)

    try:
        for name, value in source_bytes.items():
            copied = output / 'sources' / name
            copied.parent.mkdir(parents=True, exist_ok=True)
            copied.write_bytes(value)
        initialized = subprocess.run([str(initdb), '-D', str(cluster), '--auth=trust', '--encoding=UTF8', '--no-locale', '--no-sync'],
                                     capture_output=True, text=True, timeout=40)
        (output / 'initdb.log').write_text(initialized.stdout + initialized.stderr)
        if initialized.returncode:
            raise RuntimeError('Cannot initialize disposable cluster')
        run('normal_user_oid_calibration', """
DO $$ DECLARE observed oid; attempts integer:=0; BEGIN LOOP
 CREATE TEMP TABLE contest_oid_probe(id integer);
 SELECT 'pg_temp.contest_oid_probe'::regclass::oid INTO observed;
 DROP TABLE contest_oid_probe;
 attempts:=attempts+1;
 IF observed>=16384 THEN RAISE NOTICE 'NORMAL_OID_READY %, allocations %',observed,attempts; EXIT; END IF;
 IF attempts>4096 THEN RAISE EXCEPTION 'OID calibration bound exceeded'; END IF;
END LOOP; END; $$;
""")
        run('setup_with_pre_migration_history', sources['setup'] + '\n' + sources['schema'] + '\n' + sources['seed'])
        migrations = '\n'.join(sources[key] for key in ('profiles', 'stripe', 'scan', 'contest'))
        run('apply_migrations', migrations)
        emitted = subprocess.run(['node', '--preserve-symlinks', '--max-old-space-size=256', str(directory / 'emit-fixture.cjs')],
                                 cwd=repository, capture_output=True, text=True, timeout=30, env=os.environ.copy())
        (output / 'emit-fixture.log').write_text(emitted.stderr)
        if emitted.returncode:
            raise RuntimeError('Actual cron fixture failed: ' + emitted.stderr[-1000:])
        fixture = json.loads(emitted.stdout)
        for name, digest in fixture['source_sha256'].items():
            if receipt['source_sha256'].get(name) != digest:
                raise RuntimeError('Handler source changed during fixture emission: ' + name)
        (output / 'actual-handler-fixture.json').write_text(json.dumps(fixture, indent=2) + '\n')
        dependencies = Path(os.environ['VIDA_AIDE_VERIFICATION_NODE_MODULES'])
        receipt['fixture_runtime'] = {name: json.loads((dependencies / name / 'package.json').read_text())['version']
                                      for name in ('typescript', 'next', 'zod')}
        literal = json.dumps(fixture).replace("'", "''")
        run('actual_handler_fixture', "INSERT INTO contest_test.fixture VALUES('" + literal + "'::jsonb);\n" + sources['support'])
        parts = re.split(r'^-- CASE: ([a-z_]+)\s*$', sources['cases'], flags=re.M)
        cases = {parts[i]: parts[i + 1] for i in range(1, len(parts), 2)}
        if len(cases) != 19:
            raise RuntimeError('Expected nineteen contest behavior cases')
        for name, sql in cases.items():
            run(name, sql)
        run('reapply_all_migrations', migrations)
        run('reapplied_history', cases['historical_rows_and_marker_preserved'])
        run('reapplied_acl', cases['client_rpc_and_direct_close_denied'])
        run('inject_unexpected_inherited_rpc_grant', """
CREATE ROLE contest_unexpected_executor NOLOGIN;
GRANT EXECUTE ON FUNCTION vida_aide.settle_weekly_contest_v1(uuid,integer,timestamptz,jsonb) TO contest_unexpected_executor;
GRANT contest_unexpected_executor TO authenticated;
""")
        run('inherited_rpc_grant_refuses_migration', sources['contest'], 'Unexpected inherited contest settlement privileges')
        run('refusal_did_not_hide_the_existing_grant', """
SELECT contest_test.check_true(has_function_privilege('authenticated','vida_aide.settle_weekly_contest_v1(uuid,integer,timestamptz,jsonb)','EXECUTE'),'fixture inherited grant unexpectedly removed');
""")
        run('restore_fixture_role', """
REVOKE contest_unexpected_executor FROM authenticated;
REVOKE EXECUTE ON FUNCTION vida_aide.settle_weekly_contest_v1(uuid,integer,timestamptz,jsonb) FROM contest_unexpected_executor;
DROP ROLE contest_unexpected_executor;
""" + sources['contest'])
        run('final_acl', cases['client_rpc_and_direct_close_denied'])
        run('final_history', cases['historical_rows_and_marker_preserved'])
        for name, value in source_bytes.items():
            if (repository / name).read_bytes() != value:
                raise RuntimeError('Source changed during native verification: ' + name)
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
