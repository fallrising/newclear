"""Control-plane and healthy-worker adapter for ERU-010 worker loss."""
from datetime import datetime, timezone
import json

from app_cli_adapter import EruCLIAdapter, WORKLOAD_ID
from app_desired import OWNER, WORKERS


RUNTIME_FACTS = '''import json,subprocess
def run(argv):
 p=subprocess.run(argv,capture_output=True,text=True,timeout=20)
 if p.returncode: raise RuntimeError("runtime query failed")
 return sorted(filter(None,p.stdout.splitlines()))
print(json.dumps({"containers":run(["ctr","--namespace","eru","containers","list","-q"]),
 "tasks":run(["ctr","--namespace","eru","tasks","list","-q"])}))
'''


class WorkerLossCLIAdapter:
    """Use only the core and healthy workers; never SSH to the lost target."""

    def __init__(self, operator):
        self.operator = operator
        self.app = EruCLIAdapter(operator)

    def snapshot(self):
        return {
            'at': datetime.now(timezone.utc).isoformat(),
            'pods': self.operator.cli('pod', 'list'),
            'nodes': self.operator.cli('pod', 'nodes', 'eru'),
            'workloads': self.operator.cli('workload', 'list'),
        }

    def _inventory(self):
        rows = self.operator.inventory
        workers = {row.get('node'): row for row in rows
                   if isinstance(row, dict) and row.get('role') == 'worker'}
        if (set(workers) != WORKERS
                or {row.get('alias') for row in workers.values()} != {
                    'ckc-disposable-02', 'ckc-disposable-03', 'ckc-disposable-04'}):
            raise ValueError('worker loss adapter requires the reviewed worker inventory')
        return workers

    def preflight(self, snapshot, target, destinations):
        issues = []
        if target not in WORKERS:
            raise ValueError('worker loss target is outside the reviewed workers')
        if (not isinstance(destinations, (list, tuple, set))
                or not destinations or set(destinations) - (WORKERS - {target})):
            raise ValueError('worker loss destinations are outside the healthy workers')
        workers = self._inventory()
        if (not isinstance(snapshot, dict)
                or not all(isinstance(snapshot.get(key), list)
                           for key in ('pods', 'nodes', 'workloads'))):
            return {'health_ok': False,
                    'consistency_issues': ['control-plane snapshot is malformed']}
        if not any(isinstance(row, dict) and row.get('name') == 'eru'
                   for row in snapshot['pods']):
            issues.append('expected eru pod is missing')
        node_rows = {row.get('name'): row for row in snapshot['nodes']
                     if isinstance(row, dict) and isinstance(row.get('name'), str)}
        if len(node_rows) != len(snapshot['nodes']) or set(node_rows) != WORKERS:
            issues.append('worker node membership is missing, duplicated, or unexpected')
        else:
            for node, inventory in workers.items():
                row = node_rows[node]
                expected_endpoint = 'containerd://ckc@' + inventory['ip'] + ':22'
                if (row.get('podname') != 'eru'
                        or row.get('endpoint') != expected_endpoint
                        or row.get('labels', {}).get('owner') != OWNER):
                    issues.append(node + ': registration identity differs from inventory')
                if node == target:
                    if row.get('available') is not False or row.get('bypass') is not True:
                        issues.append(node + ': lost target is not unavailable and bypassed')
                elif row.get('available') is not True or row.get('bypass') is not False:
                    issues.append(node + ': healthy worker is unavailable or bypassed')

        metadata = {node: set() for node in WORKERS}
        seen = set()
        for row in snapshot['workloads']:
            if (not isinstance(row, dict) or not isinstance(row.get('id'), str)
                    or row['id'] in seen or row.get('nodename') not in WORKERS):
                issues.append('workload metadata contains malformed or duplicate identities')
                continue
            seen.add(row['id'])
            metadata[row['nodename']].add(row['id'])

        for node in sorted(WORKERS - {target}):
            alias = workers[node]['alias']
            try:
                output = self.operator.command(
                    alias, ['sudo', '-n', 'python3', '-'], stdin=RUNTIME_FACTS,
                    timeout=30)
                facts = json.loads(output)
                if (not isinstance(facts, dict) or set(facts) != {'containers', 'tasks'}
                        or any(not isinstance(facts[key], list)
                               or any(not isinstance(item, str) for item in facts[key])
                               or len(set(facts[key])) != len(facts[key])
                               for key in ('containers', 'tasks'))):
                    raise ValueError('malformed healthy-worker runtime facts')
                if set(facts['containers']) != metadata[node]:
                    issues.append(node + ': runtime containers differ from metadata')
                if set(facts['tasks']) != metadata[node]:
                    issues.append(node + ': runtime tasks differ from metadata')
            except Exception as exc:
                issues.append(node + ': runtime audit failed (' + type(exc).__name__ + ')')

        etcd = self.operator.health()
        core_output = self.operator.command(
            self.app._core_alias(),
            ['sudo', '-n', 'systemctl', 'is-active', 'eru-core.service'],
            check=False, timeout=15)
        event = self.operator.events[-1] if self.operator.events else {}
        etcd_ok = isinstance(etcd, dict) and etcd.get('exit_code') == 0
        core_ok = event.get('exit_code') == 0 and core_output.strip() == 'active'
        if not etcd_ok:
            issues.append('etcd endpoint health failed')
        if not core_ok:
            issues.append('eru-core.service is not active')
        return {'health_ok': etcd_ok and core_ok, 'consistency_issues': issues}

    def get_workload(self, workload_id):
        return self.app.get_workload(workload_id)

    def dissociate_exact(self, workload_id):
        if not isinstance(workload_id, str) or not WORKLOAD_ID.fullmatch(workload_id):
            raise ValueError('invalid exact workload ID')
        self.operator.command(
            self.app._core_alias(),
            self.app._core_cli_prefix() + ['workload', 'dissociate', workload_id],
            timeout=90)

    def deploy(self, plan):
        return self.app.deploy(plan)

    def list_revision(self, appname):
        return self.app.list_revision(appname)

    def probe(self, row, desired):
        return self.app.probe(row, desired)
