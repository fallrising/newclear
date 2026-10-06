"""Fixed copied-source bootstrap transport using existing pinned Ed25519 SSH trust."""
import base64
import copy
from datetime import datetime
from pathlib import Path

import fresh_bootstrap_host as helper
import fresh_bootstrap_render as render
from fresh_observation import ALIASES, public_key
from fresh_observation_ops import SSHReader

ERROR = 'fresh bootstrap adapter rejected'
_BUNDLE = ('app_desired', 'fresh_rebuild', 'fresh_execution', 'fresh_observation',
           'fresh_network_access', 'fresh_network_staging_host', 'fresh_network_staging',
           'fresh_network_firewall', 'fresh_network_firewall_host', 'worker_payload',
           'fresh_bootstrap_render')


def build_program(request):
    """The module list and helper are fixed code; the last argument is encoded data."""
    try:
        request = helper.validate_request(request)
        raw = render.canonical(request)
        if len(raw) > helper.WIRE_LIMIT:
            raise ValueError(ERROR)
        directory = Path(__file__).resolve().parent
        lines = ['import base64, sys, types']
        for name in _BUNDLE:
            source = (directory / (name + '.py')).read_bytes()
            encoded = base64.b64encode(source).decode()
            lines.extend(['_module = types.ModuleType(' + repr(name) + ')',
                'sys.modules[' + repr(name) + '] = _module',
                'exec(compile(base64.b64decode(' + repr(encoded) + "), '<fixed-bootstrap-support>', 'exec'), _module.__dict__)"])
        source = (directory / 'fresh_bootstrap_host.py').read_bytes()
        lines.extend(['exec(compile(base64.b64decode(' + repr(base64.b64encode(source).decode())
            + "), '<fixed-bootstrap-helper>', 'exec'), globals())",
            'main(' + repr(base64.b64encode(raw).decode()) + ')'])
        program = '\n'.join(lines) + '\n'
        if len(program.encode()) > helper.PROGRAM_LIMIT:
            raise ValueError(ERROR)
        return program
    except Exception:
        raise ValueError(ERROR) from None


def _response(raw, action, required_intent):
    if type(raw) is not bytes or len(raw) > helper.LIMIT:
        raise ValueError(ERROR)
    value = helper._decode(raw, helper.LIMIT)
    render._exact(value, {'schema_version', 'action_sha256', 'observed_at', 'host', 'state', 'provenance', 'evidence'})
    if type(value['schema_version']) is not int or value['schema_version'] != 1:
        raise ValueError(ERROR)
    observed = datetime.fromisoformat(value['observed_at'])
    if observed.tzinfo is None:
        raise ValueError(ERROR)
    provenance = value['provenance']
    if provenance is not None:
        render._exact(provenance, {'intent_sha256', 'action_sha256', 'started_at', 'completed_at'})
        render._hash(provenance['intent_sha256'])
        if provenance['action_sha256'] != render.digest(render.canonical(action)):
            raise ValueError(ERROR)
        if required_intent is not None and provenance['intent_sha256'] != required_intent:
            raise ValueError(ERROR)
        start = datetime.fromisoformat(provenance['started_at'])
        end = None if provenance['completed_at'] is None else datetime.fromisoformat(provenance['completed_at'])
        if start.tzinfo is None or start > observed or end is not None and (end.tzinfo is None or end < start or end > observed):
            raise ValueError(ERROR)
        if value['state'] == 'complete' and end is None:
            raise ValueError(ERROR)
    if required_intent is not None and (provenance is None or value['state'] != 'complete'):
        raise ValueError(ERROR)
    if value['state'] == 'absent' and provenance is not None or value['state'] == 'uncertain' and provenance is None:
        raise ValueError(ERROR)
    helper.validate_evidence(action, value, before=value['state'] == 'absent')
    return value


class SSHBootstrapAdapter:
    """One fixed SSHReader dispatch; recovery calls observe and cannot replay writers."""
    def __init__(self, host_keys, *, transport=None):
        try:
            if type(host_keys) is not dict or set(host_keys) != set(ALIASES):
                raise ValueError(ERROR)
            if len({public_key(host_keys[a]) for a in ALIASES}) != 4:
                raise ValueError(ERROR)
            if transport is not None and not callable(transport):
                raise ValueError(ERROR)
            self._keys = copy.deepcopy(host_keys)
            self._transport = SSHReader() if transport is None else transport
        except Exception:
            raise ValueError(ERROR) from None

    def _send(self, action, intent):
        try:
            request = {'schema_version': 1, 'operation': 'observe' if intent is None else 'dispatch', 'action': action}
            if intent is not None:
                request['intent_sha256'] = render._hash(intent)
            request = helper.validate_request(request)
            action = request['action']; host = {k: action['host'][k] for k in render.HOST_FIELDS}
            key = self._keys[host['alias']]
            if public_key(key) != host['host_key_sha256']:
                raise ValueError(ERROR)
            raw = self._transport(host, build_program(request), key)
            return _response(raw, action, intent)
        except Exception:
            raise ValueError(ERROR) from None

    def observe(self, action):
        return self._send(action, None)

    def dispatch(self, action, intent_sha256):
        return self._send(action, intent_sha256)
