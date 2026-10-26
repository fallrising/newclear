#!/usr/bin/env python3
"""Prepare a private, offline Cloud Lab bundle. Never contacts a provider."""
import argparse
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOURCE_FILES = (
    'apps/control/worker/index.mjs', 'apps/control/worker/auth.mjs',
    'apps/control/worker/protocol.mjs', 'apps/control/public/index.html',
    'apps/control/public/styles.css', 'apps/control/public/dashboard.mjs',
    'apps/control/migrations/0001.sql', 'recipes/node-health.json',
    'adapters/node-health/runner.py',
)
REQUIRED = set('schema_version account_id zone_id database_id domain worker_name access_issuer access_audience human_subject workspace_id resource_id resource_generation not_before expires_at'.split())
OPTIONAL = {'cloudflare_access_client_id', 'cloudflare_access_client_secret'}


class PreparationError(ValueError):
    """Diagnostics deliberately contain no paths or profile values."""


def require(condition, message='invalid deployment profile'):
    if not condition:
        raise PreparationError(message)


def encode(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2, sort_keys=True) + '\n').encode('utf-8')


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result)
            result[key] = value
        return result
    def reject(_):
        raise PreparationError('invalid deployment profile')
    try:
        require(len(raw) <= 32768)
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_float=reject, parse_constant=reject)
        encode(value)  # Escaped unpaired surrogates cannot become output UTF-8.
        return value
    except (ValueError, UnicodeError, RecursionError, TypeError) as exc:
        raise PreparationError('invalid deployment profile') from exc


def canonical_path(value):
    raw = os.fspath(value)
    require(isinstance(raw, str) and raw and '\x00' not in raw and '..' not in Path(raw).parts, 'unsafe filesystem path')
    return Path(os.path.abspath(raw))


def open_directory(path):
    """Pin every ancestor using no-follow directory descriptors."""
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd
    except BaseException:
        os.close(fd)
        raise


def require_outside_checkout(path):
    """Refuse private inputs/outputs below any Git worktree marker."""
    fd = open_directory(path.parent)
    try:
        while True:
            try:
                os.stat('.git', dir_fd=fd, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                raise PreparationError('private paths must be outside Git checkouts')
            parent = os.open('..', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            current_info, parent_info = os.fstat(fd), os.fstat(parent)
            if (current_info.st_dev, current_info.st_ino) == (parent_info.st_dev, parent_info.st_ino):
                os.close(parent)
                break
            os.close(fd)
            fd = parent
    finally:
        os.close(fd)


def read_private(path):
    parent = open_directory(path.parent)
    try:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, 'rb') as handle:
            info = os.fstat(handle.fileno())
            require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
                    and info.st_uid == os.geteuid() and info.st_nlink == 1, 'profile must be a private regular file')
            return strict_json(handle.read(32769))
    finally:
        os.close(parent)


def text(value, maximum=128):
    require(isinstance(value, str) and 1 <= len(value) <= maximum
            and all(33 <= ord(c) <= 126 for c in value))
    return value


def timestamp(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value))
    try:
        return datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise PreparationError('invalid deployment profile') from exc


def validate_profile(p):
    require(isinstance(p, dict) and REQUIRED <= p.keys() and p.keys() - REQUIRED in (set(), OPTIONAL))
    require(p['schema_version'] == 'cloudlab.deployment.v1')
    for key in ('account_id', 'zone_id'):
        require(isinstance(p[key], str) and re.fullmatch('[0-9a-f]{32}', p[key]))
    try:
        require(isinstance(p['database_id'], str) and str(uuid.UUID(p['database_id'])) == p['database_id'])
    except (ValueError, AttributeError) as exc:
        raise PreparationError('invalid deployment profile') from exc
    domain = text(p['domain'], 253)
    require(domain == domain.lower() and '.' in domain and all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in domain.split('.')))
    try:
        ipaddress.ip_address(domain)
    except ValueError:
        pass
    else:
        raise PreparationError('invalid deployment profile')
    require(p['worker_name'] in ('cloud-lab', 'cloud-lab-qualification'))
    require(isinstance(p['access_issuer'], str) and re.fullmatch(r'https://[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com', p['access_issuer']))
    for key in ('access_audience', 'human_subject'):
        text(p[key], 1024)
    for key in ('workspace_id', 'resource_id'):
        require(isinstance(p[key], str) and re.fullmatch('[A-Za-z0-9_-]{1,128}', p[key]))
    require(type(p['resource_generation']) is int and 1 <= p['resource_generation'] <= 2147483647)
    seconds = (timestamp(p['expires_at']) - timestamp(p['not_before'])).total_seconds()
    require(0 < seconds <= 86400)
    for key in OPTIONAL & p.keys():
        text(p[key], 1024)
    return p


PLAN = '''# Private deployment gates

This bundle performs no network calls or deployment. Costs and plan eligibility are unknown.
Never attach this directory, secret files, profile, or SQL to public evidence.

1. Owner selects and confirms the account, zone, isolated new D1 database, custom hostname,
   plan, budget, retention, non-root runner and bounded observation window. Confirm all IDs
   and the manifest/source revision. Reprepare if the <=24-hour grants expire.
2. Verify the provider toolchain separately (not included or installed here), actual D1 CAS,
   batch rollback, and backup/isolated restore. Never apply this migration to another product DB.
3. Configure and verify Access human and service-token policies for the selected hostname.
   Human subject is mapped only after verified Access JWT; machine HMAC cannot bypass Access.
4. Review wrangler.json and import worker-secrets.json as private Worker secrets. Provision
   only the selected new D1 with the copied migration and grant-seed.sql after explicit approval.
   Use a qualified D1 managed import/batch transaction for the complete seed; never execute
   its statements individually. Qualify atomic rollback first. The SQL intentionally contains
   no explicit transaction control. Inserts fail if replayed; never replace existing grants.
5. Obtain deployment/ingress approval, then deploy reviewed exact sources. Attach the custom
   hostname only after Access policy is ready; no routes or Cron are enabled by this bundle.
   Verify hostname, workers.dev, preview URLs, every asset path and old host ports fail closed.
6. Put runner.json and the copied runner on the selected non-root host. journal_path resolves
   relative to the config and is durable protected state, never build/cache/temp. bot.json has
   the same config shape; its journal_path is a reserved unused compatibility field for probes.
   Keep bot and runner keys separate. Optional Access service credentials are paired in both.
7. Qualify human/mobile and bot submissions, runner results, revocation/rotation, disconnects,
   restarts, late reports, quotas and unknown recovery. Preserve journal and SQLite WAL evidence.
8. Scheduling stays disabled. Separate approval and live evidence are required before enabling
   health-minute and adding a Cron trigger. Retention is read expiry, not physical deletion.
   Stop before each missing gate; local preparation never establishes live acceptance.
'''


def build_files(p, source_root):
    files = {}
    for relative in SOURCE_FILES:
        source = source_root / relative
        # Source symlinks are not eligible for exact source bundles.
        parent = open_directory(source.parent)
        try:
            fd = os.open(source.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            with os.fdopen(fd, 'rb') as handle:
                require(stat.S_ISREG(os.fstat(handle.fileno()).st_mode), 'source unavailable')
                files[relative] = handle.read()
        finally:
            os.close(parent)
    recipe = dict(recipe_id='node-health', version='1.0.0', digest='sha256:' + hashlib.sha256(files['recipes/node-health.json']).hexdigest())
    audience = 'cloudlab-' + secrets.token_hex(16)
    resource = dict(resource_id=p['resource_id'], generation=p['resource_generation'])
    roles = ('human', 'bot', 'runner', 'scheduler')
    ids = {role: 'cloudlab-' + role for role in roles}
    grants = {role: 'cloudlab-grant-' + role for role in roles}
    capabilities = {
        'human': ['commands:submit', 'node:health:read', 'commands:read', 'commands:cancel-request', 'artifact:read'],
        'bot': ['commands:submit', 'node:health:read', 'commands:read', 'commands:cancel-request', 'artifact:read'],
        'runner': ['dispatch:claim', 'runs:report', 'runs:reconcile'],
        'scheduler': ['commands:submit', 'node:health:read'],
    }
    keys = {}
    for role in ('runner', 'bot'):
        credential = 'cloudlab-key-' + role
        secret = secrets.token_hex(32)
        keys[credential] = dict(principal_id=ids[role], grant_id=grants[role], generation=1,
                                secret_hex=secret, expires_at=p['expires_at'])
        config = dict(base_url='https://' + p['domain'], audience=audience, credential_id=credential,
                      generation=1, secret_hex=secret, journal_path=role + '-journal.sqlite3',
                      workspace_id=p['workspace_id'], resource_ref=resource, recipe_ref=recipe)
        config.update({key: p[key] for key in OPTIONAL if key in p})
        files[role + '.json'] = encode(config)
    access = dict(issuer=p['access_issuer'], audience=p['access_audience'],
                  subjects={p['human_subject']: dict(principal_id=ids['human'], grant_id=grants['human'])})
    files['worker-secrets.json'] = encode(dict(MACHINE_KEYS=json.dumps(keys, separators=(',', ':')),
                                             ACCESS_CONFIG=json.dumps(access, separators=(',', ':'))))
    sql = []
    for role in roles:
        policy = dict(principal_id=ids[role], workspace_id=p['workspace_id'], resource_ref=resource,
                      recipe_ref=recipe, capabilities=capabilities[role], not_before=p['not_before'],
                      expires_at=p['expires_at'], max_timeout_seconds=10, max_output_bytes=16384)
        literal = json.dumps(policy, separators=(',', ':')).replace("'", "''")
        sql.append("INSERT INTO grants(id,revision,revoked,policy) VALUES ('%s',1,0,'%s');" % (grants[role], literal))
    sql += ["INSERT INTO schedules(id,revision,enabled,grant_id,last_due) VALUES ('health-minute',1,0,'%s',NULL);" % grants['scheduler']]
    files['grant-seed.sql'] = ('\n'.join(sql) + '\n').encode()
    wrangler = dict(name=p['worker_name'], account_id=p['account_id'], main='apps/control/worker/index.mjs',
                    compatibility_date='2026-10-26', workers_dev=False, preview_urls=False,
                    assets=dict(directory='apps/control/public', binding='ASSETS', run_worker_first=True),
                    d1_databases=[dict(binding='DB', database_name=p['worker_name'], database_id=p['database_id'], migrations_dir='apps/control/migrations')],
                    vars=dict(PUBLIC_ORIGIN='https://' + p['domain'], AUDIENCE=audience))
    files['wrangler.json'] = encode(wrangler)
    files['plan.md'] = PLAN.encode()
    # Git identifies the source baseline; the manifest hashes identify the exact working bytes.
    result = subprocess.run(['git', '-C', str(source_root), 'rev-parse', '--verify', 'HEAD'], capture_output=True, text=True, check=False)
    require(result.returncode == 0 and re.fullmatch('[0-9a-f]{40,64}\n?', result.stdout), 'source version unavailable')
    manifest = dict(schema_version='cloudlab.bundle.v1', source_version=result.stdout.strip(),
                    recipe_ref=recipe, files={name: hashlib.sha256(raw).hexdigest() for name, raw in sorted(files.items())},
                    manifest_excludes_itself=True)
    files['manifest.json'] = encode(manifest)
    return files, manifest


def prepare_deployment(profile_path, output_path, *, source_root=None):
    """Validate fully, then exclusively create a private bundle; never overwrite or clean up."""
    try:
        profile_path, output_path = canonical_path(profile_path), canonical_path(output_path)
        require(output_path != Path('/'), 'unsafe filesystem path')
        require_outside_checkout(profile_path)
        require_outside_checkout(output_path)
        p = validate_profile(read_private(profile_path))
        files, manifest = build_files(p, canonical_path(source_root or ROOT))
        parent = open_directory(output_path.parent)
        try:
            require(os.fstat(parent).st_uid == os.geteuid() and not os.fstat(parent).st_mode & 0o022,
                    'output parent must be owner-controlled')
            os.mkdir(output_path.name, mode=0o700, dir_fd=parent)
            root = os.open(output_path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            try:
                os.fchmod(root, 0o700)
                for name, raw in files.items():
                    current = os.dup(root)
                    try:
                        parts = Path(name).parts
                        for part in parts[:-1]:
                            try:
                                os.mkdir(part, mode=0o700, dir_fd=current)
                            except FileExistsError:
                                pass
                            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
                            os.fchmod(child, 0o700)
                            os.close(current); current = child
                        fd = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=current)
                        with os.fdopen(fd, 'wb') as handle:
                            os.fchmod(handle.fileno(), 0o600)
                            handle.write(raw)
                            handle.flush()
                            os.fsync(handle.fileno())
                    finally:
                        os.close(current)
                os.fsync(root)
            finally:
                os.close(root)
        finally:
            os.close(parent)
        return manifest
    except (OSError, ValueError, UnicodeError, RecursionError, TypeError) as exc:
        raise PreparationError('bundle preparation failed; existing files preserved') from exc


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args(argv)
    try:
        prepare_deployment(args.profile, args.output)
    except PreparationError:
        print('bundle preparation failed; existing files preserved', file=sys.stderr)
        return 1
    print('private offline bundle prepared; live gates pending')
    return 0


if __name__ == '__main__':
    sys.exit(main())
