"""Shared verdict shape for the faithfulness check.

Model output and source text are data. This module never executes them.
"""
from __future__ import annotations

ISSUE_KINDS = (
    'fabricated-claim',
    'missing-key-point',
    'over-inference',
    'wrong-number',
    'broken-example-logic',
    'checker-error',
)
MODEL_KINDS = ISSUE_KINDS[:-1]
VERDICTS = ('pass', 'flag')
LLM_MODES = ('skipped', 'command', 'openai-compatible')
MAX_ISSUES = 8
MAX_DETAIL = 500


def checker_error(detail: str) -> dict:
    return {'verdict': 'flag', 'issues': [{'kind': 'checker-error', 'detail': detail}]}


def normalize_model_output(payload) -> dict:
    """Turn untrusted model JSON into a pass/flag record. Bad input cannot pass."""
    if not isinstance(payload, dict):
        return checker_error('model output is not an object')
    verdict = payload.get('verdict')
    issues = payload.get('issues')
    if verdict not in VERDICTS or not isinstance(issues, list):
        return checker_error('model output missing verdict or issues')
    if len(issues) > MAX_ISSUES:
        return checker_error('too many issues')
    cleaned = []
    for issue in issues:
        if not isinstance(issue, dict) or set(issue) - {'kind', 'detail'}:
            return checker_error('issue is not an object')
        kind = issue.get('kind')
        detail = issue.get('detail')
        if kind not in MODEL_KINDS or not isinstance(detail, str) or not detail.strip():
            return checker_error('issue kind or detail rejected')
        cleaned.append({'kind': kind, 'detail': detail.strip()[:MAX_DETAIL]})
    if verdict == 'pass' and cleaned:
        return {'verdict': 'flag', 'issues': cleaned}
    if verdict == 'flag' and not cleaned:
        return checker_error('flag without issues')
    return {'verdict': verdict, 'issues': cleaned}


def validate_auto_check(data: dict, known_ids: set[str]) -> dict:
    """Return flagged and checked counts, or raise ValueError."""
    if not isinstance(data, dict):
        raise ValueError('review/auto-check.json must be an object')
    allowed = {'schema_version', 'snapshot_id', 'llm', 'model', 'generated_at', 'notes'}
    if set(data) != allowed:
        raise ValueError('review/auto-check.json fields')
    if data.get('schema_version') != 1:
        raise ValueError('review/auto-check.json schema_version')
    if not isinstance(data.get('snapshot_id'), str) or not data['snapshot_id']:
        raise ValueError('review/auto-check.json snapshot_id')
    if data.get('llm') not in LLM_MODES:
        raise ValueError('review/auto-check.json llm')
    if data.get('model') is not None and not isinstance(data.get('model'), str):
        raise ValueError('review/auto-check.json model')
    if not isinstance(data.get('generated_at'), str) or not data['generated_at']:
        raise ValueError('review/auto-check.json generated_at')
    notes = data.get('notes')
    if not isinstance(notes, list):
        raise ValueError('review/auto-check.json notes')
    if data['llm'] == 'skipped':
        if notes:
            raise ValueError('review/auto-check.json skipped run cannot contain verdicts')
        return {'state': 'skipped', 'flagged': 0, 'checked': 0}
    seen = []
    flagged = 0
    for item in notes:
        if not isinstance(item, dict) or set(item) != {'id', 'verdict', 'issues'}:
            raise ValueError('review/auto-check.json note fields')
        source_id = item['id']
        if source_id not in known_ids:
            raise ValueError('review/auto-check.json unknown id: ' + str(source_id))
        if source_id in seen:
            raise ValueError('review/auto-check.json duplicate id: ' + source_id)
        seen.append(source_id)
        verdict = item['verdict']
        issues = item['issues']
        if verdict not in VERDICTS or not isinstance(issues, list):
            raise ValueError('review/auto-check.json bad verdict: ' + source_id)
        if verdict == 'pass' and issues:
            raise ValueError('review/auto-check.json pass with issues: ' + source_id)
        if verdict == 'flag' and not issues:
            raise ValueError('review/auto-check.json flag without issues: ' + source_id)
        if len(issues) > MAX_ISSUES:
            raise ValueError('review/auto-check.json too many issues: ' + source_id)
        for issue in issues:
            if not isinstance(issue, dict) or set(issue) != {'kind', 'detail'}:
                raise ValueError('review/auto-check.json issue fields: ' + source_id)
            detail = issue['detail']
            if issue['kind'] not in ISSUE_KINDS or not isinstance(detail, str) or not detail.strip() or len(detail) > MAX_DETAIL:
                raise ValueError('review/auto-check.json issue: ' + source_id)
        if verdict == 'flag':
            flagged += 1
    return {'state': 'present', 'flagged': flagged, 'checked': len(seen)}
