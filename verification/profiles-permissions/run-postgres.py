"""Run real profile permission checks on a new disposable PostgreSQL cluster.

No socket, remote connection, provider or concurrent-session claim. Requires an
existing PostgreSQL bin directory; does not install or alter that runtime.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pg-bin-dir", type=Path, required=True)
    parser.add_argument("--evidence-dir", type=Path, required=True)
    args = parser.parse_args()
    directory = Path(__file__).resolve().parent
    repository = directory.parents[1]
    postgres = args.pg_bin_dir.resolve() / "postgres"
    initdb = args.pg_bin_dir.resolve() / "initdb"
    if not postgres.is_file() or not initdb.is_file():
        raise SystemExit("An existing local PostgreSQL bin directory is required")
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="profiles-", dir=args.evidence_dir.resolve()))
    cluster = output / "cluster"
    inputs = {
        "schema": repository / "schema.sql",
        "migration": repository / "migrations/0004_profiles_client_permissions.sql",
        "setup": directory / "setup.sql",
        "seed": directory / "seed.sql",
        "cases": directory / "cases.sql",
    }
    source = {name: path.read_text() for name, path in inputs.items()}
    receipt = {
        "status": "RUNNING", "mode": "native PostgreSQL single-user",
        "version": subprocess.check_output([str(postgres), "--version"], text=True).strip(),
        "binary_sha256": hashlib.sha256(postgres.read_bytes()).hexdigest(),
        "source_sha256": {name: hashlib.sha256(text.encode()).hexdigest() for name, text in source.items()},
        "cases": [], "remote_connections": 0, "concurrent_sessions": 0,
        "evidence": str(output), "cluster_removed": False,
    }

    def save():
        (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")

    def run(name, sql, expected_failure=None):
        marker = "VIDA_PROFILE_PASS_" + name
        # -j terminates a single-user input on semicolon plus an empty line.
        # Preserve comments/newlines, remove only empty transport lines.
        command = "\n".join(line for line in sql.splitlines() if line.strip())
        command += "\nSELECT '" + marker + "';\n\n"
        (output / (name + ".sql")).write_text(sql)
        result = subprocess.run(
            [str(postgres), "--single", "-D", str(cluster), "-j",
             "-c", "shared_buffers=16MB", "postgres"],
            input=command, text=True, capture_output=True, timeout=40,
        )
        log = result.stdout + result.stderr
        (output / (name + ".log")).write_text(log)
        errors = re.findall(r"^.*(?:ERROR:|FATAL:|PANIC:).*$", log, re.M)
        if expected_failure:
            passed = len(errors) == 1 and expected_failure in errors[0]
            status = "EXPECTED_FAILURE_PROVED" if passed else "FAIL"
        else:
            passed = result.returncode == 0 and not errors and marker in log
            status = "PASS" if passed else "FAIL"
        case = {"case": name, "status": status, "exit_code": result.returncode, "errors": errors}
        receipt["cases"].append(case)
        save()
        print(json.dumps(case), flush=True)
        if not passed:
            raise RuntimeError("PostgreSQL verification failed: " + name)

    try:
        initialized = subprocess.run(
            [str(initdb), "-D", str(cluster), "--auth=trust", "--encoding=UTF8", "--no-locale", "--no-sync"],
            capture_output=True, text=True, timeout=40,
        )
        (output / "initdb.log").write_text(initialized.stdout + initialized.stderr)
        if initialized.returncode:
            raise RuntimeError("Cannot initialize disposable PostgreSQL cluster")
        run("normal_user_oid_calibration", """
DO $$ DECLARE observed oid; attempts integer := 0; BEGIN LOOP
  CREATE TEMP TABLE profile_oid_probe (id integer);
  SELECT 'pg_temp.profile_oid_probe'::regclass::oid INTO observed;
  DROP TABLE profile_oid_probe;
  attempts := attempts + 1;
  IF observed >= 16384 THEN
    RAISE NOTICE 'NORMAL_OID_READY %, allocations %', observed, attempts;
    EXIT;
  END IF;
  IF attempts > 4096 THEN RAISE EXCEPTION 'OID calibration exceeded bound'; END IF;
END LOOP; END; $$;
""")
        run("setup", source["setup"] + "\n" + source["schema"] + "\n" + source["seed"])
        pieces = re.split(r"^-- CASE: ([a-z_]+)\s*$", source["cases"], flags=re.M)
        cases = {pieces[i]: pieces[i + 1] for i in range(1, len(pieces), 2)}
        if len(cases) != 11:
            raise RuntimeError("Expected eleven SQL behavior cases")
        run("baseline_rls_environment", cases["rls_environment"])
        run("baseline_privileged_update", cases["reject_privileged_update"], "ASSERTION: privileged update accepted")
        run("baseline_forged_insert", cases["reject_client_insert"], "ASSERTION: forged profile insert accepted")
        run("apply_migration", source["migration"])
        for name, sql in cases.items():
            run(name, sql)
        run("reapply_migration", source["migration"])
        run("reapplied_history", cases["historical_rows_and_server_grants_preserved"])
        run("reapplied_acl", cases["effective_client_acl"])
        run("unexpected_inherited_grant_fixture", """
CREATE ROLE profile_unexpected_writer NOLOGIN;
GRANT UPDATE ON vida_aide.profiles TO profile_unexpected_writer;
GRANT profile_unexpected_writer TO authenticated;
""")
        run("unexpected_inheritance_aborts_migration", source["migration"], "Unexpected inherited client profile privileges")
        run("restore_fixture_role", """
REVOKE profile_unexpected_writer FROM authenticated;
REVOKE UPDATE ON vida_aide.profiles FROM profile_unexpected_writer;
DROP ROLE profile_unexpected_writer;
""" + source["migration"])
        run("final_history", cases["historical_rows_and_server_grants_preserved"])
        run("final_acl", cases["effective_client_acl"])
        receipt["status"] = "PASS"
        receipt["behavior_cases"] = len(cases)
    except Exception as error:
        receipt["status"] = "FAIL"
        receipt["error"] = str(error)
        raise
    finally:
        # Only this invocation's freshly initialized cluster is removed.
        if cluster.exists():
            shutil.rmtree(cluster)
        receipt["cluster_removed"] = not cluster.exists()
        save()
        print(json.dumps({"status": receipt["status"], "receipt": str(output / "receipt.json")}), flush=True)


if __name__ == "__main__":
    main()
