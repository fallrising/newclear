"""Run-owned nginx canaries and continuous HTTP observations during worker rebuilds."""
import ipaddress
import json
from pathlib import Path
import shlex
import subprocess
import threading
import time
import uuid

from labops import atomic_json, lock_fds

NODES = {'worker-2': 'ckc-disposable-02', 'worker-3': 'ckc-disposable-03'}


def start_canaries(op, plan, before):
    run_id = plan['id']
    path = op.project / 'private/smoke' / (run_id + '.json')
    if path.exists():
        raise ValueError('canary evidence already exists')
    image = json.loads((op.project / 'artifacts.amd64.lock.json').read_text())['nginx']['image']
    report = {'run_id': run_id, 'purpose': 'reinstall-canaries', 'status': 'creating',
              'image': image, 'nodes': {}}
    op.journal['smoke_evidence'] = [path.name]
    op.save_journal()
    atomic_json(path, report)
    try:
        for node, alias in NODES.items():
            app = 'erumvp' + uuid.uuid4().hex[:12]
            report['nodes'][node] = {'app': app, 'worker_alias': alias, 'workload_ids': []}
            atomic_json(path, report)  # record ownership before an uncertain create
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
            writer = 'import tempfile,os\nf,p=tempfile.mkstemp(prefix="eru-mvp-canary-",suffix=".yaml")\nwith os.fdopen(f,"w") as s:s.write(' + repr(spec) + ')\nprint(p)\n'
            spec_path = op.command(op.core['alias'], ['python3', '-'], writer).strip()
            if not spec_path.startswith('/tmp/eru-mvp-canary-') or '\n' in spec_path:
                raise ValueError('invalid canary spec path')
            try:
                op.stage('creating-canary-' + node)
                op.command(op.core['alias'], ['sudo', '-n', '/usr/local/bin/eru-cli', '--eru',
                    op.core['ip'] + ':5001', 'workload', 'deploy', '--pod', 'eru', '--node', node,
                    '--entry', 'web', '--image', image, '--network', 'eru', '--count', '1',
                    '--cpu', '.25', '--memory', '128M', '--storage', '256M', spec_path])
                rows = op.cli('workload', 'list', app)
                if len(rows) != 1 or rows[0]['nodename'] != node or rows[0].get('labels', {}).get('run') != run_id:
                    raise ValueError('canary placement/ownership mismatch')
                report['nodes'][node]['workload_ids'] = [rows[0]['id']]
                atomic_json(path, report)
            finally:
                op.command(op.core['alias'], ['rm', '--', spec_path])
        report['status'] = 'running'
        atomic_json(path, report)
        after = op.snapshot()
        targets = guard_targets(op, after, run_id)
        warmup(op, targets)
        op.stage('verifying-canaries')
        with HTTPGuards(op.project, run_id, targets) as guards:
            guards.check()
        # Starting guards changes only the two listed workers' run-owned workloads/usage.
        if before['pods'] != after['pods']:
            raise ValueError('pod membership changed')
        old_nodes = {n['name']: n for n in before['nodes']}
        new_nodes = {n['name']: n for n in after['nodes']}
        if old_nodes.keys() != new_nodes.keys():
            raise ValueError('node membership changed')
        for name, old in old_nodes.items():
            new = new_nodes[name]
            allowed = {'resource_usage'} if old['name'] in NODES else set()
            if {k:v for k,v in old.items() if k not in allowed} != {k:v for k,v in new.items() if k not in allowed}:
                raise ValueError('unrelated node metadata changed')
        for alias, old in before['hosts'].items():
            allowed = {'containers', 'tasks'} if alias in NODES.values() else set()
            if {k:v for k,v in old.items() if k not in allowed} != {k:v for k,v in after['hosts'][alias].items() if k not in allowed}:
                raise ValueError('preserved host/runtime identity changed')
        expected = {w['id'] for w in before['workloads']} | {t['id'] for t in targets}
        if {w['id'] for w in after['workloads']} != expected:
            raise ValueError('unexpected workload membership change')
        op.journal['after'] = after
    except BaseException as exc:
        report.update(status='failed', error=str(exc))
        atomic_json(path, report)
        raise


def warmup(op, targets):
    # Container creation is not application readiness. This bounded GET retry is
    # completed before the continuous, no-failure acceptance window begins.
    for target in targets:
        body = op.command(target['alias'], ['curl', '--noproxy', '*', '--fail', '--max-time', '2',
            '--retry', '15', '--retry-all-errors', '--retry-delay', '1', '--retry-max-time', '30', target['url']])
        if 'Welcome to nginx!' not in body:
            raise ValueError('canary did not become HTTP-ready')


def guard_targets(op, snapshot, run_id):
    from labctl import cleanup_targets, identifier
    evidence = json.loads((op.project / 'private/smoke' / (identifier(run_id) + '.json')).read_text())
    if evidence.get('purpose') != 'reinstall-canaries' or evidence.get('status') != 'running' or set(evidence['nodes']) != set(NODES):
        raise ValueError('need running, explicitly owned canaries on worker-2 and worker-3')
    rows = cleanup_targets(evidence, snapshot['workloads'])
    if len(rows) != 2 or {r['node'] for r in rows} != set(NODES):
        raise ValueError('canary workload membership changed')
    for row in rows:
        row['alias'] = NODES[row['node']]
        data = json.loads(op.command(row['alias'], ['sudo', '-n', 'ctr', '--namespace', 'eru', 'containers', 'info', row['id']]))
        address = str(ipaddress.ip_address(data['Labels']['eru.network.eru']))
        if ':' in address: address = '[' + address + ']'
        row['url'] = 'http://' + address + '/'
    return rows


# A GET-only child on each worker. stdout closure or the 15-minute deadline stops
# it after controller loss. No background service or remote evidence files.
PROBE = '''import json,sys,time,urllib.request
url=sys.stdin.readline().strip()
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
end=time.monotonic()+900
while time.monotonic()<end:
 start=time.monotonic();event={'time':time.time(),'monotonic':start}
 try:
  with opener.open(url,timeout=2) as response:
   event['ok']=response.status==200 and b'Welcome to nginx!' in response.read(65536)
 except Exception as exc:event.update(ok=False,error=type(exc).__name__,detail=str(exc))
 event['seconds']=time.monotonic()-start
 print(json.dumps(event),flush=True)
 time.sleep(max(0,1-(time.monotonic()-start)))
'''


class HTTPGuards:
    def __init__(self, project, run_id, targets):
        self.directory = Path(project) / 'private/operations/guards' / run_id
        self.targets = targets
        self.processes = []
        self.threads = []
        self.samples = {t['alias']: [] for t in targets}
        self.failures = []
        self.lock = threading.Lock()
        self.stopping = False

    def reader(self, alias, process, path):
        with path.open('w') as stream:
            for line in process.stdout:
                stream.write(line);stream.flush()
                try:
                    event = json.loads(line)
                    with self.lock:
                        prior = self.samples[alias]
                        if prior and not 0 < event['monotonic'] - prior[-1]['monotonic'] <= 5:
                            self.failures.append(alias + ': HTTP observation gap')
                        self.samples[alias].append({**event, 'received_monotonic': time.monotonic()})
                        if event.get('ok') is not True: self.failures.append(alias + ': HTTP failure')
                except (ValueError, TypeError, KeyError):
                    with self.lock:self.failures.append(alias + ': malformed observation')
        if not self.stopping:
            with self.lock:self.failures.append(alias + ': observer exited')

    def __enter__(self):
        self.directory.mkdir(mode=0o700, parents=True)  # no reuse of guard evidence
        try:
            for target in self.targets:
                alias = target['alias']
                print(f'[{alias}] continuous HTTP GET observer for {target["id"]}', flush=True)
                process = subprocess.Popen(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                    '-o', 'PermitLocalCommand=no', '-o', 'ConnectTimeout=10', alias,
                    shlex.join(['python3', '-u', '-c', PROBE])], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL, text=True, pass_fds=lock_fds())
                self.processes.append(process)
                process.stdin.write(target['url'] + '\n');process.stdin.flush()
                thread = threading.Thread(target=self.reader, args=(alias, process, self.directory / (alias + '.jsonl')), daemon=True)
                thread.start();self.threads.append(thread)
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                with self.lock:
                    ready = all(len(v) >= 2 for v in self.samples.values())
                    failed = bool(self.failures)
                if ready or failed: break
                time.sleep(.1)
            self.check()
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def check(self):
        with self.lock:
            if self.failures: raise ValueError('; '.join(self.failures))
            if len(self.samples) != 2 or any(len(v) < 2 or time.monotonic() - v[-1]['received_monotonic'] > 5 for v in self.samples.values()):
                raise ValueError('continuous HTTP observations missing or stale')
            if any(p.poll() is not None for p in self.processes):
                raise ValueError('HTTP observer stopped')

    def __exit__(self, *args):
        self.stopping = True
        for process in self.processes:
            process.terminate()
        for process in self.processes:
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
            if process.stdin:process.stdin.close()
        for thread in self.threads:thread.join(timeout=5)
        for process in self.processes: process.stdout.close()
        summary = {'failures': self.failures, 'hosts': {alias: {
            'samples': len(rows), 'failures': sum(e.get('ok') is not True for e in rows),
            'duration_seconds': rows[-1]['time'] - rows[0]['time'] if rows else 0,
            'max_gap_seconds': max((b['time'] - a['time'] for a,b in zip(rows, rows[1:])), default=0),
        } for alias, rows in self.samples.items()}}
        atomic_json(self.directory / 'summary.json', summary)
        self.summary = summary
