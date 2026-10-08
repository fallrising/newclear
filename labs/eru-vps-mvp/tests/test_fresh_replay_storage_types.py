"""Source bool/int64 storage types cannot use Python numeric equality."""
import base64
import copy
import json
import unittest

import fresh_replay_host as host
from fresh_bootstrap_render import canonical
import test_fresh_replay_host as fixtures


class StorageSourceTypesTests(unittest.TestCase):
    def test_canonical_records_reject_storage_numeric_type_aliases(self):
        harness = fixtures.Harness()
        self.addCleanup(harness.close)
        action = harness.action(2)
        harness.dispatch(action, 'b' * 64)
        valid = harness.observe(action)
        host.validate_evidence(action, valid)
        wid = harness.rows[0]['id']
        for variant in ('changed_zero', 'engine_float', 'request_float', 'limit_float'):
            with self.subTest(variant=variant):
                observed = copy.deepcopy(valid)
                command = observed['evidence']['captures'][0]['commands']['keys']
                keyspace = json.loads(base64.b64decode(command['stdout_base64']))
                record = json.loads(harness.metadata_state()['/eru/workloads/' + wid])
                storage = record['resources']['resource-storage']
                engine = record['engine_params']['resource-storage']
                if variant == 'changed_zero':
                    engine['volume_changed'] = 0
                elif variant == 'engine_float':
                    engine['storage'] = float(engine['storage'])
                elif variant == 'request_float':
                    storage['storage_request'] = float(storage['storage_request'])
                else:
                    storage['storage_limit'] = float(storage['storage_limit'])
                for row in keyspace['kvs']:
                    if base64.b64decode(row['key']).decode().endswith('/' + wid):
                        row['value'] = base64.b64encode(canonical(record)).decode()
                command['stdout_base64'] = base64.b64encode(canonical(keyspace)).decode()
                for name in ('workloads', 'get'):
                    capture = observed['evidence']['captures'][0]['commands'].get(name)
                    if capture is None:
                        continue
                    rows = json.loads(base64.b64decode(capture['stdout_base64']))
                    for row in rows:
                        if row['id'] == wid:
                            row['resources'] = canonical(record['resources']).decode()
                    capture['stdout_base64'] = base64.b64encode(canonical(rows)).decode()
                with self.assertRaises(ValueError):
                    host.validate_evidence(action, observed)
