"""Fixed copied-source pinned firewall transport; authority stays with controller."""
import base64
import copy
import json
from pathlib import Path

from fresh_execution import sha256, timestamp
import fresh_network_firewall as firewall
from fresh_observation import ALIASES, decode, public_key
from fresh_observation_ops import SSHReader

WIRE_LIMIT = 256 * 1024
ERROR = 'network firewall adapter rejected'
# This reviewed dependency list is code, never a path or module selected by wire data.
_BUNDLE = ('app_desired', 'fresh_rebuild', 'fresh_execution', 'fresh_observation',
           'fresh_network_access', 'fresh_network_staging_host',
           'fresh_network_staging', 'fresh_network_firewall')


def _request(value):
    from fresh_network_firewall_host import validate_request
    result = validate_request(value)
    raw = json.dumps(result, sort_keys=True, separators=(',', ':'),
                     ensure_ascii=False, allow_nan=False).encode('utf-8')
    if len(raw) > WIRE_LIMIT:
        raise ValueError(ERROR)
    return result, raw


def build_program(request):
    """Fixed reviewed source followed by exactly one encoded data argument."""
    try:
        _, raw = _request(request)
        directory = Path(__file__).resolve().parent
        lines = ['import base64, sys, types']
        for name in _BUNDLE:
            source = (directory / (name + '.py')).read_bytes()
            encoded = base64.b64encode(source).decode('ascii')
            lines.extend([
                '_module = types.ModuleType(' + repr(name) + ')',
                'sys.modules[' + repr(name) + '] = _module',
                'exec(compile(base64.b64decode(' + repr(encoded)
                + "), '<fixed-firewall-support>', 'exec'), _module.__dict__)"])
        helper = (directory / 'fresh_network_firewall_host.py').read_bytes()
        lines.extend([
            'exec(compile(base64.b64decode(' + repr(base64.b64encode(helper).decode('ascii'))
            + "), '<fixed-firewall-helper>', 'exec'), globals())",
            'main(' + repr(base64.b64encode(raw).decode('ascii')) + ')'])
        return '\n'.join(lines) + '\n'
    except Exception:
        raise ValueError(ERROR) from None


def _response(raw, expected, required_intent):
    if type(raw) is not bytes or len(raw) > WIRE_LIMIT:
        raise ValueError(ERROR)
    value = decode(raw.decode('utf-8'))
    firewall._bounded(value)
    # Only chronology is checked here. Current authority and freshness are owned
    # by the controller; a local timestamp cannot replace remote observation IO.
    observed = timestamp(value['observed_at'])
    table = value['table']
    if required_intent is None and table.get('kind') == 'absent':
        intent = None
    else:
        intent = required_intent if required_intent is not None else table['intent_sha256']
        sha256(intent)
    firewall.observation(value, expected, observed, intent_sha=intent)
    if intent is not None:
        # A present host journal binds actual object incarnations. Semantic
        # equality alone cannot establish that the response has output handles.
        for item in table['ruleset']['nftables']:
            if 'metainfo' in item:
                continue
            body = next(iter(item.values()))
            handle = body.get('handle')
            if type(handle) is not int or not 1 <= handle <= 2**64 - 1:
                raise ValueError(ERROR)
    return value


class SSHNetworkFirewallAdapter:
    """One fixed SSHReader call per operation; pinned OOB Ed25519 trust."""
    def __init__(self, host_keys, *, transport=None):
        try:
            if type(host_keys) is not dict or set(host_keys) != set(ALIASES):
                raise ValueError(ERROR)
            keys = copy.deepcopy(host_keys)
            if len({public_key(keys[alias]) for alias in ALIASES}) != 4:
                raise ValueError(ERROR)
            if transport is not None and not callable(transport):
                raise ValueError(ERROR)
            self._keys = keys
            self._transport = SSHReader() if transport is None else transport
        except Exception:
            raise ValueError(ERROR) from None

    def _send(self, action, intent):
        try:
            request = {'schema_version': 1, 'operation': 'observe' if intent is None else 'activate',
                       'action': action}
            if intent is not None:
                request['intent_sha256'] = intent
            request, _ = _request(request)
            expected = copy.deepcopy(request['action'])
            host = {field: expected['host'][field] for field in firewall.HOST_FIELDS}
            key = self._keys[host['alias']]
            if public_key(key) != host['host_key_sha256']:
                raise ValueError(ERROR)
            source = build_program(request)
            raw = self._transport(host, source, key)
            return _response(raw, expected, intent)
        except Exception:
            raise ValueError(ERROR) from None

    def observe(self, action):
        return self._send(action, None)

    def activate(self, action, intent_sha256):
        try:
            sha256(intent_sha256)
            return self._send(action, intent_sha256)
        except Exception:
            raise ValueError(ERROR) from None
