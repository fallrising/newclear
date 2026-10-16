"""Pure, bounded M6 observation validation; no runtime or I/O authority."""

import copy
import json
import re

CASES = ('unguarded', 'idempotent', 'exhausted')
POLICY = {'retry_limit': 1, 'delay_ms': 100, 'backoff': 'constant', 'timeout_ms': 5000}
LIMITS = {'cases': 3, 'case_seconds': 60, 'scenario_seconds': 300, 'max_gets': 256}
LIMITATIONS = {'controlled_callback_errors': True, 'crash_tested': False,
              'power_loss_tested': False, 'synthetic_d1_only': True,
              'external_exactly_once_tested': False, 'future_execution_unobserved': True,
              'public_attempt_history_used': False}
SCHEMA_SQL = (
    'CREATE TABLE retry_jobs (id TEXT PRIMARY KEY, case_name TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0)',
    'CREATE TABLE retry_entries (seq INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL UNIQUE, job_id TEXT NOT NULL, attempt INTEGER NOT NULL, retry_limit INTEGER NOT NULL, delay_ms INTEGER NOT NULL, backoff TEXT NOT NULL, timeout_ms INTEGER NOT NULL, effect_acknowledged INTEGER NOT NULL DEFAULT 0, outcome_marker TEXT NOT NULL DEFAULT \'entered\')',
    'CREATE TABLE retry_effects (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, operation_key TEXT UNIQUE)',
)
_ID = re.compile(r'[a-z0-9][a-z0-9-]{0,63}\Z', re.ASCII)


def _require(condition):
    if not condition:
        raise ValueError('schema')


def _bounded(value):
    try:
        encoded = json.dumps(value, allow_nan=False, ensure_ascii=True, separators=(',', ':'))
        _require(len(encoded.encode('utf-8')) <= 16384)
    except (TypeError, ValueError, OverflowError, RecursionError):
        raise ValueError('schema') from None


def _exact(value, expected):
    """Compare recursively without Python's bool/int or int/float equivalence."""
    _require(type(value) is type(expected))
    if type(expected) is dict:
        _require(value.keys() == expected.keys())
        for key in expected:
            _exact(value[key], expected[key])
    elif type(expected) is list:
        _require(len(value) == len(expected))
        for observed, wanted in zip(value, expected):
            _exact(observed, wanted)
    else:
        _require(value == expected)


def _identity(job_id, case_name):
    _require(type(job_id) is str and _ID.fullmatch(job_id) is not None)
    _require(type(case_name) is str and case_name in CASES)


def _entries(case_name):
    return [dict(attempt=attempt, **POLICY, effect_acknowledged=1,
                 outcome_marker='return' if attempt == 2 and case_name != 'exhausted' else 'throw')
            for attempt in (1, 2)]


def validate_row(value, job_id, case_name, *, terminal):
    _bounded(value)
    _identity(job_id, case_name)
    _require(type(terminal) is bool)
    expected = {'job': {'id': job_id, 'case_name': case_name,
                       'completed': int(terminal and case_name != 'exhausted')},
                'job_count': 1, 'entries': _entries(case_name) if terminal else [],
                'entry_count': 2 if terminal else 0,
                'effect_count': (1 if case_name == 'idempotent' else 2) if terminal else 0}
    _exact(value, expected)
    return copy.deepcopy(expected)


def _terminal(job_id, case_name):
    success = case_name != 'exhausted'
    return {'status': 'complete' if success else 'errored', 'success': success,
            'error': None if success else {'name': 'Error', 'message': 'Workflow execution failed'},
            'output': {'jobId': job_id, 'caseName': case_name, 'attempt': 2} if success else None,
            'step_name': 'controlled-effect', 'step_type': 'step', 'step_success': success}


def validate_terminal(value, job_id, case_name):
    _bounded(value)
    _identity(job_id, case_name)
    _require(type(value) is dict)
    expected = _terminal(job_id, case_name)
    _exact(value.get('params'), {'jobId': job_id, 'caseName': case_name})
    _exact(value.get('step_count'), 1)
    steps = value.get('steps')
    _require(type(steps) is list and len(steps) == 1 and type(steps[0]) is dict)
    for source, target in (('name', 'step_name'), ('type', 'step_type'), ('success', 'step_success')):
        _exact(steps[0].get(source), expected[target])
    for key in ('status', 'success', 'error', 'output'):
        _require(key in value)
        _exact(value[key], expected[key])
    return copy.deepcopy(expected)


def case_result(case_name, job_id, workflow_id, initial, row, terminal):
    """Caller must first compare the two validated terminal and D1 readbacks."""
    _identity(job_id, case_name)
    _require(type(workflow_id) is str and _ID.fullmatch(workflow_id) is not None)
    validate_row(initial, job_id, case_name, terminal=False)
    row = validate_row(row, job_id, case_name, terminal=True)
    _exact(terminal, _terminal(job_id, case_name))
    return {'name': case_name, 'job_id': job_id, 'workflow_id': workflow_id,
            'initial': {'job_count': 1, 'entry_count': 0, 'effect_count': 0, 'completed': 0},
            'entries': row['entries'], 'entry_count': row['entry_count'],
            'effect_count': row['effect_count'], 'completed': row['job']['completed'],
            'terminal': copy.deepcopy(terminal), 'stable_readback': True}


def initial_retries():
    return {'schema_version': 1, 'policy': copy.deepcopy(POLICY), 'limits': copy.deepcopy(LIMITS),
            'limitations': copy.deepcopy(LIMITATIONS), 'cases': [], 'get_requests': 0}


def project_retries(value, *, complete=False):
    _bounded(value)
    _require(type(complete) is bool and type(value) is dict)
    expected = initial_retries()
    _require(value.keys() == expected.keys())
    for key in ('schema_version', 'policy', 'limits', 'limitations'):
        _exact(value[key], expected[key])
    count = value['get_requests']
    _require(type(count) is int and 0 <= count <= 256)
    cases = value['cases']
    _require(type(cases) is list and len(cases) <= 3 and (not complete or len(cases) == 3))
    jobs, workflows = set(), set()
    for index, item in enumerate(cases):
        _require(type(item) is dict)
        name = CASES[index]
        job_id, workflow_id = item.get('job_id'), item.get('workflow_id')
        _identity(job_id, name)
        _require(type(workflow_id) is str and _ID.fullmatch(workflow_id) is not None)
        _require(job_id not in jobs and workflow_id not in workflows)
        jobs.add(job_id); workflows.add(workflow_id)
        row = {'job': {'id': job_id, 'case_name': name, 'completed': int(name != 'exhausted')},
               'job_count': 1, 'entries': _entries(name), 'entry_count': 2,
               'effect_count': 1 if name == 'idempotent' else 2}
        initial = {'job': {'id': job_id, 'case_name': name, 'completed': 0}, 'job_count': 1,
                   'entries': [], 'entry_count': 0, 'effect_count': 0}
        _exact(item, case_result(name, job_id, workflow_id, initial, row, _terminal(job_id, name)))
    return copy.deepcopy(value)
