"""Read-only probe run over the ckc-disposable-01 admin alias; never installs tools."""
import json
from pathlib import Path
import subprocess
import time
import urllib.request


def probe(journal_since="-20 seconds", v11=False):
    result = {'time': time.time(), 'commands': {}}
    commands = {
        'health': ['/usr/local/bin/etcdctl', '--endpoints=http://127.0.0.1:2379',
                   '--command-timeout=5s', 'endpoint', 'health', '-w', 'json'],
        'status': ['/usr/local/bin/etcdctl', '--endpoints=http://127.0.0.1:2379',
                   '--command-timeout=5s', 'endpoint', 'status', '-w', 'json'],
        'alarms': ['/usr/local/bin/etcdctl', '--endpoints=http://127.0.0.1:2379',
                   '--command-timeout=5s', 'alarm', 'list', '-w', 'json'],
        'services': ['systemctl', 'show',
                     '--property=Id,ActiveState,SubState,MainPID,InvocationID,NRestarts',
                     'eru-etcd.service', 'eru-core.service', 'docker.service', 'containerd.service'],
        'storage': ['findmnt', '-J', '-T', '/var/lib/etcd-eru-mvp'],
        'space': ['df', '-B1', '/var/lib/etcd-eru-mvp'],
        'journal': ['journalctl', '-u', 'eru-etcd', '-u', 'eru-core', '--since', journal_since,
                    '--no-pager', '-o', 'short-iso-precise'],
    }
    if v11:
        commands['space'] = ['df', '-P', '-B1', '/', '/var/lib/etcd-eru-mvp',
                             '/var/lib/docker', '/var/lib/containerd']
        commands['kernel_journal'] = ['journalctl', '-k', '--since', journal_since,
                                      '--no-pager', '-o', 'short-iso-precise']
    for name, argv in commands.items():
        start = time.monotonic()
        try:
            p = subprocess.run(argv, capture_output=True, text=True, timeout=8)
            entry = {'exit_code': p.returncode, 'stdout': p.stdout, 'stderr': p.stderr}
        except subprocess.TimeoutExpired:
            entry = {'exit_code': None, 'error': 'timeout'}
        entry['seconds'] = time.monotonic() - start
        result['commands'][name] = entry
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open('http://127.0.0.1:2379/metrics', timeout=5) as response:
            metrics = response.read().decode()
        result['metrics'] = '\n'.join(line for line in metrics.splitlines() if line.startswith(
            ('etcd_disk_', 'etcd_server_', 'process_cpu_seconds_total', 'process_start_time_seconds')))
    except Exception as exc:
        result['metrics_error'] = str(exc)
    for name in ['stat', 'diskstats', 'pressure/io', 'pressure/cpu', 'loadavg', 'meminfo']:
        result[name] = Path('/proc', name).read_text()
    return result


if __name__ == '__main__':
    print(json.dumps(probe()))
