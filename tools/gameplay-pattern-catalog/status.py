"""Generate and check catalog counts from the note files.

``source_commit`` is the git tree SHA of ``patterns/*.md`` excluding README.
It is computed from the file bytes, so a squash merge does not change it and a
commit that only rewrites this status does not chase its own hash. The same
value is written to SUCCESS.md, the catalog row in
``docs/project-success/inventory.json``, and ``review/pr-snippet.md``.

``quote_check`` comes from ``check_quotes.py``. ``review/auto-check.json`` is
not read.

``--check`` fails when those copies disagree with a fresh computation.
``--check-pr-body`` also fails when a pull request changes this catalog, or
the catalog inventory row, and the description omits the snippet.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'sources'))

import check_quotes  # noqa: E402
from snapshot import SNAPSHOT_ID  # noqa: E402

BEGIN = '<!-- catalog-status:start -->'
END = '<!-- catalog-status:end -->'
NOTE_STATUS = ('pending', 'draft', 'reviewed')
FIELDS = (
    'total', 'draft', 'reviewed', 'pending',
    'quoted_spans', 'quote_check', 'source_commit', 'snapshot_id',
)
CATALOG_PREFIX = 'tools/gameplay-pattern-catalog/'
INVENTORY_PATH = 'docs/project-success/inventory.json'
INVENTORY_RE = re.compile(
    r'("path": "tools/gameplay-pattern-catalog",\n\s+"last_source_update": "[^"]+",\n\s+"source_commit": ")[0-9a-f]{40}(")'
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def repo_root(catalog: Path) -> Path:
    return catalog.resolve().parents[1]


def git_blob_sha1(data: bytes) -> bytes:
    prefix = f'blob {len(data)}\0'.encode()
    return hashlib.sha1(prefix + data).digest()


def notes_tree_sha(catalog: Path) -> str:
    entries = []
    for path in sorted((catalog / 'patterns').glob('*.md')):
        if path.name == 'README.md':
            continue
        entries.append((path.name, path.read_bytes()))
    payload = b''.join(f'100644 {name}\0'.encode() + git_blob_sha1(data) for name, data in entries)
    prefix = f'tree {len(payload)}\0'.encode()
    return hashlib.sha1(prefix + payload).hexdigest()


def note_rows(catalog: Path) -> list[tuple[str, str]]:
    rows = []
    for path in sorted((catalog / 'patterns').glob('*.md')):
        if path.name == 'README.md':
            continue
        text = path.read_text(encoding='utf-8')
        require(text.startswith('---\n') and '\n---\n' in text[4:], path.name + ': missing frontmatter')
        meta = json.loads(text[4:].split('\n---\n', 1)[0])
        require(isinstance(meta, dict) and meta.get('id') == path.stem, path.name + ': id')
        status = meta.get('note_status')
        require(status in NOTE_STATUS, path.name + ': note_status')
        rows.append((path.stem, status))
    require(rows, 'no pattern notes')
    return rows


def compute(catalog: Path) -> dict:
    rows = note_rows(catalog)
    counts = {status: sum(status == item for _source_id, item in rows) for status in NOTE_STATUS}
    require(sum(counts.values()) == len(rows), 'note status counts')
    text_dir = catalog / 'sources' / 'text'
    if text_dir.is_dir():
        errors, stats = check_quotes.check_catalog(catalog)
        require(not errors, 'quote check failed: ' + (errors[0] if errors else ''))
        quote = {'quoted_spans': stats['spans'], 'quote_check': 'pass'}
    else:
        quote = {'quoted_spans': 0, 'quote_check': 'absent'}
    return {
        'total': len(rows),
        'draft': counts['draft'],
        'reviewed': counts['reviewed'],
        'pending': counts['pending'],
        'quoted_spans': quote['quoted_spans'],
        'quote_check': quote['quote_check'],
        'source_commit': notes_tree_sha(catalog),
        'snapshot_id': SNAPSHOT_ID,
    }


def render_block(facts: dict) -> str:
    lines = [
        BEGIN,
        '## 由筆記產生的狀態',
        '',
        '此段由 `python3 status.py --write` 從 `patterns/*.md` 產生。手改會讓檢查失敗。',
        '',
    ]
    lines.extend(f'{key}: {facts[key]}' for key in FIELDS)
    lines.extend([
        '',
        '`source_commit` 是筆記檔的 git tree SHA（不含 `patterns/README.md`），由檔案位元組算出，不是分支 commit。',
        '`quote_check` 是確定性引文檢查。`pass` 表示每個內容片段都等於所引來源的那個位置。它不是 note_status。',
        END,
        '',
    ])
    return '\n'.join(lines)


def render_snippet(facts: dict) -> str:
    lines = [
        '## Catalog status (generated)',
        '',
        'Computed from the pattern notes. Do not edit by hand.',
        f"catalog-status-snippet: {facts['snapshot_id']}",
    ]
    lines.extend(f'- {key}: {facts[key]}' if key != 'source_commit' else f'- source_commit: `{facts[key]}`' for key in FIELDS)
    lines.extend([
        '',
        '`source_commit` is the git tree SHA of the note files, not a branch tip.',
        '`quote_check` is the deterministic span check. `pass` means every content span matches its citation. It is not a note status.',
        '',
    ])
    return '\n'.join(lines)


def extract_block(text: str) -> str:
    start = text.find(BEGIN)
    end = text.find(END)
    require(start != -1 and end > start, 'SUCCESS.md is missing the generated status block')
    require(text.find(BEGIN, start + len(BEGIN)) == -1, 'SUCCESS.md has more than one status block')
    end += len(END)
    if text[end:end + 1] == '\n':
        end += 1
    return text[start:end]


def frontmatter_value(text: str, key: str) -> str:
    require(text.startswith('---\n'), 'SUCCESS.md missing frontmatter')
    end = text.find('\n---\n', 4)
    require(end != -1, 'SUCCESS.md missing frontmatter')
    values = [line.split(':', 1)[1].strip() for line in text[4:end].splitlines() if line.startswith(key + ':')]
    require(len(values) == 1 and values[0], 'SUCCESS.md ' + key)
    return values[0]


def set_frontmatter(text: str, key: str, value: str) -> str:
    require(text.startswith('---\n'), 'SUCCESS.md missing frontmatter')
    end = text.find('\n---\n', 4)
    require(end != -1, 'SUCCESS.md missing frontmatter')
    lines = []
    found = False
    for line in text[4:end].splitlines():
        if line.startswith(key + ':'):
            require(not found, 'duplicate ' + key)
            lines.append(f'{key}: {value}')
            found = True
        else:
            lines.append(line)
    require(found, 'SUCCESS.md missing ' + key)
    return '---\n' + '\n'.join(lines) + '\n---\n' + text[end + 5:]


def upsert_block(text: str, block: str) -> str:
    if BEGIN not in text:
        heading = '# Gameplay Pattern Catalog — 驗收入口\n'
        require(heading in text, 'SUCCESS.md heading')
        return text.replace(heading, heading + '\n' + block, 1)
    start = text.find(BEGIN)
    end = text.find(END)
    require(end > start, 'SUCCESS.md status block is not closed')
    end += len(END)
    if text[end:end + 1] == '\n':
        end += 1
    return text[:start] + block + text[end:]


def inventory_text(catalog: Path) -> str:
    path = repo_root(catalog) / INVENTORY_PATH
    require(path.is_file(), 'inventory.json missing')
    return path.read_text(encoding='utf-8')


def inventory_commit(text: str) -> str:
    data = json.loads(text)
    rows = [item for item in data.get('projects', []) if item.get('path') == 'tools/gameplay-pattern-catalog']
    require(len(rows) == 1, 'inventory catalog row')
    commit = rows[0].get('source_commit')
    require(isinstance(commit, str) and re.fullmatch(r'[0-9a-f]{40}', commit), 'inventory catalog source_commit')
    return commit


def write_inventory_commit(catalog: Path, commit: str) -> None:
    path = repo_root(catalog) / INVENTORY_PATH
    text = path.read_text(encoding='utf-8')
    updated, count = INVENTORY_RE.subn(rf'\g<1>{commit}\2', text, count=1)
    require(count == 1, 'inventory catalog source_commit was not updated')
    path.write_text(updated, encoding='utf-8')


def check(catalog: Path) -> list[str]:
    try:
        facts = compute(catalog)
        success = (catalog / 'SUCCESS.md').read_text(encoding='utf-8')
        snippet = (catalog / 'review' / 'pr-snippet.md').read_text(encoding='utf-8')
        recorded = frontmatter_value(success, 'source_commit')
        block = extract_block(success)
        inventoried = inventory_commit(inventory_text(catalog))
    except (OSError, ValueError, json.JSONDecodeError, IndexError) as exc:
        return [str(exc)]
    errors = []
    if recorded != facts['source_commit']:
        errors.append('SUCCESS.md source_commit does not match the notes tree')
    if block != render_block(facts):
        errors.append('SUCCESS.md generated status block does not match the notes')
    if inventoried != facts['source_commit']:
        errors.append('inventory.json catalog source_commit does not match the notes tree')
    if snippet != render_snippet(facts):
        errors.append('review/pr-snippet.md does not match the notes')
    return errors


def write(catalog: Path) -> dict:
    facts = compute(catalog)
    success_path = catalog / 'SUCCESS.md'
    text = upsert_block(set_frontmatter(success_path.read_text(encoding='utf-8'), 'source_commit', facts['source_commit']), render_block(facts))
    success_path.write_text(text, encoding='utf-8')
    write_inventory_commit(catalog, facts['source_commit'])
    snippet_path = catalog / 'review' / 'pr-snippet.md'
    snippet_path.parent.mkdir(parents=True, exist_ok=True)
    snippet_path.write_text(render_snippet(facts), encoding='utf-8')
    return facts


def needs_snippet(changed: list[str], base_inventory: str | None, head_inventory: str) -> bool:
    if any(path.startswith(CATALOG_PREFIX) for path in changed):
        return True
    if INVENTORY_PATH not in changed:
        return False
    require(base_inventory is not None, 'inventory diff is missing the base file')
    return inventory_commit(base_inventory) != inventory_commit(head_inventory)


def pr_body_errors(body: str, snippet: str, relevant: bool) -> list[str]:
    if not relevant:
        return []
    if snippet.strip() not in (body or ''):
        return ['PR description is missing the generated catalog status snippet']
    return []


def git_text(repo: Path, *args: str) -> str:
    completed = subprocess.run(['git', '-C', str(repo), *args], check=False, capture_output=True)
    require(completed.returncode == 0, 'could not read the PR diff from git')
    return completed.stdout.decode('utf-8')


def check_pr_body(catalog: Path, body: str, base: str) -> list[str]:
    errors = check(catalog)
    repo = repo_root(catalog)
    try:
        changed = [line for line in git_text(repo, 'diff', '--name-only', base, 'HEAD').splitlines() if line]
        base_inventory = git_text(repo, 'show', f'{base}:{INVENTORY_PATH}') if INVENTORY_PATH in changed else None
        facts = compute(catalog)
        relevant = needs_snippet(changed, base_inventory, inventory_text(catalog))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return errors + [str(exc)]
    return errors + pr_body_errors(body, render_snippet(facts), relevant)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--check-pr-body', action='store_true')
    parser.add_argument('--base', default='origin/main')
    parser.add_argument('--body-file', type=Path)
    parser.add_argument('--catalog', type=Path, default=ROOT)
    parser.add_argument('--snippet', action='store_true', help='print the PR snippet')
    args = parser.parse_args(argv)
    try:
        if args.write:
            facts = write(args.catalog)
            print(f"PASS: wrote status for {facts['total']} notes, source_commit {facts['source_commit']}")
        if args.snippet:
            sys.stdout.write(render_snippet(compute(args.catalog)))
        if args.check_pr_body:
            if args.body_file:
                body = args.body_file.read_text(encoding='utf-8')
            else:
                body = os.environ.get('PR_BODY') or ''
            errors = check_pr_body(args.catalog, body, args.base)
        elif args.check or args.write:
            errors = check(args.catalog)
        elif args.snippet:
            return 0
        else:
            parser.error('choose --check, --write, --snippet, or --check-pr-body')
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.exit(1, f'ERROR: {exc}\n')
    for error in errors:
        print('ERROR:', error)
    if errors:
        return 1
    if args.check or args.check_pr_body:
        print('PASS: catalog status matches the notes')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
