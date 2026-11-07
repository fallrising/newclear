"""Pick a reproducible sample of notes whose auto-check verdict is pass.

The sample is the first N ids after ranking ``sha256(seed + id)``. It does not
use ``random``, so the same pass set and seed produce the same ids on every
Python version. N must be from 10 to 20. Flagged and unchecked notes are left out.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'review'))
sys.path.insert(0, str(ROOT / 'sources'))

from schema import validate_auto_check  # noqa: E402
from snapshot import SNAPSHOT_ID  # noqa: E402

DEFAULT_RESULT = ROOT / 'review' / 'auto-check.json'
DEFAULT_SEED = SNAPSHOT_ID
COUNT_MIN = 10
COUNT_MAX = 20


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sample_ids(ids: list[str], seed: str, count: int) -> list[str]:
    require(COUNT_MIN <= count <= COUNT_MAX, f'sample count must be from {COUNT_MIN} to {COUNT_MAX}')
    require(isinstance(seed, str) and seed.strip(), 'sample seed is empty')
    require(len(ids) == len(set(ids)), 'duplicate id')
    require(all(isinstance(item, str) and item for item in ids), 'sample id')
    require(len(ids) >= count, f'not enough passing notes: {len(ids)} < {count}')
    ranked = sorted(ids, key=lambda item: hashlib.sha256(f'{seed}\n{item}'.encode()).hexdigest())
    return ranked[:count]


def passing_ids(result: dict, known_ids: set[str]) -> list[str]:
    facts = validate_auto_check(result, known_ids)
    require(facts['state'] == 'present', 'auto-check has no verdicts to sample')
    require(result.get('snapshot_id') == SNAPSHOT_ID, 'auto-check snapshot_id')
    return [item['id'] for item in result['notes'] if item['verdict'] == 'pass']


def sample_document(ids: list[str], seed: str, count: int) -> dict:
    chosen = sample_ids(ids, seed, count)
    return {'schema_version': 1, 'snapshot_id': SNAPSHOT_ID, 'seed': seed, 'count': count, 'ids': chosen}


def load_result(path: Path, known_ids: set[str]) -> list[str]:
    data = json.loads(path.read_text(encoding='utf-8'))
    return passing_ids(data, known_ids)


def known_note_ids(catalog: Path) -> set[str]:
    return {path.stem for path in (catalog / 'patterns').glob('*.md') if path.name != 'README.md'}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--result', type=Path, default=DEFAULT_RESULT)
    parser.add_argument('--seed', default=DEFAULT_SEED)
    parser.add_argument('--count', type=int, default=15)
    parser.add_argument('--write', type=Path)
    parser.add_argument('--check', type=Path, help='fail when this sample file does not match a fresh draw')
    parser.add_argument('--catalog', type=Path, default=ROOT)
    args = parser.parse_args(argv)
    try:
        known = known_note_ids(args.catalog)
        chosen = sample_document(load_result(args.result, known), args.seed, args.count)
        text = json.dumps(chosen, ensure_ascii=False, indent=2) + '\n'
        if args.check:
            current = args.check.read_text(encoding='utf-8')
            require(current == text, 'sample file does not match this seed, count, and pass set')
            print(f'PASS: sample matches {args.check}')
            return 0
        if args.write:
            args.write.parent.mkdir(parents=True, exist_ok=True)
            args.write.write_text(text, encoding='utf-8')
            print(f'PASS: wrote {args.count} ids to {args.write}')
            return 0
        sys.stdout.write(text)
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.exit(1, f'ERROR: {exc}\n')


if __name__ == '__main__':
    raise SystemExit(main())
