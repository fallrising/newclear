"""Promote a human-reviewed batch of notes to note_status reviewed.

Dry-run is the default. ``--apply`` rewrites frontmatter for the batch only.
A note is eligible when auto-check says pass. Flagged, unchecked, unknown, and
duplicate ids refuse the whole batch. More than 20 ids is refused: that is the
upper bound of one human sample. Pass ``--sample`` to require every id to be in
that draw. This does not edit SUCCESS.md and does not mark the catalog complete.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'review'))
sys.path.insert(0, str(ROOT / 'sources'))

from schema import validate_auto_check  # noqa: E402
from snapshot import SNAPSHOT_ID  # noqa: E402

DEFAULT_RESULT = ROOT / 'review' / 'auto-check.json'
MAX_BATCH = 20


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def note_path(catalog: Path, source_id: str) -> Path:
    return catalog / 'patterns' / f'{source_id}.md'


def split_note(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding='utf-8')
    require(text.startswith('---\n') and '\n---\n' in text[4:], path.name + ': missing frontmatter')
    front, body = text[4:].split('\n---\n', 1)
    meta = json.loads(front)
    require(isinstance(meta, dict) and meta.get('id') == path.stem, path.name + ': id')
    return meta, body


def dump_note(meta: dict, body: str) -> str:
    return '---\n' + json.dumps(meta, ensure_ascii=False, indent=2) + '\n---\n' + body


def parse_reviewed_at(value: str) -> None:
    require(isinstance(value, str) and value.endswith('Z') and 'T' in value, 'reviewed_at must be UTC YYYY-MM-DDTHH:MM:SSZ')
    try:
        parsed = dt.datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ')
    except ValueError as exc:
        raise ValueError('reviewed_at must be UTC YYYY-MM-DDTHH:MM:SSZ') from exc
    require(parsed.strftime('%Y-%m-%dT%H:%M:%SZ') == value, 'reviewed_at must be UTC YYYY-MM-DDTHH:MM:SSZ')


def load_batch(path: Path) -> dict:
    data = json.loads(path.read_text(encoding='utf-8'))
    require(isinstance(data, dict), 'batch must be an object')
    require(set(data) <= {'schema_version', 'reviewed_at', 'ids', 'seed'}, 'batch fields')
    require(data.get('schema_version') == 1, 'batch schema_version')
    parse_reviewed_at(data.get('reviewed_at'))
    ids = data.get('ids')
    require(isinstance(ids, list) and ids, 'batch ids')
    require(len(ids) == len(set(ids)), 'duplicate batch id')
    require(len(ids) <= MAX_BATCH, f'batch has more than {MAX_BATCH} ids')
    require(all(isinstance(item, str) and item for item in ids), 'batch id')
    return data


def passing(result_path: Path, known_ids: set[str]) -> set[str]:
    data = json.loads(result_path.read_text(encoding='utf-8'))
    facts = validate_auto_check(data, known_ids)
    require(facts['state'] == 'present', 'auto-check has no verdicts')
    require(data.get('snapshot_id') == SNAPSHOT_ID, 'auto-check snapshot_id')
    return {item['id'] for item in data['notes'] if item['verdict'] == 'pass'}


def plan(catalog: Path, batch: dict, passed: set[str], sample_ids: set[str] | None) -> list[Path]:
    paths = []
    for source_id in batch['ids']:
        path = note_path(catalog, source_id)
        require(path.is_file(), 'missing note: ' + source_id)
        require(source_id in passed, 'refusing id that is not an auto-check pass: ' + source_id)
        if sample_ids is not None:
            require(source_id in sample_ids, 'refusing id outside the sample: ' + source_id)
        meta, _body = split_note(path)
        require(meta.get('note_status') in {'draft', 'pending', 'reviewed'}, 'refusing note_status: ' + source_id)
        paths.append(path)
    return paths


def apply_path(path: Path) -> bool:
    meta, body = split_note(path)
    if meta.get('note_status') == 'reviewed':
        return False
    meta['note_status'] = 'reviewed'
    path.write_text(dump_note(meta, body), encoding='utf-8')
    return True


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--batch', type=Path, required=True)
    parser.add_argument('--result', type=Path, default=DEFAULT_RESULT)
    parser.add_argument('--sample', type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--catalog', type=Path, default=ROOT)
    args = parser.parse_args(argv)
    try:
        batch = load_batch(args.batch)
        known = {path.stem for path in (args.catalog / 'patterns').glob('*.md') if path.name != 'README.md'}
        passed = passing(args.result, known)
        sample_ids = None
        if args.sample:
            sample = json.loads(args.sample.read_text(encoding='utf-8'))
            require(isinstance(sample, dict) and isinstance(sample.get('ids'), list), 'sample ids')
            sample_ids = set(sample['ids'])
        paths = plan(args.catalog, batch, passed, sample_ids)
        if not args.apply:
            print('DRY-RUN: would set reviewed on ' + ', '.join(path.stem for path in paths))
            print('Re-run with --apply to write. Then python3 status.py --write and python3 build.py --write-docs.')
            return 0
        changed = [path.stem for path in paths if apply_path(path)]
        print('PASS: reviewed ' + (', '.join(changed) if changed else '(already reviewed)'))
        print('Next: python3 status.py --write && python3 build.py --write-docs && python3 build.py --check')
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.exit(1, f'ERROR: {exc}\n')


if __name__ == '__main__':
    raise SystemExit(main())
