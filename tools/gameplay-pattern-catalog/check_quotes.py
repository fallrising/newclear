#!/usr/bin/env python3
"""Fail unless every note content span is an exact slice of its cited source.

Content sections are quoted spans plus a citation (source file, character
offset, JSON path). A display line, when present, is OpenCC ``s2t`` and nothing
else. Structural metadata — id, title, tags, category, related links, source
URL — is not a quote. The checker does not call a model.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TEXT_DIR = ROOT / 'sources' / 'text'

# Content sections, in order. Each one must quote the named source paths.
# 驗收 and 邊界驗收 are not here: those sentences were written locally.
CONTENT_SECTIONS = (
    '摘要',
    '規則',
    '核心循環',
    '玩家取捨',
    '可調參數',
    '原型',
)
STRUCTURAL_SECTIONS = ('相關模式', '參考來源')
HEADINGS = CONTENT_SECTIONS + STRUCTURAL_SECTIONS

QUOTE_LINE = re.compile(r'^「(.*)」$')
CITE_LINE = re.compile(
    r'^出處：`(sources/text/[a-z0-9]+(?:-[a-z0-9]+)*\.json)` 字元 (\d+)-(\d+) `([A-Za-z]+(?:\[\d+\])?(?:\.[A-Za-z]+(?:\[\d+\])?)*)`$'
)
DISPLAY_PREFIX = '顯示：'
HEADING_LINE = re.compile(r'^## (.+)$', re.M)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def path_key(parts: tuple) -> str:
    out: list[str] = []
    for part in parts:
        if isinstance(part, int):
            require(out, 'JSON array at the root is not a citable path')
            out[-1] = f'{out[-1]}[{part}]'
        else:
            out.append(str(part))
    return '.'.join(out)


def index_strings(text: str) -> dict[str, tuple[int, int]]:
    """Character offsets of every JSON string. Escapes are rejected."""
    spans: dict[str, tuple[int, int]] = {}
    i = 0
    n = len(text)

    def skip() -> None:
        nonlocal i
        while i < n and text[i] in ' \t\r\n':
            i += 1

    def parse_string() -> tuple[int, int]:
        nonlocal i
        require(text[i] == '"', 'JSON string')
        i += 1
        start = i
        while i < n and text[i] != '"':
            require(text[i] != '\\', 'source text contains an escape; refusing to guess the span')
            i += 1
        require(i < n, 'unterminated JSON string')
        end = i
        i += 1
        return start, end

    def parse(parts: tuple) -> None:
        nonlocal i
        skip()
        require(i < n, 'truncated JSON')
        char = text[i]
        if char == '{':
            i += 1
            first = True
            while True:
                skip()
                require(i < n, 'truncated object')
                if text[i] == '}':
                    i += 1
                    return
                if not first:
                    require(text[i] == ',', 'expected comma in object')
                    i += 1
                    skip()
                first = False
                key_start, key_end = parse_string()
                key = text[key_start:key_end]
                skip()
                require(text[i] == ':', 'expected colon')
                i += 1
                parse(parts + (key,))
        elif char == '[':
            i += 1
            index = 0
            first = True
            while True:
                skip()
                require(i < n, 'truncated array')
                if text[i] == ']':
                    i += 1
                    return
                if not first:
                    require(text[i] == ',', 'expected comma in array')
                    i += 1
                    skip()
                first = False
                parse(parts + (index,))
                index += 1
        elif char == '"':
            start, end = parse_string()
            spans[path_key(parts)] = (start, end)
        elif char in '-0123456789':
            while i < n and text[i] in '0123456789eE+-.':
                i += 1
        elif text.startswith('true', i):
            i += 4
        elif text.startswith('false', i):
            i += 5
        elif text.startswith('null', i):
            i += 4
        else:
            raise ValueError('unexpected JSON at ' + str(i))

    parse(())
    skip()
    require(i == n, 'trailing data in source text')
    return spans


def section_paths(data: dict) -> list[tuple[str, list[str]]]:
    """Source paths a note must quote. Empty source strings are omitted, not padded."""
    sections = [
        ('摘要', ['summary.zh']),
        ('規則', ['rules.zh']),
        ('核心循環', [f'loop[{index}].zh' for index in range(len(data['loop']))]),
        ('玩家取捨', [f'decisions[{index}].zh' for index in range(len(data['decisions']))]),
        ('可調參數', [
            path
            for index in range(len(data['parameters']))
            for path in (f'parameters[{index}].name.zh', f'parameters[{index}].effect.zh')
        ]),
        ('原型', ['prototype.firstStep.zh', 'prototype.test.zh', 'prototype.pitfall.zh']),
    ]
    return [(heading, paths) for heading, paths in sections if paths]


def resolve_path(data: dict, path: str):
    current = data
    for token in re.findall(r'[A-Za-z]+|\[\d+\]', path):
        if token.startswith('['):
            current = current[int(token[1:-1])]
        else:
            current = current[token]
    return current


def converter():
    try:
        from opencc import OpenCC
    except ImportError as exc:
        raise ValueError('opencc is required for character-only display checks') from exc
    return OpenCC('s2t')


def catalog_root(note_path: Path) -> Path:
    if note_path.parent.name == 'patterns':
        return note_path.parent.parent
    return ROOT


def split_sections(body: str) -> list[tuple[str, str]]:
    found = HEADING_LINE.findall(body)
    require(found == list(HEADINGS), 'required sections must appear once in contract order; references last')
    parts = re.split(r'^## .+\n', body, flags=re.M)[1:]
    require(len(parts) == len(found), 'section split')
    return list(zip(found, parts))


def parse_quotes(note_id: str, section: str) -> tuple[list[dict], list[str]]:
    errors = []
    quotes = []
    lines = section.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line.strip():
            index += 1
            continue
        match = QUOTE_LINE.match(line)
        if match is None:
            errors.append(f'{note_id}: content line lacks a citation: {line}')
            index += 1
            continue
        if index + 1 >= len(lines) or CITE_LINE.match(lines[index + 1]) is None:
            errors.append(f'{note_id}: missing citation after {line}')
            index += 1
            continue
        cited = CITE_LINE.match(lines[index + 1])
        display = None
        index += 2
        if index < len(lines) and lines[index].startswith(DISPLAY_PREFIX):
            display = lines[index][len(DISPLAY_PREFIX):]
            index += 1
        quotes.append({
            'span': match.group(1),
            'file': cited.group(1),
            'start': int(cited.group(2)),
            'end': int(cited.group(3)),
            'path': cited.group(4),
            'display': display,
        })
    return quotes, errors


def display_of(section: str) -> str:
    """Reader-facing summary: the s2t line when the source span needed one."""
    quotes, _errors = parse_quotes('_', section)
    if not quotes:
        return ''
    item = quotes[0]
    return item['span'] if item['display'] is None else item['display']


def check_note(note_path: Path, meta: dict, body: str, opencc=None) -> list[str]:
    note_id = meta.get('id') or note_path.stem
    errors = []
    try:
        sections = split_sections(body)
    except ValueError as exc:
        return [f'{note_id}: {exc}']
    root = catalog_root(note_path)
    source_file = root / 'sources' / 'text' / f'{note_id}.json'
    if not source_file.is_file():
        return [f'{note_id}: no saved source text at sources/text/{note_id}.json']
    raw = source_file.read_text(encoding='utf-8')
    try:
        data = json.loads(raw)
        spans = index_strings(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        return [f'{note_id}: source text is not citable: {exc}']
    expected = dict(section_paths(data))
    if opencc is None:
        try:
            opencc = converter()
        except ValueError as exc:
            return [f'{note_id}: {exc}']
    for heading, section in sections:
        if heading in STRUCTURAL_SECTIONS:
            for line in section.splitlines():
                if not line.strip():
                    continue
                if heading == '相關模式':
                    if re.fullmatch(r'- \[[^\]\n]+\]\([a-z0-9]+(?:-[a-z0-9]+)*\.md\)', line) is None:
                        errors.append(f'{note_id}: related line is not a structural link: {line}')
                elif line.startswith('- ['):
                    continue
                else:
                    errors.append(f'{note_id}: reference line lacks a source link: {line}')
            continue
        quotes, parse_errors = parse_quotes(note_id, section)
        errors.extend(parse_errors)
        wanted = expected.get(heading, [])
        if not quotes:
            errors.append(f'{note_id}: empty required field: {heading}')
            continue
        if [item['path'] for item in quotes] != wanted:
            errors.append(f'{note_id}: {heading} quotes do not match the source fields')
        for item in quotes:
            if item['file'] != f'sources/text/{note_id}.json':
                errors.append(f'{note_id}: citation points at another file: {item["file"]}')
                continue
            start, end = item['start'], item['end']
            if not (0 <= start <= end <= len(raw)) or raw[start:end] != item['span']:
                errors.append(f'{note_id}: span is not the cited source text at {item["path"]}')
                continue
            located = spans.get(item['path'])
            if located != (start, end):
                errors.append(f'{note_id}: citation offset does not match {item["path"]}')
            try:
                value = resolve_path(data, item['path'])
            except (KeyError, IndexError, TypeError):
                errors.append(f'{note_id}: unknown source path {item["path"]}')
                continue
            if value != item['span']:
                errors.append(f'{note_id}: span does not equal {item["path"]}')
            shown = opencc.convert(item['span'])
            if shown == item['span']:
                if item['display'] is not None:
                    errors.append(f'{note_id}: display line changes nothing at {item["path"]}')
            elif item['display'] != shown:
                errors.append(f'{note_id}: display is not character-only conversion at {item["path"]}')
    summary_quotes = []
    for heading, section in sections:
        if heading == '摘要':
            summary_quotes, _ignored = parse_quotes(note_id, section)
    if summary_quotes and meta.get('summary') != summary_quotes[0]['span']:
        errors.append(f'{note_id}: frontmatter summary is not the cited source span')
    return errors


def check_catalog(catalog: Path = ROOT) -> tuple[list[str], dict]:
    """Return errors and per-section span counts."""
    counts = {heading: 0 for heading in CONTENT_SECTIONS}
    notes = 0
    missing = []
    errors = []
    opencc = None
    for path in sorted((catalog / 'patterns').glob('*.md')):
        if path.name == 'README.md':
            continue
        text = path.read_text(encoding='utf-8')
        if not text.startswith('---\n') or '\n---\n' not in text[4:]:
            errors.append(path.name + ': missing frontmatter')
            continue
        front, body = text[4:].split('\n---\n', 1)
        try:
            meta = json.loads(front)
        except json.JSONDecodeError as exc:
            errors.append(f'{path.name}: {exc}')
            continue
        notes += 1
        source = catalog / 'sources' / 'text' / f'{path.stem}.json'
        if not source.is_file():
            missing.append(path.stem)
        if opencc is None and source.is_file():
            try:
                opencc = converter()
            except ValueError as exc:
                return [str(exc)], {'notes': notes, 'spans': 0, 'by_section': counts, 'missing_source': missing}
        note_errors = check_note(path, meta, body, opencc)
        errors.extend(note_errors)
        if note_errors:
            continue
        for heading, section in split_sections(body):
            if heading in counts:
                quotes, _parse_errors = parse_quotes(path.stem, section)
                counts[heading] += len(quotes)
    stats = {
        'notes': notes,
        'spans': sum(counts.values()),
        'by_section': counts,
        'missing_source': missing,
    }
    return errors, stats


def render_quote(file_rel: str, raw: str, spans: dict[str, tuple[int, int]], path: str, opencc) -> str:
    start, end = spans[path]
    span = raw[start:end]
    lines = [f'「{span}」', f'出處：`{file_rel}` 字元 {start}-{end} `{path}`']
    shown = opencc.convert(span)
    if shown != span:
        lines.append(f'顯示：{shown}')
    return '\n'.join(lines)


def render_body(note_id: str, data: dict, raw: str, spans: dict[str, tuple[int, int]], titles: dict[str, str], related: list[str], footer: str, opencc) -> str:
    file_rel = f'sources/text/{note_id}.json'
    blocks = []
    for heading, paths in section_paths(data):
        quotes = [render_quote(file_rel, raw, spans, path, opencc) for path in paths]
        blocks.append(f'## {heading}\n\n' + '\n\n'.join(quotes))
    links = '\n'.join(f'- [{titles[item]}]({item}.md)' for item in related)
    blocks.append('## 相關模式\n\n' + links)
    blocks.append('## 參考來源\n\n' + footer.strip('\n'))
    return '\n\n'.join(blocks) + '\n'


def migrate(catalog: Path = ROOT) -> dict:
    """Rewrite note bodies from source spans. Titles, tags, and URLs stay."""
    opencc = converter()
    titles = {}
    notes = []
    for path in sorted((catalog / 'patterns').glob('*.md')):
        if path.name == 'README.md':
            continue
        text = path.read_text(encoding='utf-8')
        front, body = text[4:].split('\n---\n', 1)
        meta = json.loads(front)
        titles[meta['id']] = meta['title']
        notes.append((path, meta, body))
    for path, meta, body in notes:
        source = catalog / 'sources' / 'text' / f'{meta["id"]}.json'
        raw = source.read_text(encoding='utf-8')
        data = json.loads(raw)
        spans = index_strings(raw)
        meta['summary'] = raw[spans['summary.zh'][0]:spans['summary.zh'][1]]
        meta['note_status'] = 'draft'
        footer = body.split('## 參考來源\n', 1)[1]
        rendered = render_body(meta['id'], data, raw, spans, titles, meta['related'], footer, opencc)
        path.write_text('---\n' + json.dumps(meta, ensure_ascii=False, indent=2) + '\n---\n\n' + rendered, encoding='utf-8')
    errors, stats = check_catalog(catalog)
    if errors:
        raise SystemExit('migration failed quote check:\n' + '\n'.join(errors[:20]))
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--write-notes', action='store_true', help='rewrite notes from source spans')
    args = parser.parse_args()
    try:
        if args.write_notes:
            stats = migrate()
        else:
            errors, stats = check_catalog()
            if errors:
                raise SystemExit('ERROR:\n' + '\n'.join(errors[:30]))
        print(
            f"PASS: {stats['notes']} notes, {stats['spans']} spans, "
            f"missing source text: {len(stats['missing_source'])}"
        )
        for heading, count in stats['by_section'].items():
            print(f'  {heading}: {count}')
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.exit(1, f'ERROR: {exc}\n')


if __name__ == '__main__':
    main()
