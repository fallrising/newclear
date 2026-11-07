"""Pure, bounded inspection of restored D1 command rows and runner journal rows.

This is evidence comparison, not authorization, freshness validation or a runner.
The caller supplies consistent snapshots; even matching old snapshots cannot prove
that no later execution occurred. No I/O and no dispatch capability are provided.
"""
import hashlib
import json

TERMINAL = {'result_recorded', 'closed_unknown', 'cancelled_before_dispatch', 'expired_before_dispatch'}
DELIVERIES = TERMINAL | {'accepted', 'dispatching', 'reconciling'}
UNKNOWN = dict(owner_outcome='unknown', started_at=None, finished_at=None, artifact=None)


def require(condition):
    if not condition:
        raise ValueError('invalid restore evidence')


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      separators=(',', ':'), sort_keys=True).encode('utf-8')


def digest(raw):
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def parse(raw):
    require(isinstance(raw, str) and len(raw.encode('utf-8')) <= 131072)

    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value)
            value[key] = item
        return value

    def invalid(_):
        raise ValueError('invalid restore evidence')

    value = json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid, parse_float=invalid)
    require(isinstance(value, dict))
    encode(value)  # Reject nonfinite exponents and unpaired UTF-8 surrogates too.
    return value


def command(row):
    require(isinstance(row, dict))
    record, body = parse(row['record']), parse(row['body'])
    require(isinstance(row['id'], str) and 0 < len(row['id']) <= 256)
    require(type(row['revision']) is int and row['revision'] >= 1)
    require(type(record['revision']) is int and record['revision'] == row['revision'])
    require(record['command_id'] == row['id'])
    require(encode(record['command']) == encode(body))
    require(row['body_digest'] == digest(row['body']))
    require(record['delivery'] in DELIVERIES)
    require(type(row['active']) is int and row['active'] == int(record['delivery'] not in TERMINAL))
    require(isinstance(record.get('external_ref'), (dict, type(None))))
    return record


def journal(row):
    require(isinstance(row, (list, tuple)) and len(row) == 5)
    cid, identity, raw_ref, state, raw_result = row
    require(isinstance(cid, str) and 0 < len(cid) <= 256)
    require(isinstance(identity, str) and len(identity) == 64 and all(c in '0123456789abcdef' for c in identity))
    require(state in {'started', 'completed', 'unknown'})
    ref = parse(raw_ref)
    result = None if raw_result is None else parse(raw_result)
    require(state != 'started' or result is None)
    require(state != 'completed' or isinstance(result, dict))
    require(state != 'unknown' or result in (None, UNKNOWN))
    return identity, ref, state, result


def compare(record, saved):
    identity, ref, state, result = saved
    expected = hashlib.sha256(encode({'command': record['command'], 'external_ref': record['external_ref']})).hexdigest()
    if identity != expected or encode(ref) != encode(record['external_ref']):
        return 'quarantined'
    if state in {'started', 'unknown'}:
        if record['delivery'] == 'reconciling' and record.get('result') is None and record.get('artifact') is None:
            return 'unknown_preserved'
        return 'quarantined'
    control = record.get('result')
    if record['delivery'] != 'result_recorded' or not isinstance(control, dict):
        return 'quarantined'
    if set(result) != set(UNKNOWN) or result['owner_outcome'] != 'succeeded':
        return 'quarantined'
    if not all(isinstance(result[k], str) for k in ('artifact', 'started_at', 'finished_at')):
        return 'quarantined'
    if any(control.get(k) != result[k] for k in ('owner_outcome', 'started_at', 'finished_at')):
        return 'quarantined'
    if record.get('artifact') != result['artifact'] or control.get('artifact_sha256') != 'sha256:'+digest(result['artifact']):
        return 'quarantined'
    return 'completed_preserved'


def audit_restore(commands, journals):
    """Return redacted classifications; structural corruption rejects the batch.

    Inputs: D1 SELECT * FROM commands dictionaries, executions SELECT * rows
    with BLOB JSON decoded as strict UTF-8. Orphan/missing/conflicting records
    are quarantined. No classification allows dispatch or implies current health.
    """
    try:
        require(isinstance(commands, (list, tuple)) and len(commands) <= 10000)
        require(isinstance(journals, (list, tuple)) and len(journals) <= 10000)
        control, local = {}, {}
        for row in commands:
            record = command(row)
            require(row['id'] not in control)
            control[row['id']] = record
        for row in journals:
            saved = journal(row)
            require(row[0] not in local)
            local[row[0]] = saved
        return [dict(command_id=cid, dispatch_allowed=False,
                     status=compare(control[cid], local[cid]) if cid in control and cid in local else 'quarantined')
                for cid in sorted(control.keys() | local.keys())]
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError, OverflowError):
        raise ValueError('invalid restore evidence') from None
