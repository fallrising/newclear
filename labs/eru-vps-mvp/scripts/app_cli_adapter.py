"""SSH-backed Eru CLI adapter for the ERU-012 app executor.

All remote access goes through the existing reviewed Operator and its SSH
aliases. This module does not run against a cluster during import or tests.
"""
import json
import re

from app_desired import render_eru_spec, spec_identity
from app_executor import execution_plan
from labctl import consistency_issues

APPNAME = re.compile(r'^erumvp[0-9a-f]{12}$')
WORKLOAD_ID = re.compile(r'^(erumvp[0-9a-f]{12})_[A-Za-z0-9_-]+$')
SPEC_PATH = re.compile(r'^/tmp/eru-mvp-app-[A-Za-z0-9_-]+\.yaml$')
MAX_PROBE_BODY = 1024 * 1024


class EruCLIAdapter:
    """Implement AppExecutor's narrow API using a labctl.Operator instance."""

    def __init__(self, operator, deploy_timeout=180):
        self.operator = operator
        self.deploy_timeout = deploy_timeout

    def snapshot(self):
        return self.operator.snapshot()

    def preflight(self, snapshot):
        issues = []
        try:
            issues.extend(consistency_issues(snapshot, self.operator.inventory))
        except Exception as exc:
            issues.append('cluster consistency audit failed (' + type(exc).__name__ + ')')

        etcd_health = self.operator.health()
        core_output = self.operator.command(
            self.operator.core['alias'],
            ['sudo', '-n', 'systemctl', 'is-active', 'eru-core.service'],
            check=False, timeout=15)
        core_event = self.operator.events[-1] if self.operator.events else {}
        etcd_ok = isinstance(etcd_health, dict) and etcd_health.get('exit_code') == 0
        core_ok = (core_event.get('exit_code') == 0 and core_output.strip() == 'active')
        if not etcd_ok:
            issues.append('etcd endpoint health failed')
        if not core_ok:
            issues.append('eru-core.service is not active')
        return {'health_ok': etcd_ok and core_ok, 'consistency_issues': issues}

    def prepare_plan(self, document, plan_id=None):
        snapshot = self.snapshot()
        preflight = self.preflight(snapshot)
        return execution_plan(
            document, snapshot, preflight['health_ok'],
            preflight['consistency_issues'], plan_id=plan_id)

    def _core_alias(self):
        core = self.operator.core
        if (not isinstance(core, dict) or core.get('role') != 'core'
                or core.get('alias') != 'ckc-disposable-01'
                or not isinstance(core.get('ip'), str)):
            raise ValueError('Eru CLI adapter requires the reviewed control-plane alias')
        return core['alias']

    def _core_cli_prefix(self):
        core = self.operator.core
        self._core_alias()
        return ['sudo', '-n', '/usr/local/bin/eru-cli', '--eru', core['ip'] + ':5001']

    def _worker_alias(self, node):
        matches = [item for item in self.operator.inventory
                   if item.get('role') == 'worker' and item.get('node') == node]
        if len(matches) != 1 or matches[0].get('alias') not in {
                'ckc-disposable-02', 'ckc-disposable-03', 'ckc-disposable-04'}:
            raise ValueError('workload probe target is not a reviewed worker alias')
        return matches[0]['alias']

    def deploy(self, plan):
        if not isinstance(plan, dict) or plan.get('action') != 'deploy_revision':
            raise ValueError('adapter deploy accepts only deploy_revision plans')
        normalized, digest, appname = spec_identity(plan.get('spec'))
        if (plan.get('spec_sha256') != digest or plan.get('appname') != appname
                or plan.get('logical_app') != normalized['name']):
            raise ValueError('plan app identity does not match its normalized spec')
        spec_text = render_eru_spec(normalized, digest, appname)
        if plan.get('eru_spec') != spec_text:
            raise ValueError('plan Eru spec differs from its normalized desired state')

        writer = (
            'import os,tempfile\n'
            'fd,path=tempfile.mkstemp(prefix="eru-mvp-app-",suffix=".yaml")\n'
            'with os.fdopen(fd,"w") as stream:stream.write(' + repr(spec_text) + ')\n'
            'print(path)\n'
        )
        core_alias = self._core_alias()
        self.operator.command(
            core_alias, self._core_cli_prefix()
            + ['image', 'cache', '--node', normalized['node'], normalized['image']],
            timeout=self.deploy_timeout)
        result = self.operator.command(core_alias, ['python3', '-'], stdin=writer, timeout=20)
        spec_path = result.strip()
        if not SPEC_PATH.fullmatch(spec_path):
            raise RuntimeError('remote app spec path is outside its private temporary namespace')

        spec = normalized
        argv = self._core_cli_prefix() + [
            'workload', 'deploy', '--pod', 'eru', '--node', spec['node'],
            '--entry', spec['entrypoint'], '--image', spec['image'], '--network', 'eru',
            '--count', str(spec['replicas']),
            '--cpu', format(spec['resources']['cpu'], '.15g'),
            '--memory', spec['resources']['memory'],
            '--storage', spec['resources']['storage'], spec_path,
        ]
        try:
            self.operator.command(core_alias, argv, timeout=self.deploy_timeout)
        finally:
            self.operator.command(core_alias, ['rm', '--', spec_path], timeout=20)

    def list_revision(self, appname):
        if not isinstance(appname, str) or not APPNAME.fullmatch(appname):
            raise ValueError('invalid deterministic Eru appname')
        rows = self.operator.cli('workload', 'list', appname)
        if not isinstance(rows, list):
            raise RuntimeError('Eru workload query did not return a JSON array')
        return rows

    def get_workload(self, workload_id):
        if not isinstance(workload_id, str):
            raise ValueError('invalid exact workload ID')
        match = WORKLOAD_ID.fullmatch(workload_id)
        if not match:
            raise ValueError('invalid exact workload ID')
        rows = self.list_revision(match.group(1))
        matches = [row for row in rows
                   if isinstance(row, dict) and row.get('id') == workload_id]
        if len(matches) > 1:
            raise RuntimeError('exact workload query returned duplicate IDs')
        return matches[0] if matches else None

    def remove_exact(self, workload_id):
        if not isinstance(workload_id, str) or not WORKLOAD_ID.fullmatch(workload_id):
            raise ValueError('invalid exact workload ID')
        self.operator.command(
            self._core_alias(),
            self._core_cli_prefix() + ['workload', 'remove', '--force', workload_id],
            timeout=90)

    def probe(self, row, desired):
        normalized, digest, appname = spec_identity(desired)
        if (not isinstance(row, dict) or not isinstance(row.get('id'), str)
                or not row['id'].startswith(appname + '_')
                or row.get('nodename') != normalized['node']):
            raise ValueError('HTTP probe workload identity differs from desired revision')
        labels = row.get('labels')
        if (not isinstance(labels, dict) or labels.get('owner') != 'eru-vps-mvp'
                or labels.get('logical_app') != normalized['name']
                or labels.get('spec_sha256') != digest):
            raise ValueError('HTTP probe workload ownership differs from desired revision')
        alias = self._worker_alias(normalized['node'])
        payload = {
            'workload_id': row['id'],
            'port': normalized['service']['port'],
            'path': normalized['service']['path'],
            'body_contains': normalized['service']['body_contains'],
        }
        encoded = repr(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
        remote_script = (
            'import http.client,ipaddress,json,subprocess\n'
            'data=json.loads(' + encoded + ')\n'
            'info=subprocess.run(["ctr","--namespace","eru","containers","info",'
            'data["workload_id"]],capture_output=True,text=True,check=True,timeout=10)\n'
            'container=json.loads(info.stdout)\n'
            'address=ipaddress.ip_address(container["Labels"]["eru.network.eru"])\n'
            'connection=http.client.HTTPConnection(str(address),data["port"],timeout=5)\n'
            'try:\n'
            ' connection.request("GET",data["path"],headers={"Connection":"close"})\n'
            ' response=connection.getresponse()\n'
            ' body=response.read(' + str(MAX_PROBE_BODY) + '+1)\n'
            ' matched=data["body_contains"] in body[:' + str(MAX_PROBE_BODY)
            + '].decode("utf-8",errors="replace")\n'
            ' print(json.dumps({"status":response.status,"body_match":matched}))\n'
            'finally:connection.close()\n'
        )
        output = self.operator.command(alias, ['sudo', '-n', 'python3', '-'],
                                       stdin=remote_script, timeout=20)
        try:
            result = json.loads(output)
        except (TypeError, json.JSONDecodeError) as exc:
            raise RuntimeError('HTTP probe returned malformed safe summary') from exc
        if (not isinstance(result, dict)
                or isinstance(result.get('status'), bool)
                or not isinstance(result.get('status'), int)
                or not isinstance(result.get('body_match'), bool)
                or set(result) != {'status', 'body_match'}):
            raise RuntimeError('HTTP probe returned malformed safe summary')
        return result
