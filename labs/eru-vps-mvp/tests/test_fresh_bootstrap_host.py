"""Real temporary roots, synthetic archives and injected command ledger only."""
import base64
import copy
from datetime import datetime, timezone
import hashlib
import gzip
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

import fresh_bootstrap_host as host
import fresh_bootstrap_render as render
from test_fresh_bootstrap_render import fixture


def make_archive(names):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w') as archive:
        for name in names:
            raw = ('synthetic-' + name).encode()
            member = tarfile.TarInfo('bin/' + name); member.size = len(raw)
            archive.addfile(member, io.BytesIO(raw))
    return gzip.compress(stream.getvalue(), mtime=0)


class FakeRunner:
    def __init__(self, fixture):
        self.f = fixture
        self.calls = []; self.writes = []
        self.services = {}; self.pods = []; self.nodes = []
        self.lose = None
        self.etcd_ids = (101, 201)
        self.keys = []
        self.before_write = None
        for unit in ('containerd.service', 'docker.service'):
            self.services[unit] = self.active(unit, b'runtime-' + unit.encode())

    def active(self, unit, raw):
        pid = 100 + len(self.services)
        path = self.f.root / 'proc' / str(pid)
        path.mkdir(exist_ok=True, mode=0o700); (path / 'exe').write_bytes(raw)
        return {'LoadState': 'loaded', 'ActiveState': 'active', 'SubState': 'running',
                'MainPID': str(pid), 'InvocationID': '%032x' % pid}

    def __call__(self, argv):
        self.calls.append(argv)
        if argv[:3] == host.SERVICE[:3]:
            unit = argv[-1]
            value = self.services.get(unit, {'LoadState': 'not-found', 'ActiveState': 'inactive',
                'SubState': 'dead', 'MainPID': '0', 'InvocationID': ''})
            return ''.join(k + '=' + v + '\n' for k, v in value.items()).encode()
        if argv == ('/usr/bin/ps', '-eo', 'comm='):
            return b'python\n'
        if argv == ('/usr/bin/containerd', '--version'):
            return b'containerd github.com/containerd/containerd v2.3.5 fixture\n'
        if argv[:len(host.ETCD)] == host.ETCD:
            cluster, member = self.etcd_ids
            header = {'cluster_id': cluster, 'member_id': member}
            if argv[-2:] == ('endpoint', 'health'):
                value = [{'endpoint': 'http://127.0.0.1:2379', 'health': True}]
            elif argv[-2:] == ('endpoint', 'status'):
                value = [{'Endpoint': 'http://127.0.0.1:2379', 'Status': {'header': header, 'leader': member}}]
            elif argv[-2:] == ('member', 'list'):
                value = {'header': header, 'members': [{'ID': member, 'name': 'eru-fresh-etcd0',
                    'peerURLs': ['http://127.0.0.1:2380'], 'clientURLs': ['http://127.0.0.1:2379']}]}
            else:
                self.f.assertEqual(argv[-3:], ('get', '', '--from-key'))
                value = {'header': header, 'kvs': self.keys, 'count': len(self.keys)}
            return render.canonical(value)
        if argv[0] == '/usr/local/bin/eru-cli' and argv[-2:] == ('pod', 'list'):
            return render.canonical(self.pods or None)
        if argv[0] == '/usr/local/bin/eru-cli' and argv[-3:] == ('pod', 'nodes', 'eru'):
            return render.canonical(self.nodes or None)
        self.writes.append(argv)
        if self.before_write:
            self.before_write(argv)
        if argv[:2] == ('/usr/bin/systemctl', 'start'):
            unit = argv[-1]
            if unit.endswith('.socket'):
                self.services[unit] = {'LoadState': 'loaded', 'ActiveState': 'active', 'SubState': 'listening',
                                      'MainPID': '0', 'InvocationID': ''}
            else:
                binary = {'etcd.service': 'etcd', 'eru-core.service': 'eru-core', 'eru-agent.service': 'eru-agent'}[unit]
                self.services[unit] = self.active(unit, (self.f.root / 'usr/local/bin' / binary).read_bytes())
                if unit == 'eru-agent.service':
                    self.nodes[-1]['available'] = True
        elif argv[0] == '/usr/local/bin/eru-cli':
            if argv[-3:] == ('pod', 'add', 'eru'):
                self.pods[:] = [{'name': 'eru'}]
            elif 'add' in argv:
                name = argv[argv.index('--nodename') + 1]
                w = next(w for w in self.f.render['workers'] if w['node'] == name)
                self.nodes.append({'name': name, **{k: copy.deepcopy(w[k]) for k in ('podname', 'endpoint', 'resource_capacity', 'labels')},
                                   'available': False, 'bypass': True})
            elif 'up' in argv:
                next(n for n in self.nodes if n['name'] == argv[-1])['bypass'] = False
        if self.lose and self.lose in argv:
            raise TimeoutError('synthetic reply lost')
        return b''


class HostTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.now = datetime(2026, 10, 6, tzinfo=timezone.utc)
        for path in ('etc/eru', 'etc/ssh', 'proc/sys/kernel/random', 'root/.ssh'):
            (self.root / path).mkdir(parents=True, mode=0o700)
        access, lock, token, options = fixture()
        self.archives = {}
        names = {'etcd-io/etcd': ['etcd', 'etcdctl', 'etcdutl'], 'projecteru2/cli': ['eru-cli'],
                 'projecteru2/resource-extend': ['resource-storage'], 'projecteru2/agent': ['eru-agent'],
                 'containernetworking/plugins': ['bridge', 'host-local', 'loopback'], 'projecteru2/core': ['eru-core']}
        for a in lock['artifacts']:
            raw = make_archive(names[a['repository']]); self.archives[a['repository']] = raw
            a['sha256'] = render.digest(raw)
        self.render = render.build_render(access, lock, token, **options)
        self.access = access
        self.identity(0)
        (self.root / 'root/.ssh/eru-fresh-core').write_text('synthetic-key')
        for p in self.root.rglob('*'):
            p.chmod(0o700 if p.is_dir() else 0o600)
        self.runner = FakeRunner(self)

    def identity(self, index):
        h = self.render['hosts'][index]
        raw = b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' + bytes([index + 1]) * 32
        for name, content in [('etc/machine-id', h['machine_id']), ('proc/sys/kernel/random/boot_id', h['boot_id']),
                              ('etc/ssh/ssh_host_ed25519_key.pub', 'ssh-ed25519 ' + base64.b64encode(raw).decode())]:
            (self.root / name).write_text(content + '\n'); (self.root / name).chmod(0o600)

    def action(self, index):
        worker = None if index < 6 or index == len(host.STEPS) - 1 else (index - 6) // 5 + 1
        step = host.STEPS[index]
        idx = worker if step in ('worker-install', 'worker-proxy-start', 'worker-agent-start') else 0
        return {'schema_version': 1, 'operation': 'fresh-bootstrap-action', 'plan_id': 'access-1',
            'plan_sha256': 'a' * 64, 'run_id': 'run-1', 'execution_sha256': 'b' * 64,
            'pending_sha256': 'c' * 64, 'bootstrap_sha256': 'd' * 64, 'step_index': index,
            'step': step, 'host_index': idx, 'host': copy.deepcopy(self.access['hosts'][idx]),
            'worker_index': worker, 'render': copy.deepcopy(self.render)}

    def call(self, index=0, observe=False):
        a = self.action(index); self.identity(a['host_index'])
        request = {'schema_version': 1, 'operation': 'observe' if observe else 'dispatch', 'action': a}
        if not observe:
            request['intent_sha256'] = '%064x' % (index + 1)
        return host.handle(request, root=str(self.root), owner_uid=os.getuid(), owner_gid=os.getgid(),
            runner=self.runner, artifact_reader=lambda a: self.archives[a['repository']], now=self.now)

    def through_core(self):
        for i in range(6):
            self.call(i, observe=i == 2)

    def test_durable_install_start_empty_etcd_and_no_replay(self):
        self.assertEqual(self.call(observe=True)['state'], 'absent')
        self.assertEqual(self.call()['state'], 'complete')
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(self.call(1)['state'], 'complete')
        observed = self.call(2, observe=True)
        facts = host.validate_evidence(self.action(2), observed)
        self.assertEqual(facts['etcd']['keys'], [])
        self.assertEqual(facts['etcd']['member_ids'], ['201'])
        self.assertEqual(sum(a[:2] == ('/usr/bin/systemctl', 'start') for a in self.runner.writes), 1)

    def test_unknown_data_and_files_preserved_zero_writes(self):
        for path in ('var/lib/eru-fresh-etcd/run-1', 'var/lib/etcd-eru-mvp'):
            target = self.root / path; target.mkdir(parents=True)
            (target / 'unknown').write_text('preserve')
            with self.assertRaises(ValueError):
                self.call()
            self.assertEqual((target / 'unknown').read_text(), 'preserve')
            self.assertEqual(self.runner.writes, [])
            self.assertFalse((self.root / 'etc/eru/.fresh-bootstrap').exists())
        target = self.root / 'usr/local/bin/etcd'; target.parent.mkdir(parents=True)
        target.write_text('foreign')
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(target.read_text(), 'foreign')

    def test_recreated_data_root_and_restarted_service_are_drift(self):
        self.call()
        path = self.root / 'var/lib/eru-fresh-etcd/run-1'
        path.rename(path.parent / 'original-run-1')
        path.mkdir(mode=0o700)
        count = len(self.runner.writes)
        with self.assertRaises(ValueError):
            self.call(1)
        self.assertEqual(len(self.runner.writes), count)
        path.rmdir(); (path.parent / 'original-run-1').rename(path)
        self.call(1)
        self.runner.services['etcd.service']['InvocationID'] = 'f' * 32
        count = len(self.runner.writes)
        with self.assertRaises(ValueError):
            self.call(1, observe=True)
        self.assertEqual(len(self.runner.writes), count)

    def test_lost_start_reply_recovery_is_readonly_uncertain(self):
        self.call(); self.runner.lose = 'start'
        with self.assertRaises(ValueError):
            self.call(1)
        count = len(self.runner.writes)
        self.assertEqual(self.call(1, observe=True)['state'], 'uncertain')
        with self.assertRaises(ValueError):
            self.call(1)
        self.assertEqual(len(self.runner.writes), count)

    def test_core_pod_safe_registration_and_exact_capacity(self):
        harness = BootstrapHarness(self.render, self.archives, now=self.now)
        self.addCleanup(harness.close)
        import fresh_bootstrap_ssh as ssh
        keys = {'ckc-disposable-%02d' % i: 'ssh-ed25519 ' + base64.b64encode(
            b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' + bytes([i]) * 32).decode() for i in range(1, 5)}
        adapter = ssh.SSHBootstrapAdapter(keys, transport=harness.transport)
        for i in range(len(host.STEPS)):
            action = self.action(i)
            if action['step'] in host.READONLY:
                observed = adapter.observe(action)
            else:
                observed = adapter.dispatch(action, '%064x' % (i + 1))
            self.assertEqual(observed['state'], 'complete')
            if action['step'] == 'cluster-accept':
                before_facts = host.validate_evidence(action, observed, before=True)
                self.assertEqual(len(before_facts['workers']), 3)
                self.assertIsNone(observed['provenance'])
        self.assertEqual(len(harness.nodes), 3)
        self.assertTrue(all(n['available'] and not n['bypass'] for n in harness.nodes))
        self.assertEqual([n['resource_capacity'] for n in harness.nodes], [w['resource_capacity'] for w in self.render['workers']])
        adds = [a for a in harness.runners['ckc-disposable-01'].writes if 'add' in a and '--nodename' in a]
        self.assertEqual(len(adds), 3)
        self.assertTrue(all('--extra-resources' in a and '--cpu' not in a for a in adds))
        for i in (9, 14, 19):
            facts = host.validate_evidence(self.action(i), adapter.observe(self.action(i)))
            self.assertIsNotNone(facts['agent'])
            binary = next(f for f in facts['files'] if f['path'] == '/usr/local/bin/eru-agent')
            self.assertEqual(binary['sha256'], facts['agent']['runtime_sha256'])
            self.assertNotEqual(binary['sha256'], next(a['sha256'] for a in self.render['hosts'][self.action(i)['host_index']]['agent_install']['artifacts'] if a['repository'] == 'projecteru2/agent'))

    def test_readonly_empty_accept_pre_observation_requires_complete(self):
        self.call(); self.call(1)
        observation = self.call(2, observe=True)
        count = len(self.runner.writes)
        facts = host.validate_evidence(self.action(2), observation, before=True)
        self.assertEqual(facts['etcd']['keys'], [])
        self.assertEqual(observation['state'], 'complete')
        self.assertIsNone(observation['provenance'])
        self.assertEqual(len(self.runner.writes), count)
        forged = copy.deepcopy(observation); forged['provenance'] = {'intent_sha256': 'a' * 64}
        with self.assertRaises(ValueError):
            host.validate_evidence(self.action(2), forged, before=True)
        for state in ('absent', 'uncertain'):
            forged = copy.deepcopy(observation); forged['state'] = state
            with self.assertRaises(ValueError):
                host.validate_evidence(self.action(2), forged, before=True)

    def test_archive_member_limit_stops_before_collecting_unbounded_metadata(self):
        from unittest.mock import patch
        raw = make_archive(['etcd', 'etcdctl', 'etcdutl'] + ['unused-%04d' % i for i in range(4200)])
        inputs = self.render['inputs']
        next(a for a in inputs['artifact_lock']['artifacts'] if a['repository'] == 'etcd-io/etcd')['sha256'] = render.digest(raw)
        self.render = render.build_render(inputs['access_render'], inputs['artifact_lock'],
            base64.b64decode(inputs['token_base64']), run_id='run-1',
            target_token_sha256=self.render['target_token_sha256'], prior_token_sha256=inputs['prior_token_sha256'],
            safe_core=inputs['safe_core'], capacities=inputs['capacities'])
        self.archives['etcd-io/etcd'] = raw
        original = tarfile.TarFile.next
        seen = []
        def counted(archive):
            member = original(archive)
            if member is not None and (member.offset, member.name) not in seen:
                seen.append((member.offset, member.name))
            return member
        with patch.object(tarfile.TarFile, 'next', counted):
            with self.assertRaises(ValueError):
                self.call()
        self.assertLessEqual(len(seen), 4097)
        self.assertEqual(self.runner.writes, [])
        self.assertFalse((self.root / 'usr/local/bin/etcd').exists())
        self.assertFalse((self.root / 'etc/etcd/etcd.conf').exists())

    def test_archive_scan_bounds_unselected_skip_and_first_extended_header(self):
        from unittest.mock import patch
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w') as archive:
            member = tarfile.TarInfo('unused'); member.size = 256 * 1024
            archive.addfile(member, io.BytesIO(b'x' * member.size))
        raw = gzip.compress(stream.getvalue(), mtime=0)
        with patch.object(host, 'ARCHIVE_SCAN_LIMIT', 64 * 1024):
            with self.assertRaises(ValueError):
                host._archive_contents(raw, {'etcd': '/usr/local/bin/etcd'})
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w', format=tarfile.PAX_FORMAT) as archive:
            member = tarfile.TarInfo('etcd'); member.size = 1
            member.pax_headers = {'comment': 'x' * (host.ARCHIVE_METADATA_LIMIT + 1)}
            archive.addfile(member, io.BytesIO(b'x'))
        with self.assertRaises(ValueError):
            host._archive_contents(gzip.compress(stream.getvalue(), mtime=0), {'etcd': '/usr/local/bin/etcd'})

    def test_archive_types_paths_and_duplicate_selected_members_are_rejected(self):
        bad = []
        for name, kind in [('../etcd', tarfile.REGTYPE), ('/etcd', tarfile.REGTYPE),
                           ('bin/link', tarfile.SYMTYPE), ('bin/device', tarfile.CHRTYPE)]:
            stream = io.BytesIO()
            with tarfile.open(fileobj=stream, mode='w') as archive:
                member = tarfile.TarInfo(name); member.type = kind
                member.linkname = 'etcd'
                archive.addfile(member)
            bad.append(gzip.compress(stream.getvalue(), mtime=0))
        bad.append(make_archive(['etcd', 'etcd']))
        for raw in bad:
            with self.assertRaises(ValueError):
                host._archive_contents(raw, {'etcd': '/usr/local/bin/etcd'})

    def test_etcd_member_list_header_identity_matches_status_and_keys(self):
        self.call(); self.call(1)
        observation = self.call(2, observe=True)
        forged = copy.deepcopy(observation)
        row = next(r for r in forged['evidence']['commands'] if tuple(r['argv']) == host.ETCD_COMMANDS[2])
        document = json.loads(base64.b64decode(row['stdout_base64']))
        document['header']['member_id'] = 999
        row['stdout_base64'] = base64.b64encode(render.canonical(document)).decode()
        with self.assertRaises(ValueError):
            host.validate_evidence(self.action(2), forged)

    def test_etcd_identity_fields_reject_json_booleans_and_allow_query_revision_changes(self):
        self.call(); self.call(1); self.runner.etcd_ids = (1, 1)
        observation = self.call(2, observe=True)
        for command_index in (0, 1, 2, 3):
            if command_index == 0:
                continue
            for field in ('cluster_id', 'member_id'):
                forged = copy.deepcopy(observation)
                row = next(r for r in forged['evidence']['commands'] if tuple(r['argv']) == host.ETCD_COMMANDS[command_index])
                document = json.loads(base64.b64decode(row['stdout_base64']))
                header = document[0]['Status']['header'] if command_index == 1 else document['header']
                header[field] = True
                row['stdout_base64'] = base64.b64encode(render.canonical(document)).decode()
                with self.assertRaises(ValueError):
                    host.validate_evidence(self.action(2), forged)
        for command_index, location in ((1, 'leader'), (2, 'ID')):
            forged = copy.deepcopy(observation)
            row = next(r for r in forged['evidence']['commands'] if tuple(r['argv']) == host.ETCD_COMMANDS[command_index])
            document = json.loads(base64.b64decode(row['stdout_base64']))
            container = document[0]['Status'] if command_index == 1 else document['members'][0]
            container[location] = True
            row['stdout_base64'] = base64.b64encode(render.canonical(document)).decode()
            with self.assertRaises(ValueError):
                host.validate_evidence(self.action(2), forged)
        for command_index in (1, 2, 3):
            row = next(r for r in observation['evidence']['commands'] if tuple(r['argv']) == host.ETCD_COMMANDS[command_index])
            document = json.loads(base64.b64decode(row['stdout_base64']))
            header = document[0]['Status']['header'] if command_index == 1 else document['header']
            header['revision'] = command_index
            row['stdout_base64'] = base64.b64encode(render.canonical(document)).decode()
        self.assertEqual(host.validate_evidence(self.action(2), observation)['etcd']['member_id'], '1')

    def test_existing_cli_source_oracle(self):
        import ast
        source = ast.parse((Path(__file__).parents[1] / 'scripts/labctl.py').read_text())
        operator = next(n for n in source.body if isinstance(n, ast.ClassDef) and n.name == 'Operator')
        snapshot = next(n for n in operator.body if isinstance(n, ast.FunctionDef) and n.name == 'snapshot')
        calls = [tuple(a.value for a in n.args) for n in ast.walk(snapshot)
                 if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == 'cli'
                 and all(isinstance(a, ast.Constant) for a in n.args)]
        self.assertIn(('pod', 'nodes', 'eru'), calls)
        self.assertIn(host._cli(self.action(21), 'pod', 'nodes', 'eru'), host._allowed(self.action(21)))
        self.assertNotIn(host._cli(self.action(21), 'node', 'list'), host._allowed(self.action(21)))

    def test_nonempty_entire_keyspace_and_unknown_node_fail(self):
        self.call(); self.call(1)
        self.runner.keys = [{'key': base64.b64encode(b'outside-eru-prefix').decode(), 'value': 'eA=='}]
        with self.assertRaises(ValueError):
            self.call(2, observe=True)
        self.runner.keys = []
        for i in range(3, 6):
            self.call(i)
        self.runner.nodes = [{'name': 'unknown'}]
        with self.assertRaises(ValueError):
            self.call(8, observe=True)

    def test_foreign_fresh_parent_and_agent_state_are_not_adopted(self):
        target = self.root / 'var/lib/eru-fresh-etcd/foreign-run'
        target.mkdir(parents=True)
        (target / 'unknown').write_text('preserve')
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual((target / 'unknown').read_text(), 'preserve')
        self.assertEqual(self.runner.writes, [])

    def test_parser_rejects_complete_install_without_files(self):
        observation = self.call()
        observation['evidence']['files'] = []
        with self.assertRaises(ValueError):
            host.validate_evidence(self.action(0), observation)

    def test_stale_identity_and_unsafe_paths_never_dispatch(self):
        request = {'schema_version': 1, 'operation': 'dispatch', 'intent_sha256': 'a' * 64, 'action': self.action(0)}
        (self.root / 'etc/machine-id').write_text('different')
        with self.assertRaises(ValueError):
            host.handle(request, root=self.root, owner_uid=os.getuid(), owner_gid=os.getgid(), runner=self.runner)
        self.assertEqual(self.runner.calls, [])
        self.identity(0)
        (self.root / 'usr').symlink_to(self.root / 'root')
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(self.runner.writes, [])


class BootstrapHarness:
    """Four-host actual helper seam for root-owned public driver integration.

    The caller supplies exact synthetic artifact archive bytes matching its lock.
    Roots may be those already used by the network helper fixture. No real runner
    or SSH command is ever invoked. transport executes the complete fixed source
    bundle before injecting only handle's documented local seams.
    """
    def __init__(self, rendered, archives, *, access_render=None, setup=None, roots=None, now=None):
        self.render = render.validate_render(rendered)
        self.access = access_render or rendered['inputs']['access_render']
        self.archives = archives
        self.setup = setup
        self.now = now or datetime(2026, 10, 6, tzinfo=timezone.utc)
        self.temp = tempfile.TemporaryDirectory()
        self.roots = roots or {h['alias']: Path(self.temp.name) / h['alias'] for h in self.render['hosts']}
        self.runners = {}
        self.calls = []; self.nodes = []; self.pods = []
        for i, h in enumerate(self.render['hosts']):
            self.root = Path(self.roots[h['alias']])
            self.roots[h['alias']] = self.root
            self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
            for p in ('etc/eru', 'etc/ssh', 'proc/sys/kernel/random', 'root/.ssh'):
                (self.root / p).mkdir(parents=True, exist_ok=True, mode=0o700)
            raw = b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' + bytes([i + 1]) * 32
            identity = [('etc/machine-id', h['machine_id']), ('proc/sys/kernel/random/boot_id', h['boot_id']),
                        ('etc/ssh/ssh_host_ed25519_key.pub', 'ssh-ed25519 ' + base64.b64encode(raw).decode())]
            for path, value in identity:
                target = self.root / path
                if not target.exists():
                    target.write_text(value + '\n'); target.chmod(0o600)
            if i == 0:
                key = self.root / 'root/.ssh/eru-fresh-core'
                if not key.exists():
                    key.write_text('synthetic-preprovisioned-core-key'); key.chmod(0o600)
            if roots is None:
                for path in self.root.rglob('*'):
                    if path.is_dir():
                        path.chmod(0o700)
            runner = FakeRunner(self); runner.nodes = self.nodes; runner.pods = self.pods
            self.runners[h['alias']] = runner
        self.root = self.roots[self.render['hosts'][0]['alias']]

    def assertEqual(self, actual, expected):
        if actual != expected:
            raise AssertionError('synthetic command oracle mismatch')

    def close(self):
        self.temp.cleanup()

    def reader(self, artifact):
        return self.archives[artifact['repository']]

    def transport(self, h, source, key):
        import ast
        import sys
        from unittest.mock import patch
        tree = ast.parse(source)
        encoded = tree.body[-1].value.args[0].value
        tree.body.pop()
        namespace = {}
        self.root = self.roots[h['alias']]
        self.calls.append({'host_index': next(i for i, row in enumerate(self.render['hosts']) if row['alias'] == h['alias'])})
        with patch.dict(sys.modules):
            exec(compile(tree, '<fixed-bootstrap-local-integration>', 'exec'), namespace)
            request = namespace['_decode'](base64.b64decode(encoded, validate=True))
            result = namespace['handle'](request, root=self.root, owner_uid=os.getuid(), owner_gid=os.getgid(),
                now=self.now, runner=self.runners[h['alias']], artifact_reader=self.reader)
        return render.canonical(result)
