from pathlib import Path
import datetime, json, os, subprocess, uuid

root = Path.cwd()
evidence = root / '.team/pp1c-c-20261102/runtime'
image = json.loads((evidence / 'image.json').read_text())['image']
run_id = uuid.uuid4().hex
project = 'cms-pp1-local-' + run_id
run_root = root / 'local/pp1' / run_id
node = '/home/ckc/.local/node-v24.18.0/bin/node'
compose = '/home/ckc/.cache/devbox/toolchains/docker-compose-v5.6.1/docker-compose'
environment = dict(os.environ, CMS_DOCKER_COMPOSE=compose)
record = {'runId': run_id, 'root': str(run_root), 'project': project, 'image': image,
          'scope': 'C controlled fresh isolated integration source; no D proof',
          'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
owned = []

def command(args, timeout=180):
    result = subprocess.run(args, capture_output=True, timeout=timeout, env=environment)
    if result.returncode:
        record['failedCommand'] = args[0]
        record['failedExitCode'] = result.returncode
        (evidence / 'prepare-failure.stderr').write_bytes(result.stderr)
        raise RuntimeError('PREPARE_COMMAND_FAILED')
    return result.stdout

try:
    (evidence / 'source-runtime.json').write_text(json.dumps(record, indent=2) + '\n')
    prepared = json.loads(command([node, '.team/pp1c-c-20261102/runtime/prepare-source.mjs', '--run-id', run_id, '--api-image', image,
                       '--node-image', 'sha256:6a8ca4b22705adf7134d2220ab8aadff634a6b76c816dba55e0409f8e5c180dc',
                       '--postgres-image', 'sha256:6a2e324ebe59af6031c4c1cd96c1d5072c2ebc36563d2196365e43b8297c062d']))
    assert prepared['receipt']['runId'] == run_id
    record['preparedNetworks'] = prepared['networks']
    record['prepared'] = True
    command([compose, '--env-file', str(run_root / 'compose.env'), '-f', 'compose.pp1-local.yaml',
             '-p', project, 'up', '-d', '--wait', '--wait-timeout', '120'])
    ids = command(['docker', '--host', 'unix:///var/run/docker.sock', 'ps', '-aq', '--no-trunc',
                   '--filter', 'label=com.docker.compose.project=' + project]).decode().split()
    assert len(ids) == 3
    rows = json.loads(command(['docker', '--host', 'unix:///var/run/docker.sock', 'inspect', *ids]))
    networks = json.loads(command(['docker', '--host', 'unix:///var/run/docker.sock', 'network', 'inspect', project + '_web', project + '_data']))
    assert len(networks) == 2
    for network in networks:
        role = network['Labels']['com.docker.compose.network']
        planned = prepared['networks'][role]
        assert network['Id'] == planned['id'] and network['Name'] == planned['name']
        assert network['Internal'] and network['Driver'] == 'bridge'
        assert network['IPAM']['Config'][0]['Subnet'] == planned['subnet']
        assert network['IPAM']['Config'][0]['Gateway'] == planned['gateway']
    record['composePreservedNetworkIds'] = True
    containers = {}
    for row in rows:
        assert row['Id'] in ids and row['Config']['Labels']['com.docker.compose.project'] == project
        assert row['State']['Running'] and row.get('RestartCount') == 0
        assert row['State'].get('Health', {}).get('Status', 'healthy') == 'healthy'
        service = row['Config']['Labels']['com.docker.compose.service']
        containers[service] = {'id': row['Id'], 'created': row['Created'], 'startedAt': row['State']['StartedAt'],
                               'restartCount': row['RestartCount'], 'image': row['Image']}
        owned.append(row['Id'])
    assert set(containers) == {'postgres', 'cms-api', 'ingress'}
    record.update(healthy=True, controlledFreshLifecycle=True, containers=containers)
except Exception as error:
    record.update(success=False, failureType=type(error).__name__)
    # Unknown or partially-created resources are retained; no cleanup or reuse.
    if owned:
        command(['docker', '--host', 'unix:///var/run/docker.sock', 'stop', '--time', '30', *owned])
        record['ownedStoppedAfterFailure'] = True
finally:
    record['endedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (evidence / 'source-runtime.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record))
if not record.get('healthy'):
    raise SystemExit(1)
