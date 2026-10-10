"""Offline native PostgreSQL snapshots and empty-target recovery; never resume work."""

import hashlib
import json
import os
import re
import resource
import subprocess
import tempfile
from functools import wraps
from importlib.resources import files

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

from . import backup_files

VERSION = "agent-platform-backup-v1"
POSTGRES_MAJOR = 18
# Independently measured on a pristine PostgreSQL18 database after migrations001..016.
# Schema/catalog changes require deliberate fixture re-derivation and review, never self-trust.
SCHEMA_SHA256 = "6c504674e841d574792e93033ebdbc97593d4a73595f05409b7b73fc604a0386"
EPHEMERAL = ("sessions", "login_limits", "model_proxy_tokens", "tool_broker_tokens")
EXCLUDED = (*EPHEMERAL, "maintenance_identity")
NATIVE_TIMEOUT = 300
MIGRATION_LOCK = 77310401


def _guard(code):
    def decorate(function):
        @wraps(function)
        def safe(*args, **kwargs):
            try:
                return function(*args, **kwargs)
            except Exception as exc:
                if isinstance(exc, ValueError) and re.fullmatch("backup_[a-z_]{1,60}", str(exc)):
                    raise ValueError(str(exc)) from None
                raise ValueError(code) from None

        return safe

    return decorate


def _fail(code):
    raise ValueError(code)


def _connect(url):
    return psycopg.connect(
        url,
        connect_timeout=10,
        options="-c timezone=UTC -c statement_timeout=300000 -c lock_timeout=5000",
    )


def _native_environment(url):
    values = conninfo_to_dict(url)
    allowed = {
        "host": "PGHOST",
        "hostaddr": "PGHOSTADDR",
        "port": "PGPORT",
        "user": "PGUSER",
        "password": "PGPASSWORD",
        "dbname": "PGDATABASE",
        "sslmode": "PGSSLMODE",
        "sslrootcert": "PGSSLROOTCERT",
        "sslcert": "PGSSLCERT",
        "sslkey": "PGSSLKEY",
        "sslpassword": "PGSSLPASSWORD",
        "channel_binding": "PGCHANNELBINDING",
        "connect_timeout": "PGCONNECT_TIMEOUT",
        "application_name": "PGAPPNAME",
    }
    if not values.get("dbname") or any(key not in allowed for key in values):
        _fail("backup_connection_invalid")
    # Do not inherit PGOPTIONS, service/password files or other ambient libpq configuration.
    env = {
        key: os.environ[key]
        for key in ("PATH", "LANG", "LC_ALL", "SYSTEMROOT")
        if key in os.environ
    }
    env.update({allowed[key]: value for key, value in values.items()})
    env.update(
        PGPASSFILE=os.devnull,
        PGSERVICEFILE=os.devnull,
        PGCONNECT_TIMEOUT="10",
        PGOPTIONS="-c statement_timeout=300000 -c lock_timeout=5000",
    )
    return env


def _limits(limit):
    resource.setrlimit(resource.RLIMIT_FSIZE, (limit, limit))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


@_guard("backup_native_failed")
def _run_native(program, arguments, *, connection, stdin=None, stdout=None):
    """No shell or connection secrets in arguments; native stderr is deliberately suppressed."""
    with tempfile.TemporaryFile() as captured:
        subprocess.run(
            [program, *arguments],
            env=_native_environment(connection),
            stdin=stdin,
            stdout=stdout if stdout is not None else captured,
            stderr=subprocess.DEVNULL,
            timeout=NATIVE_TIMEOUT,
            check=True,
            preexec_fn=lambda: _limits(backup_files.DUMP_LIMIT if stdout is not None else 4096),
        )
        if stdout is not None:
            return b""
        captured.seek(0)
        result = captured.read(4097)
        if len(result) > 4096:
            _fail("backup_native_failed")
        return result


@_guard("backup_native_failed")
def _native(program, arguments, **kwargs):
    return _run_native(program, arguments, **kwargs)


def _migrations():
    return {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(files("agent_platform").joinpath("migrations").iterdir(), key=str)
        if path.name.endswith(".sql")
    }


def _schema_contract():
    tables = {
        "schema_migrations": {"version": "text", "sha256": "text", "applied_at": "timestamptz"}
    }
    functions = {}
    triggers = set()
    for path in sorted(files("agent_platform").joinpath("migrations").iterdir(), key=str):
        if not path.name.endswith(".sql"):
            continue
        content = path.read_text()
        for match in re.finditer(r"CREATE TABLE (\w+)\s*\(", content, re.I):
            start = match.end()
            depth = 1
            end = start
            while depth:
                depth += (content[end] == "(") - (content[end] == ")")
                end += 1
            body = content[start : end - 1]
            columns = {}
            depth = 0
            begin = 0
            for index, char in enumerate(body + ","):
                depth += (char == "(") - (char == ")")
                if char == "," and depth == 0:
                    fragment = re.sub(r"--[^\n]*", "", body[begin:index]).strip()
                    column = re.match(
                        r"(\w+)\s+(uuid|text|boolean|integer|bigint|timestamptz|numeric|jsonb|bytea)\b",
                        fragment,
                        re.I,
                    )
                    if column:
                        columns[column[1]] = column[2].lower()
                    begin = index + 1
            tables[match[1]] = columns
        for match in re.finditer(r"ALTER TABLE (\w+)\s+([^;]+);", content, re.I):
            for column in re.finditer(r"ADD COLUMN (\w+)\s+(\w+)", match[2], re.I):
                tables[match[1]][column[1]] = column[2].lower()
        for match in re.finditer(
            r"CREATE (?:OR REPLACE )?FUNCTION (\w+)\(\) RETURNS trigger "
            r"LANGUAGE plpgsql AS \$\$(.*?)\$\$",
            content,
            re.I | re.S,
        ):
            functions[match[1]] = match[2].strip()
        triggers.update(re.findall(r"CREATE TRIGGER (\w+)", content, re.I))
    return tables, functions, triggers


def _extra_schema_objects(conn):
    """Reject non-table user objects that an empty-target table scan cannot detect."""
    if conn.execute("""SELECT EXISTS(
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname='public' AND NOT EXISTS(
            SELECT 1 FROM pg_class c JOIN pg_type rowtype ON rowtype.oid=c.reltype
            WHERE c.relnamespace=n.oid AND c.relkind='r'
              AND t.oid IN (c.reltype,rowtype.typarray)))
        OR EXISTS(SELECT 1 FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class
            JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
        OR EXISTS(SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
            JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
        OR EXISTS(SELECT 1 FROM pg_foreign_server)
        OR EXISTS(SELECT 1 FROM pg_foreign_data_wrapper)
        OR EXISTS(SELECT 1 FROM pg_publication)
        OR EXISTS(SELECT oid FROM pg_subscription)
        OR EXISTS(SELECT 1 FROM pg_default_acl)
        OR EXISTS(SELECT 1 FROM pg_language WHERE lanname NOT IN
            ('internal','c','sql','plpgsql'))""").fetchone()[0]:
        return True
    for catalog, namespace in (
        ("pg_collation", "collnamespace"),
        ("pg_operator", "oprnamespace"),
        ("pg_opclass", "opcnamespace"),
        ("pg_opfamily", "opfnamespace"),
        ("pg_conversion", "connamespace"),
        ("pg_ts_config", "cfgnamespace"),
        ("pg_ts_dict", "dictnamespace"),
        ("pg_ts_parser", "prsnamespace"),
        ("pg_ts_template", "tmplnamespace"),
        ("pg_statistic_ext", "stxnamespace"),
    ):
        if conn.execute(
            sql.SQL(
                "SELECT EXISTS(SELECT 1 FROM {} o JOIN pg_namespace n "
                "ON n.oid=o.{} WHERE n.nspname='public')"
            ).format(sql.Identifier(catalog), sql.Identifier(namespace))
        ).fetchone()[0]:
            return True
    return False


def _schema(conn):
    if _extra_schema_objects(conn):
        _fail("backup_schema_mismatch")
    expected, functions, triggers = _schema_contract()
    rows = conn.execute(
        "SELECT version,sha256 FROM public.schema_migrations ORDER BY version"
    ).fetchall()
    if dict(rows) != _migrations():
        _fail("backup_schema_mismatch")
    if conn.execute(
        "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT IN "
        "('public','pg_catalog','information_schema','pg_toast') "
        "AND nspname !~ '^pg_(toast_)?temp_[0-9]+$') OR EXISTS(SELECT 1 FROM pg_extension WHERE "
        "extname<>'plpgsql') OR EXISTS(SELECT 1 FROM pg_largeobject_metadata) OR "
        "EXISTS(SELECT 1 FROM pg_event_trigger)"
    ).fetchone()[0]:
        _fail("backup_schema_mismatch")
    tables = conn.execute(
        "SELECT c.relname,c.relkind,c.relrowsecurity,c.relowner=current_user::regrole "
        "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE "
        "n.nspname='public' AND c.relkind NOT IN ('i') ORDER BY c.relname"
    ).fetchall()
    if {row[0] for row in tables} != set(expected) or any(
        row[1:] != ("r", False, True) for row in tables
    ):
        _fail("backup_schema_mismatch")
    actual = {table: {} for table in expected}
    columns = conn.execute(
        "SELECT "
        "c.relname,a.attname,t.typname,a.attnotnull,pg_get_expr(d.adbin,d.adrelid),a.attidentity,a.attgenerated"
        " FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n "
        "ON n.oid=c.relnamespace JOIN pg_type t ON t.oid=a.atttypid LEFT JOIN "
        "pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE "
        "n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped "
        "ORDER BY c.relname,a.attnum"
    ).fetchall()
    aliases = {"int4": "integer", "int8": "bigint", "bool": "boolean"}
    for table, column, kind, _, _, identity, generated in columns:
        actual[table][column] = aliases.get(kind, kind)
        if identity or generated:
            _fail("backup_schema_mismatch")
    if actual != expected:
        _fail("backup_schema_mismatch")
    observed_functions = conn.execute(
        "SELECT p.proname,p.prosrc,p.prosecdef,p.proconfig,p.pronargs,l.lanname FROM "
        "pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON "
        "l.oid=p.prolang WHERE n.nspname='public' ORDER BY p.proname"
    ).fetchall()
    if {row[0]: row[1].strip() for row in observed_functions} != functions or any(
        row[2:] != (False, None, 0, "plpgsql") for row in observed_functions
    ):
        _fail("backup_schema_mismatch")
    observed_triggers = conn.execute(
        "SELECT t.tgname,pg_get_triggerdef(t.oid),t.tgenabled FROM pg_trigger t JOIN "
        "pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY t.tgname"
    ).fetchall()
    if {row[0] for row in observed_triggers} != triggers or any(
        row[2] != "O" for row in observed_triggers
    ):
        _fail("backup_schema_mismatch")
    constraints = conn.execute(
        "SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) FROM pg_constraint k "
        "JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON "
        "n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.conname"
    ).fetchall()
    indexes = conn.execute(
        "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname"
    ).fetchall()
    if conn.execute(
        "SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON "
        "n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE "
        "n.nspname='public' AND a.grantee<>c.relowner) OR EXISTS(SELECT 1 FROM "
        "pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a WHERE "
        "n.nspname='public' AND a.privilege_type='CREATE' AND a.grantee<>n.nspowner)"
    ).fetchone()[0]:
        _fail("backup_schema_mismatch")
    fingerprint = hashlib.sha256(
        json.dumps(
            [columns, observed_functions, observed_triggers, constraints, indexes],
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    if fingerprint != SCHEMA_SHA256:
        _fail("backup_schema_mismatch")
    return expected, fingerprint


def _lock_tables(conn):
    expected, _, _ = _schema_contract()
    conn.execute(
        sql.SQL("LOCK TABLE {} IN SHARE MODE").format(
            sql.SQL(",").join(sql.Identifier("public", name) for name in sorted(expected))
        )
    )


def _quiescent(conn):
    unsafe = conn.execute("""SELECT
        EXISTS(SELECT 1 FROM runtime_capacity WHERE NOT draining)
        OR EXISTS(SELECT 1 FROM runs WHERE state NOT IN ('succeeded','failed','cancelled')
            OR cleanup_state NOT IN ('confirmed','not_allocated'))
        OR EXISTS(SELECT 1 FROM jobs WHERE status<>'done')
        OR EXISTS(SELECT 1 FROM commands WHERE status<>'completed')
        OR EXISTS(SELECT 1 FROM sandbox_bindings b JOIN runs r ON r.id=b.run_id
            WHERE b.id IS DISTINCT FROM r.sandbox_id)
        OR EXISTS(SELECT 1 FROM runs r WHERE NOT (
            (r.cleanup_state='not_allocated' AND r.sandbox_id IS NULL
             AND r.generation=0 AND r.backend_ref IS NULL
             AND NOT EXISTS(SELECT 1 FROM sandbox_bindings b WHERE b.run_id=r.id)
             AND NOT EXISTS(SELECT 1 FROM adapter_operations op WHERE op.run_id=r.id)
             AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.run_id=r.id AND
                 (j.generation<>0 OR j.attempts<>0 OR j.lease_owner IS NOT NULL
                  OR j.lease_until IS NOT NULL)))
            OR (r.cleanup_state='confirmed' AND EXISTS(
                SELECT 1 FROM sandbox_bindings b
                JOIN resource_reservations rr ON rr.sandbox_id=b.id
                WHERE b.id=r.sandbox_id AND b.run_id=r.id AND b.generation=r.generation
                  AND b.cleanup_state='confirmed' AND b.desired_state='stopped'
                  AND b.observed_state='stopped' AND rr.released_at IS NOT NULL
                  AND ((r.backend='openhands' AND b.node_id='cocoon-local'
                        AND b.provider_handle<>'' AND b.provider_handle NOT LIKE 'pending:%')
                       OR (r.backend='fake' AND b.node_id='fake-local'
                           AND ((b.provider_handle<>''
                                 AND b.provider_handle NOT LIKE 'pending:%')
                                OR b.provider_handle='pending:' || r.id::text)))))))
        OR EXISTS(SELECT 1 FROM resource_reservations WHERE released_at IS NULL)
        OR EXISTS(SELECT 1 FROM github_exports WHERE state IN ('queued','exporting')
            OR reconcile_requested)""").fetchone()[0]
    if unsafe:
        _fail("backup_source_active")


def _major(conn):
    value = int(conn.execute("SHOW server_version_num").fetchone()[0]) // 10000
    if value != POSTGRES_MAJOR:
        _fail("backup_postgres_mismatch")
    return value


def _native_version(program, url, major):
    value = _native(program, ["--version"], connection=url)
    match = re.fullmatch(rb"[\w_]+ \(PostgreSQL\) ([0-9]+)\.[^\r\n]+\n?", value)
    if match is None or int(match[1]) != major:
        _fail("backup_postgres_mismatch")


def _validate_manifest(manifest):
    if set(manifest) != {
        "version",
        "postgres_major",
        "migrations",
        "excluded_tables",
        "schema_sha256",
        "dump_bytes",
        "dump_sha256",
    }:
        _fail("backup_manifest_invalid")
    if manifest["version"] != VERSION:
        _fail("backup_version_unsupported")
    if (
        type(manifest["postgres_major"]) is not int
        or manifest["postgres_major"] != POSTGRES_MAJOR
        or manifest["migrations"] != _migrations()
        or manifest["excluded_tables"] != list(EXCLUDED)
        or not isinstance(manifest["schema_sha256"], str)
        or manifest["schema_sha256"] != SCHEMA_SHA256
    ):
        _fail("backup_schema_mismatch")


def _summary(manifest, status):
    return {
        "status": status,
        "version": VERSION,
        "postgres_major": manifest["postgres_major"],
        "dump_bytes": manifest["dump_bytes"],
        "dump_sha256": manifest["dump_sha256"],
    }


@_guard("backup_create_failed")
def create_backup(url, directory, *, offline):
    if offline is not True:
        _fail("backup_offline_required")
    with _connect(url) as conn:
        conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (MIGRATION_LOCK,))
        _lock_tables(conn)
        major = _major(conn)
        _, fingerprint = _schema(conn)
        _quiescent(conn)
        if conn.execute("SELECT count(*) FROM maintenance_identity").fetchone()[0] != 1:
            _fail("backup_identity_missing")
        _native_version("pg_dump", url, major)
        snapshot = conn.execute("SELECT pg_export_snapshot()").fetchone()[0]
        with backup_files.create_bundle(directory) as target:
            with backup_files.create_dump(target) as dump:
                _native(
                    "pg_dump",
                    [
                        "--format=custom",
                        "--no-owner",
                        "--no-acl",
                        "--snapshot=" + snapshot,
                        *("--exclude-table-data=public." + name for name in EXCLUDED),
                    ],
                    connection=url,
                    stdout=dump,
                )
                dump.flush()
                os.fsync(dump.fileno())
            # All source work, including transaction completion, precedes the completion marker.
            conn.commit()
            manifest = backup_files.complete_bundle(
                target,
                {
                    "version": VERSION,
                    "postgres_major": major,
                    "migrations": _migrations(),
                    "excluded_tables": list(EXCLUDED),
                    "schema_sha256": fingerprint,
                },
            )
    return _summary(manifest, "created")


@_guard("backup_verify_failed")
def verify_backup(directory):
    with backup_files.read_bundle(directory) as (manifest, _):
        _validate_manifest(manifest)
        return _summary(manifest, "verified")


def _empty_target(conn):
    # PostgreSQL reserves literal pg_ names; only numbered native temp/toast namespaces
    # are exempt. LIKE underscores would also accept unrelated user namespaces.
    if _extra_schema_objects(conn):
        _fail("backup_target_not_empty")
    if conn.execute("""SELECT
        EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
            AND n.nspname !~ '^pg_(toast_)?temp_[0-9]+$')
        OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public')
        OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT IN
            ('public','pg_catalog','information_schema','pg_toast')
            AND nspname !~ '^pg_(toast_)?temp_[0-9]+$')
        OR EXISTS(SELECT 1 FROM pg_extension WHERE extname<>'plpgsql')
        OR EXISTS(SELECT 1 FROM pg_largeobject_metadata)
        OR EXISTS(SELECT 1 FROM pg_event_trigger)""").fetchone()[0]:
        _fail("backup_target_not_empty")


def _finalize(url, manifest):
    with _connect(url) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (MIGRATION_LOCK,))
        _lock_tables(conn)
        _, fingerprint = _schema(conn)
        if fingerprint != manifest["schema_sha256"]:
            _fail("backup_schema_mismatch")
        _quiescent(conn)
        for table in EXCLUDED:
            if conn.execute(
                sql.SQL("SELECT EXISTS(SELECT 1 FROM {})").format(sql.Identifier(table))
            ).fetchone()[0]:
                _fail("backup_ephemeral_present")
        conn.execute("UPDATE runtime_capacity SET draining=true")
        conn.execute("INSERT INTO maintenance_identity DEFAULT VALUES")


@_guard("backup_restore_failed")
def restore_backup(url, directory, *, offline, confirm_database):
    if offline is not True:
        _fail("backup_offline_required")
    with backup_files.read_bundle(directory) as (manifest, dump):
        _validate_manifest(manifest)
        with _connect(url) as conn:
            if not isinstance(confirm_database, str) or confirm_database != conn.info.dbname:
                _fail("backup_target_mismatch")
            conn.execute("SELECT pg_advisory_xact_lock(%s)", (MIGRATION_LOCK,))
            _empty_target(conn)
            major = _major(conn)
            if major != manifest["postgres_major"]:
                _fail("backup_postgres_mismatch")
            _native_version("pg_restore", url, major)
            _native(
                "pg_restore",
                [
                    "--single-transaction",
                    "--exit-on-error",
                    "--no-owner",
                    "--no-acl",
                    "--dbname=",
                ],
                connection=url,
                stdin=dump,
            )
        _finalize(url, manifest)
        return _summary(manifest, "restored")
