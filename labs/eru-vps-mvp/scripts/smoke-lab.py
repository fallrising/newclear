#!/usr/bin/env python3
"""Exercise and clean up run-owned nginx workloads on the three ERU workers."""
import argparse
from datetime import datetime, timezone
import ipaddress
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import uuid

from labops import ClusterLock, lock_fds

PROJECT = Path(__file__).resolve().parent.parent
CORE_ALIAS = 'ckc-disposable-01'


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--node', choices=['worker-2', 'worker-3', 'worker-4'], action='append')
    ap.add_argument('--verify-reapply', action='store_true', help='Reapply the existing deployment while the first test workload is running; modifies the four-node deployment')
    args = ap.parse_args()
    os.umask(0o077)
    plan = json.loads((PROJECT / 'private/deployment-plan.json').read_text())
    core_ip = plan[0]['ip']
    image = json.loads((PROJECT / 'artifacts.amd64.lock.json').read_text())['nginx']['image']
    run_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:6]
    directory = PROJECT / 'private/smoke'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    evidence = directory / (run_id + '.json')
    report = {'run_id': run_id, 'started_at': datetime.now(timezone.utc).isoformat(),
              'image': image, 'events': [], 'nodes': {}}

    def save():
        evidence.write_text(json.dumps(report, indent=2) + '\n')

    def run(host, argv, check=True, stdin=None, timeout=180):
        command = shlex.join(argv)
        print(f'[{host}] {command}', flush=True)
        p = subprocess.run(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                            '-o', 'ConnectTimeout=10', host, command],
                           input=stdin, capture_output=True, text=True, timeout=timeout, pass_fds=lock_fds())
        report['events'].append({'host': host, 'argv': argv, 'exit_code': p.returncode,
                                 'stdout': p.stdout, 'stderr': p.stderr})
        save()
        if check and p.returncode:
            raise RuntimeError(f'{host}: {command}: {p.stderr or p.stdout}')
        return p

    def cli(*argv, json_output=False, check=True):
        base = ['sudo', '-n', '/usr/local/bin/eru-cli', '--eru', core_ip + ':5001']
        if json_output:
            base += ['--output', 'json']
        result = run(CORE_ALIAS, base + list(argv), check=check)
        return (json.loads(result.stdout) or []) if json_output else result

    def usage(node):
        return json.loads(cli('node', 'get', node, json_output=True)[0]['resource_usage'])

    def container_ip(host, identifier):
        data = json.loads(run(host, ['sudo', '-n', 'ctr', '--namespace', 'eru',
                                     'containers', 'info', identifier]).stdout)
        address = data['Labels']['eru.network.eru']
        ipaddress.ip_address(address)
        return address

    def http(host, identifier):
        address = container_ip(host, identifier)
        result = run(host, ['curl', '--noproxy', '*', '--fail', '--max-time', '5', '--retry', '10', '--retry-all-errors', '--retry-delay', '1', '--retry-max-time', '20', 'http://' + address + '/'])
        if 'Welcome to nginx!' not in result.stdout:
            raise RuntimeError('unexpected nginx HTTP body')
        return address

    def cluster_state():
        pods = sorted(x['name'] for x in cli('pod', 'list', json_output=True))
        nodes = cli('pod', 'nodes', 'eru', json_output=True)
        node_fields = ['name', 'podname', 'endpoint', 'available', 'labels', 'resource_capacity', 'resource_usage']
        return {'pods': pods, 'nodes': sorted(
            [{k: x[k] for k in node_fields} for x in nodes], key=lambda x: x['name'])}

    def service_state():
        result = {}
        for item in plan:
            units = ['docker.service', 'containerd.service']
            if item['role'] == 'core':
                units += ['eru-core.service', 'eru-etcd.service', 'eru-mvp-firewall.service']
            else:
                units += ['eru-agent.service', 'eru-containerd-proxy.socket', 'eru-containerd-proxy.service']
            result[item['alias']] = run(item['alias'], ['sudo', '-n', 'systemctl', 'show',
                '--property=Id,ActiveState,SubState,MainPID,InvocationID,NRestarts,ExecMainStartTimestampMonotonic,ActiveEnterTimestampMonotonic',
                *units]).stdout
        return result

    reapply_done = False
    for worker in plan[1:]:
        node, host = worker['node'], worker['alias']
        if args.node and node not in args.node:
            continue
        app = 'erumvp' + uuid.uuid4().hex[:12]
        spec_path = None
        state = {'app': app, 'worker_alias': host, 'result': 'RUNNING', 'workload_ids': []}
        report['nodes'][node] = state
        save()
        baseline = usage(node)
        try:
            spec = f'''appname: {app}
entrypoints:
  web:
    commands: [nginx, -g, "daemon off;"]
    restart: always
    publish: ["80"]
labels:
  owner: eru-vps-mvp
  run: {run_id}
'''
            writer = ('import os,tempfile\nfd,path=tempfile.mkstemp(prefix="eru-mvp-spec-",suffix=".yaml")\n'
                      'with os.fdopen(fd,"w") as f:f.write(' + repr(spec) + ')\nprint(path)\n')
            spec_path = run(CORE_ALIAS, ['python3', '-'], stdin=writer).stdout.strip()
            if not spec_path.startswith('/tmp/eru-mvp-spec-'):
                raise RuntimeError('unexpected spec path')
            cli('image', 'cache', '--node', node, image)
            cli('workload', 'deploy', '--pod', 'eru', '--node', node, '--entry', 'web', '--image', image,
                '--network', 'eru', '--count', '1', '--cpu', '1', '--memory', '256M', '--storage', '1G', spec_path)
            workloads = cli('workload', 'list', app, json_output=True)
            if len(workloads) != 1 or workloads[0]['nodename'] != node:
                raise RuntimeError('unexpected workload placement/count')
            identifier = workloads[0]['id']
            state['workload_ids'] = [identifier]
            save()
            cli('workload', 'get', identifier, json_output=True)
            cli('workload', 'exec', identifier, '--', 'nginx', '-v')
            state['http_before_stop'] = http(host, identifier)
            logs = cli('workload', 'logs', '--tail', '30', identifier)
            if 'GET / HTTP/' not in logs.stdout + logs.stderr:
                raise RuntimeError('HTTP access log missing')
            if args.verify_reapply and not reapply_done:
                state['cluster_before_reapply'] = cluster_state()
                state['services_before_reapply'] = service_state()
                state['tasks_before_reapply'] = run(host, ['sudo', '-n', 'ctr', '--namespace', 'eru', 'tasks', 'list']).stdout
                save()
                print('[controller B] Reapply deployment with live nginx canary', flush=True)
                result = subprocess.run([sys.executable, str(PROJECT / 'scripts/deploy-lab.py'), '--apply'],
                                        capture_output=True, text=True, timeout=1500, pass_fds=lock_fds())
                report['events'].append({'host': 'controller B', 'operation': 'deploy-lab --apply',
                    'exit_code': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
                save()
                if result.returncode:
                    raise RuntimeError('deployment reapply failed: ' + result.stderr)
                current = cli('workload', 'list', app, json_output=True)
                if [x['id'] for x in current] != [identifier]:
                    raise RuntimeError('workload identity changed during reapply')
                state['http_after_reapply'] = http(host, identifier)
                state['cluster_after_reapply'] = cluster_state()
                state['services_after_reapply'] = service_state()
                state['tasks_after_reapply'] = run(host, ['sudo', '-n', 'ctr', '--namespace', 'eru', 'tasks', 'list']).stdout
                state['membership_and_usage_unchanged'] = state['cluster_before_reapply'] == state['cluster_after_reapply']
                state['services_unchanged'] = state['services_before_reapply'] == state['services_after_reapply']
                state['runtime_tasks_unchanged'] = state['tasks_before_reapply'] == state['tasks_after_reapply']
                save()
                if not all(state[k] for k in ['membership_and_usage_unchanged', 'services_unchanged', 'runtime_tasks_unchanged']):
                    raise RuntimeError('reapply changed membership, resource usage, service invocation, or runtime task')
                state['reapply_preserved_workload'] = True
                reapply_done = True
            cli('workload', 'stop', identifier)
            tasks = run(host, ['sudo', '-n', 'ctr', '--namespace', 'eru', 'tasks', 'list'])
            if identifier in tasks.stdout:
                raise RuntimeError('task remains after stop')
            cli('workload', 'start', identifier)
            state['http_after_start'] = http(host, identifier)
            # Capacity failures must be observed as failures, not merely calculated.
            for kind, memory, storage in [('memory', '3G', '1G'), ('storage', '256M', '11G')]:
                rejected = cli('workload', 'deploy', '--pod', 'eru', '--node', node, '--entry', 'web',
                    '--image', image, '--network', 'eru', '--count', '1', '--cpu', '1',
                    '--memory', memory, '--storage', storage, spec_path, check=False)
                message = rejected.stdout + rejected.stderr
                if rejected.returncode == 0 or not any(x in message.lower() for x in ['insufficient', 'not enough', 'notenough', 'not enough resource']):
                    raise RuntimeError(f'{kind} rejection did not demonstrate insufficient resources: {message}')
                state[kind + '_overcommit_rejected'] = True
            if len(cli('workload', 'list', app, json_output=True)) != 1:
                raise RuntimeError('rejected deploy left an extra workload')
            state['result'] = 'PASS'
        except Exception as e:
            state['result'] = 'FAIL'
            state['error'] = str(e)
            for failed_id in state['workload_ids']:
                try:
                    cli('workload', 'logs', '--tail', '50', failed_id, check=False)
                    run(host, ['sudo', '-n', 'ctr', '--namespace', 'eru', 'tasks', 'list'], check=False)
                except Exception as diagnostic_error:
                    state['diagnostic_error'] = str(diagnostic_error)
        finally:
            try:
                # Recover IDs after a failed/uncertain create from our unique app.
                for item in cli('workload', 'list', app, json_output=True):
                    if item['nodename'] != node or item.get('labels', {}).get('owner') != 'eru-vps-mvp':
                        raise RuntimeError('unexpected ownership during cleanup')
                    cli('workload', 'remove', '--force', item['id'])
                state['workloads_empty'] = not cli('workload', 'list', app, json_output=True)
                state['usage_after'] = usage(node)
                state['usage_before'] = baseline
                state['usage_restored'] = state['usage_after'] == baseline
                if not state['workloads_empty'] or not state['usage_restored']:
                    state['result'] = 'FAIL'
            except Exception as e:
                state['cleanup_error'] = str(e)
                state['result'] = 'FAIL'
            if spec_path and spec_path.startswith('/tmp/eru-mvp-spec-'):
                run(CORE_ALIAS, ['rm', '--', spec_path], check=False)
            save()
        print(json.dumps({'node': node, **state}), flush=True)
        if state['result'] != 'PASS':
            break
    report['finished_at'] = datetime.now(timezone.utc).isoformat()
    report['pass'] = all(n['result'] == 'PASS' for n in report['nodes'].values())
    save()
    print('Evidence:', evidence, flush=True)
    return 0 if report['pass'] else 1


if __name__ == '__main__':
    with ClusterLock(PROJECT):
        raise SystemExit(main())
