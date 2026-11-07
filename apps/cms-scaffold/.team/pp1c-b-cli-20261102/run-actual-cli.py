import datetime, hashlib, json, os, pathlib, subprocess, time, uuid

cwd = pathlib.Path.cwd()
evidence = cwd / '.team/pp1c-b-cli-20261102'
runtime = json.loads((cwd / '.team/pp1c-b-20261102/capture-runtime.json').read_text())
root = pathlib.Path(runtime['root'])
base = root / 'maintenance'
operation = str(uuid.uuid4())
summary = {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'runId': runtime['runId'], 'operationId': operation, 'scope': 'actual fixed B CLI; original API stopped'}
started = []

def docker(*args):
    return subprocess.check_output(['docker', '--host', 'unix:///var/run/docker.sock', *args], timeout=60, text=True)

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1048576), b''):
            digest.update(chunk)
    return digest.hexdigest()

try:
    lease = json.loads((base / 'lease.json').read_text())
    assert lease['phase'] == 'COMPLETE' and lease['helper'] is None
    assert not (base / 'operation.lock').exists()
    rows = json.loads(docker('inspect', *runtime['ownedContainers']))
    by_service = {}
    for row in rows:
        assert row['Id'] in runtime['ownedContainers']
        assert row['Config']['Labels']['com.docker.compose.project'] == runtime['project']
        assert not row['State']['Running']
        by_service[row['Config']['Labels']['com.docker.compose.service']] = row
    assert set(by_service) == {'postgres', 'cms-api', 'ingress'}
    old_api_start = by_service['cms-api']['State']['StartedAt']
    prior_bundles = {str(path): sha(path) for path in (root / 'bundles').glob('*/manifest.json')}
    summary['priorOperationId'] = lease['operationId']
    summary['initialOwnedStopped'] = True
    for service in ['postgres', 'ingress']:
        container = by_service[service]['Id']
        docker('start', container)
        started.append(container)
    for attempt in range(120):
        states = json.loads(docker('inspect', *started))
        if all(row['State']['Running'] and row['State'].get('Health', {}).get('Status', 'healthy') == 'healthy' for row in states):
            break
        time.sleep(1)
    else:
        raise RuntimeError('READINESS')
    command = ['/home/ckc/.local/bin/node', 'scripts/ops/local-bundle.mjs', '--run-id', runtime['runId'], '--operation-id', operation]
    summary['command'] = 'JAVA_HOME=/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8 timeout 900 ' + ' '.join(command)
    environment = dict(os.environ, JAVA_HOME='/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8')
    result = subprocess.run(command, capture_output=True, timeout=900, env=environment)
    (evidence / 'actual-cli.stdout').write_bytes(result.stdout)
    (evidence / 'actual-cli.stderr').write_bytes(result.stderr)
    summary['exitCode'] = result.returncode
    summary['stdoutSha256'] = hashlib.sha256(result.stdout).hexdigest()
    summary['stderrBytes'] = len(result.stderr)
    receipt = json.loads(result.stdout)
    assert set(receipt) == {'operationId', 'backupId', 'phase', 'code', 'exitCode'}
    summary['receipt'] = receipt
    assert result.returncode == 0 and not result.stderr
    assert receipt['operationId'] == operation and receipt['phase'] == 'COMPLETE' and receipt['code'] is None and receipt['exitCode'] == 0
    bundle = root / 'bundles' / receipt['backupId']
    manifest = json.loads((bundle / 'manifest.json').read_text())
    marker = json.loads((bundle / 'local-complete.json').read_text())
    assert marker['manifestSha256'] == sha(bundle / 'manifest.json') and marker['backupId'] == receipt['backupId']
    for artifact in manifest['artifacts']:
        path = bundle / artifact['path']
        info = path.stat()
        assert str(info.st_size) == artifact['byteSize'] and sha(path) == artifact['sha256']
        assert info.st_mode & 0o7777 == 0o600 and info.st_nlink == 1
    lease = json.loads((base / 'lease.json').read_text())
    journal = json.loads((base / 'operations' / (operation + '.json')).read_text())
    assert lease['operationId'] == operation and lease['phase'] == 'COMPLETE' and lease['helper'] is None
    assert journal['records'][-1]['event'] == 'END' and journal['records'][-1]['phase'] == 'COMPLETE'
    assert not (base / 'operation.lock').exists()
    api = json.loads(docker('inspect', by_service['cms-api']['Id']))[0]
    assert not api['State']['Running'] and api['State']['StartedAt'] == old_api_start
    assert all(sha(pathlib.Path(path)) == expected for path, expected in prior_bundles.items())
    summary.update(success=True, manifestSha256=marker['manifestSha256'], artifacts=manifest['artifacts'],
                   journalComplete=True, lockReleased=True, originalApiRemainedStopped=True, priorBundlesUnchanged=True)
except Exception as error:
    summary.update(success=False, failureType=type(error).__name__)
finally:
    if started:
        try:
            docker('stop', '--time', '30', *started)
            summary['startedOwnedContainersStopped'] = True
        except Exception as error:
            summary['stopFailureType'] = type(error).__name__
    summary['endedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (evidence / 'actual-cli.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary))
    if not summary.get('success'):
        raise SystemExit(1)
