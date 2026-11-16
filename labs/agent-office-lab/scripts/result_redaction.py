"""Centralized projection helpers for synthetic result redaction.

These helpers intentionally detect only the frozen synthetic sentinel grammar from
T-0027. They do not scan for or classify real credentials.
"""
import difflib
import hashlib
import json
import re

SYNTHSECRET = re.compile(r'(?<![A-Za-z0-9])SYNTHSECRET_[0-9a-f]{16}(?![A-Za-z0-9])')
REDACTED = 'SYNTHSECRET_REDACTED'
POLICY = 'synthetic-v1'
_REF = re.compile(r'r1_[a-f0-9]{32}\Z')


class RedactionError(ValueError):
    pass


def _unicode_safe(text):
    # JSON/UTF-8 cannot safely carry lone surrogate code units.  A UTF-16
    # roundtrip with surrogatepass combines valid pairs and replaces lone units.
    return text.encode('utf-16-le', 'surrogatepass').decode('utf-16-le', 'replace')


def redact(text):
    if not isinstance(text, str):
        raise TypeError('redact expects str')
    return SYNTHSECRET.sub(REDACTED, _unicode_safe(text))


def _redact_tree(value):
    if isinstance(value, str):
        redacted = redact(value)
        return redacted, redacted != value
    if isinstance(value, list):
        changed = False
        result = []
        for item in value:
            projected, item_changed = _redact_tree(item)
            changed = changed or item_changed
            result.append(projected)
        return result, changed
    if isinstance(value, tuple):
        projected, changed = _redact_tree(list(value))
        return projected, changed
    if isinstance(value, dict):
        changed = False
        result = {}
        for key, item in value.items():
            if isinstance(key, str):
                out_key = redact(key)
                changed = changed or out_key != key
            else:
                out_key = key
            if out_key in result:
                raise RedactionError('redaction_key_collision')
            out_item, item_changed = _redact_tree(item)
            changed = changed or item_changed
            result[out_key] = out_item
        return result, changed
    return value, False


def redact_tree(value):
    return _redact_tree(value)[0]


def display_bytes(text):
    return redact(text).encode('utf8')


def display_sha256(text):
    return hashlib.sha256(display_bytes(text)).hexdigest()


def valid_ref(value):
    return isinstance(value, str) and _REF.fullmatch(value) is not None


def make_ref(root, raw_run_name):
    if type(root) is not int or root <= 0 or not isinstance(raw_run_name, str):
        raise RedactionError('invalid_ref_input')
    name = _unicode_safe(raw_run_name)
    raw = (b'agent-office-result-ref\0' + str(root).encode('ascii')
           + b'\0' + name.encode('utf8'))
    return 'r1_' + hashlib.sha256(raw).hexdigest()[:32]


def _identity(row):
    raw_id = row.get('id') if isinstance(row, dict) else None
    root = row.get('root') if isinstance(row, dict) and type(row.get('root')) is int and row.get('root') > 0 else None
    raw_name = None
    if isinstance(raw_id, str):
        match = re.fullmatch(r'([1-9][0-9]*):(.*)', raw_id)
        if match:
            parsed_root = int(match.group(1))
            if root is None:
                root = parsed_root
            raw_name = match.group(2)
        else:
            if root is None:
                root = 1
            raw_name = raw_id
    if root is None:
        root = 1
    return root, raw_name


def _already_projected_name(value):
    return isinstance(value, str) and REDACTED in value and SYNTHSECRET.search(value) is None


def _safe_ref(root, raw_name, existing=None):
    if _already_projected_name(raw_name) and valid_ref(existing):
        return existing
    if isinstance(raw_name, str):
        try:
            return make_ref(root, raw_name)
        except Exception:
            pass
    return None


def _id_redacted(row, safe_id, raw_id):
    return bool(safe_id != raw_id or (valid_ref(row.get('ref')) and row.get('id_redacted') is True))


def _fallback(row):
    status = row.get('status') if isinstance(row, dict) else None
    if status not in {'failed', 'cancelled', 'stopped', 'incomplete', 'unverified', 'invalid', 'startup_only'}:
        status = 'invalid'
    raw_id = row.get('id') if isinstance(row, dict) else None
    try:
        safe_id = redact(raw_id) if isinstance(raw_id, str) else 'unavailable'
        if SYNTHSECRET.search(safe_id):
            safe_id = 'unavailable'
    except Exception:
        safe_id = 'unavailable'
    root, raw_name = _identity(row if isinstance(row, dict) else {})
    ref = _safe_ref(root, raw_name, row.get('ref') if isinstance(row, dict) else None)
    return {'id': safe_id or 'unavailable', 'root': root, 'id_redacted': _id_redacted(row, safe_id, raw_id),
            'ref': ref, 'provider': 'unknown', 'model': None, 'version': None,
            'status': status, 'reason': 'redaction_failed',
            'artifact': {'status': 'unavailable'}, 'cleanup_verified': False,
            'redaction': {'policy': POLICY, 'applied': True}}


def _canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n'


def _revision_diff(original, text, target):
    diff = '\n'.join(difflib.unified_diff(
        original.splitlines(), text.splitlines(),
        fromfile='before/' + target, tofile='after/' + target, lineterm=''))
    if not diff:
        diff = 'Only line endings or the final newline changed.'
    return diff


def _project_retry(projected, raw_retry, root):
    if not isinstance(raw_retry, dict):
        return
    retry = {}
    for key in ('root', 'parent'):
        raw_value = raw_retry.get(key)
        existing_ref = raw_retry.get(key + '_ref')
        if raw_value is None:
            retry[key] = None
            retry[key + '_ref'] = None
        elif isinstance(raw_value, str):
            retry[key] = redact(raw_value)
            retry[key + '_ref'] = _safe_ref(root, raw_value, existing_ref)
        else:
            retry[key] = None
            retry[key + '_ref'] = None
    if type(raw_retry.get('attempt')) is int:
        retry['attempt'] = raw_retry['attempt']
    projected['retry'] = retry


def _project_artifact(projected, raw_artifact, artifact_changed):
    artifact = projected.get('artifact')
    if not isinstance(artifact, dict):
        projected['artifact'] = {'status': 'unavailable', 'redacted': bool(artifact_changed)}
        return artifact_changed
    if artifact.get('status') == 'verified':
        if artifact.get('kind') == 'text' and isinstance(artifact.get('text'), str):
            artifact['display_sha256'] = display_sha256(artifact['text'])
        elif artifact.get('kind') == 'revision' and isinstance(artifact.get('text'), str):
            original = artifact.get('original')
            if not isinstance(original, str) or type(artifact.get('changed')) is not bool:
                raise RedactionError('invalid_revision')
            text = artifact['text']
            target = artifact.get('target') if isinstance(artifact.get('target'), str) else artifact.get('name', 'output.md')
            target = target if isinstance(target, str) else 'output.md'
            artifact['display_original_sha256'] = display_sha256(original)
            artifact['display_sha256'] = display_sha256(text)
            raw_changed = isinstance(raw_artifact, dict) and raw_artifact.get('changed') is True
            display_changed = original != text
            if display_changed and not raw_changed:
                raise RedactionError('inconsistent_revision')
            artifact['display_changed'] = display_changed
            artifact['diff'] = _revision_diff(original, text, target) if display_changed else ''
            artifact['display_diff_sha256'] = display_sha256(artifact['diff'])
        elif 'content' in artifact:
            export_text = _canonical_json(artifact['content'])
            artifact['export_text'] = export_text
            artifact['export_canonical'] = True
            artifact['display_sha256'] = hashlib.sha256(export_text.encode('utf8')).hexdigest()
    artifact['redacted'] = bool(artifact_changed or (isinstance(raw_artifact, dict) and raw_artifact.get('redacted') is True))
    return artifact['redacted']


def project_row(row):
    try:
        if not isinstance(row, dict):
            raise RedactionError('row_not_object')
        if row.get('reason') == 'redaction_failed':
            return _fallback(row)
        root, raw_name = _identity(row)
        row_ref = _safe_ref(root, raw_name, row.get('ref'))
        projected, changed = _redact_tree(row)
        if not isinstance(projected, dict):
            raise RedactionError('row_not_object')
        raw_id = row.get('id')
        safe_id = redact(raw_id) if isinstance(raw_id, str) else 'unavailable'
        projected['id'] = safe_id or 'unavailable'
        projected['root'] = root
        projected['id_redacted'] = _id_redacted(row, safe_id, raw_id)
        projected['ref'] = row_ref
        artifact_changed = False
        if isinstance(row.get('artifact'), dict):
            _, artifact_changed = _redact_tree(row['artifact'])
        artifact_changed = _project_artifact(projected, row.get('artifact'), artifact_changed)
        _project_retry(projected, row.get('retry'), root)
        projected['redaction'] = {'policy': POLICY, 'applied': bool(changed or (isinstance(row.get('redaction'), dict) and row['redaction'].get('applied') is True))}
        return projected
    except Exception:
        return _fallback(row if isinstance(row, dict) else {})


def contains_sentinel(value):
    return isinstance(value, str) and SYNTHSECRET.search(value) is not None
