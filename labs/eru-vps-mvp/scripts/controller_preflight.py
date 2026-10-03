#!/usr/bin/env python3
"""Local-only controller handoff audit. Never contacts a VPS or prints private inputs."""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
from datetime import datetime, timezone
import uuid

from labops import atomic_json

PROJECT = Path(__file__).resolve().parent.parent
ALIASES = tuple(f'ckc-disposable-{i:02d}' for i in range(1, 5))
STATE_FILES = ('cluster.json', 'core-revision.json', 'worker-component-revisions.json')
PACKAGES = ('python3', 'openssh-client', 'git')
ARTIFACT_REPOS = {'projecteru2/core', 'projecteru2/cli', 'projecteru2/agent',
                  'projecteru2/resource-extend', 'etcd-io/etcd', 'containernetworking/plugins'}


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def command(argv):
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=15, check=False)
        return result.returncode, result.stdout, result.stderr
    except (OSError, subprocess.TimeoutExpired):
        return 1, '', ''


def json_input(path, blockers, label):
    if not path.is_file():
        blockers.append(label + ' missing')
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, UnicodeError, json.JSONDecodeError):
        blockers.append(label + ' invalid JSON')
        return None


def assess(project=PROJECT, ssh_home=None, run=command):
    """Record exact public versions and input digests; return blockers without raw secrets."""
    project = Path(project)
    ssh_home = Path(ssh_home) if ssh_home is not None else Path.home() / '.ssh/hzd-vps/known_hosts'
    private = project / 'private'
    blockers = []
    report = {'schema': 1, 'checked_at': datetime.now(timezone.utc).isoformat(),
              'controller': {'os': platform.freedesktop_os_release().get('PRETTY_NAME', platform.system()),
                             'machine': platform.machine(), 'python': platform.python_version()},
              'packages': {}, 'source': {}, 'locks': {}, 'private_inputs': {}, 'ssh_aliases': {},
              'blockers': blockers}

    for package in PACKAGES:
        code, out, _ = run(['dpkg-query', '-W', '-f=${Version}', package])
        report['packages'][package] = out.strip() if code == 0 and out.strip() else None
        if report['packages'][package] is None:
            blockers.append('controller package missing: ' + package)
    for executable, argv in [('git', ['git', '--version']), ('ssh', ['ssh', '-V'])]:
        code, out, err = run(argv)
        report['controller'][executable] = (out or err).strip() if code == 0 else None
        if code != 0:
            blockers.append('controller command unavailable: ' + executable)

    code, out, _ = run(['git', '-C', str(project), 'rev-parse', 'HEAD'])
    commit = out.strip()
    report['source']['commit'] = commit if code == 0 and re.fullmatch(r'[0-9a-f]{40}', commit) else None
    if report['source']['commit'] is None:
        blockers.append('versioned project source unavailable')
    code, out, _ = run(['git', '-C', str(project), 'status', '--porcelain', '--', '.'])
    report['source']['project_clean'] = code == 0 and not out.strip()
    if not report['source']['project_clean']:
        blockers.append('project source has uncommitted changes or cannot be checked')

    artifacts_path = project / 'artifacts.amd64.lock.json'
    artifacts = json_input(artifacts_path, blockers, 'artifact lock')
    if artifacts is not None:
        report['locks']['artifact_sha256'] = sha(artifacts_path)
        rows = artifacts.get('artifacts', []) if isinstance(artifacts, dict) else []
        valid = (isinstance(artifacts, dict) and artifacts.get('architecture') == 'linux/amd64' and isinstance(rows, list)
                 and {r.get('repository') for r in rows if isinstance(r, dict)} == ARTIFACT_REPOS
                 and len(rows) == len(ARTIFACT_REPOS)
                 and all(re.fullmatch(r'[0-9a-f]{64}', r.get('sha256', '')) and r.get('tag') and r.get('url')
                         for r in rows if isinstance(r, dict)))
        if not valid:
            blockers.append('artifact lock shape or checksum invalid')
        else:
            report['locks']['artifacts'] = [dict(repository=r['repository'], tag=r['tag'], sha256=r['sha256']) for r in rows]
    upstream_path = project / 'upstream.lock.json'
    if json_input(upstream_path, blockers, 'upstream lock') is not None:
        report['locks']['upstream_sha256'] = sha(upstream_path)
    validation_path = project / 'patches/core-v0.1.5-lock-context.validation.json'
    validation = json_input(validation_path, blockers, 'core patch validation')
    if validation is not None:
        report['locks']['core_validation_sha256'] = sha(validation_path)
        if not isinstance(validation, dict):
            blockers.append('core patch validation shape invalid')
            validation = {}
        patch = project / 'patches/core-v0.1.5-lock-context.patch'
        report['locks']['core_patch_matches_validation'] = patch.is_file() and sha(patch) == validation.get('patch_sha256')
        if not report['locks']['core_patch_matches_validation']:
            blockers.append('core patch bytes differ from validation')
        expected = validation.get('artifact_sha256', '')
        binary = private / 'builds/core-lock-context-go1.27.1/eru-core'
        report['private_inputs']['patched_core_matches_validation'] = binary.is_file() and sha(binary) == expected
        if not report['private_inputs']['patched_core_matches_validation']:
            blockers.append('validated patched core artifact missing or mismatched')

    inventory = json_input(private / 'deployment-plan.json', blockers, 'deployment-plan.json')
    report['private_inputs']['deployment-plan.json'] = inventory is not None
    if inventory is not None and (not isinstance(inventory, list) or len(inventory) != 4 or
            [(row.get('alias'), row.get('node'), row.get('role')) for row in inventory if isinstance(row, dict)] !=
            [(ALIASES[0], 'worker-1', 'core')] + [(alias, f'worker-{i}', 'worker') for i, alias in enumerate(ALIASES[1:], 2)]):
        blockers.append('private inventory topology differs from reviewed four hosts')
    host_keys = json_input(private / 'verified-host-public-keys.json', blockers, 'verified-host-public-keys.json')
    report['private_inputs']['verified-host-public-keys.json'] = host_keys is not None
    if host_keys is not None and (not isinstance(host_keys, dict) or set(host_keys) != set(ALIASES[1:])):
        blockers.append('verified worker host key map differs from reviewed aliases')
    state = private / 'operations'
    for name in STATE_FILES:
        value = json_input(state / name, blockers, 'operations/' + name)
        report['private_inputs']['operations/' + name] = value is not None
        if name == 'cluster.json' and value is not None and (not isinstance(value, dict) or value.get('cluster_id') != 'eru-vps-mvp' or not isinstance(value.get('generation'), int) or value['generation'] < 1):
            blockers.append('controller cluster state identity invalid')
        if name == 'core-revision.json' and value is not None and validation is not None and (not isinstance(value, dict) or value.get('artifact_sha256') != validation.get('artifact_sha256')):
            blockers.append('controller core revision differs from validated patch')
    for directory in ('runs', 'plans'):
        exists = (state / directory).is_dir()
        report['private_inputs']['operations/' + directory] = exists
        if not exists:
            blockers.append('operations/' + directory + ' missing')
    for alias in ALIASES:
        number = alias[-2:]
        records = list((private / 'preflight').glob('*-disposable-' + number + '-*.json'))
        report['private_inputs']['preflight/' + alias] = bool(records)
        if not records:
            blockers.append('private preflight evidence missing: ' + alias)
        key = ssh_home / alias.removeprefix('ckc-')
        code, out, _ = run(['ssh', '-G', alias])
        options = dict(line.split(' ', 1) for line in out.splitlines() if ' ' in line) if code == 0 else {}
        ready = (code == 0 and options.get('user') == 'ckc'
                 and options.get('hostname') not in (None, '', alias) and key.is_file())
        report['ssh_aliases'][alias] = {'local_config_ready': ready, 'trusted_key_present': key.is_file()}
        if not ready:
            blockers.append('SSH alias or trusted host key unavailable: ' + alias)
    report['ready_for_review'] = not blockers
    return report


def main():
    os.umask(0o077)
    report = assess()
    path = None
    if (PROJECT / 'private').is_dir():
        identifier = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
        path = PROJECT / 'private/controller-preflight' / (identifier + '.json')
        atomic_json(path, report)
    print(json.dumps({'ready_for_review': report['ready_for_review'], 'blockers': report['blockers'],
                      'report': 'private/controller-preflight/' + path.name if path else None}, indent=2))
    return 0 if report['ready_for_review'] else 1


if __name__ == '__main__':
    sys.exit(main())
