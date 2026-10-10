"""Fixed pinned SSH directory preparation; authorization remains with the coordinator."""
import base64
import copy
import json
from pathlib import Path

from fresh_execution import sha256, timestamp
from fresh_network_directory import HOST_FIELDS, observation
from fresh_observation import ALIASES, decode, public_key
from fresh_observation_ops import SSHReader

WIRE_LIMIT = 256 * 1024
ERROR = 'network directory adapter rejected'


def _request(value):
    # The same zero-I/O validator constrains both the controller and remote helper.
    from fresh_network_directory_host import validate_request
    result = validate_request(value)
    raw = json.dumps(result, sort_keys=True, separators=(',', ':'),
                     ensure_ascii=False, allow_nan=False).encode('utf-8')
    if len(raw) > WIRE_LIMIT:
        raise ValueError(ERROR)
    return result, raw


def build_program(request):
    """Fixed reviewed helper source followed by one data-only base64 argument."""
    try:
        _, raw = _request(request)
        directory = Path(__file__).resolve().parent
        support = (directory / 'fresh_network_staging_host.py').read_bytes()
        helper = (directory / 'fresh_network_directory_host.py').read_bytes()
        # Only fixed, locally reviewed source becomes code. The request enters
        # exclusively as data in the final main argument. Remote Python needs
        # no checkout or dynamically selected module search path.
        return ("import base64, sys, types\n"
                "_support = types.ModuleType('fresh_network_staging_host')\n"
                "sys.modules['fresh_network_staging_host'] = _support\n"
                "exec(compile(base64.b64decode(" + repr(base64.b64encode(support).decode('ascii'))
                + "), '<fixed-directory-support>', 'exec'), _support.__dict__)\n"
                "exec(compile(base64.b64decode(" + repr(base64.b64encode(helper).decode('ascii'))
                + "), '<fixed-directory-helper>', 'exec'), globals())\n"
                "main(" + repr(base64.b64encode(raw).decode('ascii')) + ")\n")
    except Exception:
        raise ValueError(ERROR) from None


def _response(raw, expected, required_intent):
    if type(raw) is not bytes or len(raw) > WIRE_LIMIT:
        raise ValueError(ERROR)
    value = decode(raw.decode('utf-8'))
    # The coordinator owns freshness and authority checks. Here only a valid UTC
    # chronology value is accepted, without substituting a cached local clock.
    observed = timestamp(value['observed_at'])
    directory = value['directory']
    if required_intent is None and directory.get('kind') == 'absent':
        intent = None
    else:
        intent = required_intent if required_intent is not None else directory['intent_sha256']
        sha256(intent)
    observation(value, expected, observed, intent_sha=intent)
    return value


class SSHNetworkDirectoryAdapter:
    """One transport call per operation; no retry, trust mutation or adoption."""
    def __init__(self, host_keys, *, transport=None):
        try:
            if type(host_keys) is not dict or set(host_keys) != set(ALIASES):
                raise ValueError(ERROR)
            keys = copy.deepcopy(host_keys)
            digests = [public_key(keys[alias]) for alias in ALIASES]
            if len(set(digests)) != 4:
                raise ValueError(ERROR)
            if transport is not None and not callable(transport):
                raise ValueError(ERROR)
            self._keys = keys
            self._transport = SSHReader() if transport is None else transport
        except Exception:
            raise ValueError(ERROR) from None

    def _send(self, action, intent):
        try:
            request = {'schema_version': 1, 'operation': 'observe' if intent is None else 'prepare',
                       'action': action}
            if intent is not None:
                request['intent_sha256'] = intent
            request, _ = _request(request)
            expected = copy.deepcopy(request['action'])
            host = {k: expected['host'][k] for k in HOST_FIELDS}
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

    def prepare(self, action, intent_sha256):
        try:
            sha256(intent_sha256)
            return self._send(action, intent_sha256)
        except Exception:
            raise ValueError(ERROR) from None
