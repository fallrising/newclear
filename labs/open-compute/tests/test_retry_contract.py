import copy
import json
import sqlite3
import unittest

import retry_contract as contract


def observation(name='unguarded', terminal=True):
    return {'job': {'id': 'job-one', 'case_name': name, 'completed': int(terminal and name != 'exhausted')},
            'job_count': 1, 'entries': [dict(attempt=a, **contract.POLICY,
            effect_acknowledged=1, outcome_marker='return' if a == 2 and name != 'exhausted' else 'throw')
            for a in (1, 2)] if terminal else [], 'entry_count': 2 if terminal else 0,
            'effect_count': (1 if name == 'idempotent' else 2) if terminal else 0}


def detail(name='unguarded'):
    success = name != 'exhausted'
    return {'params': {'jobId': 'job-one', 'caseName': name}, 'step_count': 1,
            'steps': [{'name': 'controlled-effect', 'type': 'step', 'success': success,
                       'attempts': [], 'config': {'retries': {'limit': 0, 'delay': 0}, 'timeout': 0},
                       'output': None, 'start': 'metadata', 'end': 'metadata'}],
            'status': 'complete' if success else 'errored', 'success': success,
            'error': None if success else {'name': 'Error', 'message': 'Workflow execution failed'},
            'output': {'jobId': 'job-one', 'caseName': name, 'attempt': 2} if success else None,
            'versionId': 'public-metadata'}


class RetryContractTests(unittest.TestCase):
    def test_all_cases_initial_final_and_projection(self):
        result = contract.initial_retries()
        for name in contract.CASES:
            job_id = 'job-' + name
            first, last, public = observation(name, False), observation(name), detail(name)
            first['job']['id'] = last['job']['id'] = public['params']['jobId'] = job_id
            if public['output'] is not None: public['output']['jobId'] = job_id
            initial = contract.validate_row(first, job_id, name, terminal=False)
            row = contract.validate_row(last, job_id, name, terminal=True)
            terminal = contract.validate_terminal(public, job_id, name)
            result['cases'].append(contract.case_result(name, job_id, 'workflow-' + name, initial, row, terminal))
        result['get_requests'] = 15
        self.assertEqual(contract.project_retries(result, complete=True), result)
        self.assertNotIn('\"attempts\"', json.dumps(result))

    def test_row_rejects_failure_boundaries(self):
        base = observation()
        variants = []
        for key in ('job_count', 'entry_count', 'effect_count'):
            for bad in (True, 0, 3, 1.0):
                value = copy.deepcopy(base); value[key] = bad; variants.append(value)
        for bad in (None, {'id': 'wrong', 'case_name': 'unguarded', 'completed': 1}):
            value = copy.deepcopy(base); value['job'] = bad; variants.append(value)
        for field, bad in [('attempt', True), ('attempt', 3), ('retry_limit', 2), ('delay_ms', 101),
                           ('backoff', 'exponential'), ('timeout_ms', 4999),
                           ('effect_acknowledged', 0), ('effect_acknowledged', True),
                           ('outcome_marker', 'entered'), ('outcome_marker', 'return')]:
            value = copy.deepcopy(base); value['entries'][0][field] = bad; variants.append(value)
        for entries in ([], base['entries'][::-1], [base['entries'][0]] * 2, base['entries'] + [base['entries'][1]]):
            value = copy.deepcopy(base); value['entries'] = entries; variants.append(value)
        value = copy.deepcopy(base); value['secret'] = 'x'; variants.append(value)
        value = copy.deepcopy(base); value['entries'][0]['secret'] = 'x'; variants.append(value)
        value = copy.deepcopy(base); value['job']['case_name'] = 'idempotent'; variants.append(value)
        value = copy.deepcopy(base); value['job']['completed'] = True; variants.append(value)
        # Counterexample: first D1 effect fails, runtime retries and second succeeds.
        value = copy.deepcopy(base); value['effect_count'] = 1; value['entries'][0]['effect_acknowledged'] = 0; variants.append(value)
        for value in variants:
            with self.subTest(value=value), self.assertRaises(ValueError):
                contract.validate_row(value, 'job-one', 'unguarded', terminal=True)

    def test_post_effect_checkpoint_required_even_when_final_effect_count_matches(self):
        for name in contract.CASES:
            value = observation(name)
            value['entries'][0]['effect_acknowledged'] = 0
            with self.assertRaises(ValueError):
                contract.validate_row(value, 'job-one', name, terminal=True)

    def test_terminal_strict_facts_not_placeholder_attempts(self):
        for name in contract.CASES:
            base = detail(name)
            for key, bad in [('params', {'jobId': 'wrong', 'caseName': name}), ('step_count', True),
                             ('step_count', 2), ('steps', []), ('status', 'terminated'),
                             ('success', 1), ('output', {}), ('error', {'name': 'Error', 'message': 'internal'})]:
                value = copy.deepcopy(base); value[key] = bad
                with self.subTest(name=name, key=key), self.assertRaises(ValueError):
                    contract.validate_terminal(value, 'job-one', name)
            for field, bad in [('name', 'other'), ('type', 'waitForEvent'), ('success', None)]:
                value = copy.deepcopy(base); value['steps'][0][field] = bad
                with self.assertRaises(ValueError): contract.validate_terminal(value, 'job-one', name)

    def test_projection_revalidates_prefix_types_unknown_fields_and_size(self):
        empty = contract.initial_retries()
        self.assertEqual(contract.project_retries(empty), empty)
        with self.assertRaises(ValueError): contract.project_retries(empty, complete=True)
        variants = []
        for key, bad in [('schema_version', True), ('get_requests', True), ('get_requests', 257),
                         ('get_requests', float('nan')), ('cases', [{}]), ('policy', {}),
                         ('limits', {}), ('limitations', {})]:
            value = copy.deepcopy(empty); value[key] = bad; variants.append(value)
        value = copy.deepcopy(empty); value['secret'] = 'x' * 17000; variants.append(value)
        for value in variants:
            with self.assertRaises(ValueError): contract.project_retries(value)
        initial = observation(terminal=False); row = observation(); terminal = contract.validate_terminal(detail(), 'job-one', 'unguarded')
        case = contract.case_result('unguarded', 'job-one', 'workflow-one', initial, row, terminal)
        for field, bad in [('stable_readback', False), ('entry_count', True), ('workflow_id', 'BAD'), ('initial', {})]:
            value = copy.deepcopy(empty); item = copy.deepcopy(case); item[field] = bad; value['cases'] = [item]
            with self.assertRaises(ValueError): contract.project_retries(value)
        value = copy.deepcopy(empty); value['cases'] = [case, case]
        with self.assertRaises(ValueError): contract.project_retries(value)
        projected = contract.project_retries(empty); projected['policy']['delay_ms'] = 9
        self.assertEqual(contract.POLICY['delay_ms'], 100)

    def test_nonfinite_diagnostics_remain_fixed_schema_category(self):
        for number in (float('nan'), float('inf'), -float('inf')):
            value = contract.initial_retries()
            value['get_requests'] = number
            with self.assertRaises(ValueError) as raised:
                contract.project_retries(value)
            self.assertEqual(str(raised.exception), 'schema')

    def test_schema_exposes_independent_entry_identity_and_nullable_unique_effect_key(self):
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        for sql in contract.SCHEMA_SQL: db.execute(sql)
        db.execute('INSERT INTO retry_jobs(id, case_name) VALUES (?, ?)', ('job-one', 'unguarded'))
        for identity in ('a', 'b'):
            db.execute('INSERT INTO retry_entries(entry_id,job_id,attempt,retry_limit,delay_ms,backoff,timeout_ms) VALUES (?,?,?,?,?,?,?)', (identity,'job-one',1,1,100,'constant',5000))
        self.assertEqual(db.execute('SELECT attempt FROM retry_entries ORDER BY seq').fetchall(), [(1,), (1,)])
        for key in (None, None, 'stable'):
            db.execute('INSERT INTO retry_effects(job_id, operation_key) VALUES (?, ?)', ('job-one',key))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute('INSERT INTO retry_effects(job_id, operation_key) VALUES (?, ?)', ('job-one','stable'))
