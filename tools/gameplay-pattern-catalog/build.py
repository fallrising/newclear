#!/usr/bin/env python3
"""Validate snapshot-backed Markdown notes and build a dependency-free static catalog."""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'sources'))
from snapshot import SNAPSHOT_ID, load_manifest

CATEGORIES = {
    'farming': '種植與照料', 'fishing': '釣魚與時機', 'cooking': '配方與製作',
    'gathering': '採集與工具', 'automation': '自動化與物流', 'building': '建造與支撐',
    'inventory': '背包與配置', 'puzzles': '解謎與位置', 'combat': '戰鬥與資源',
    'exploration': '探索與能力', 'relationships': '關係與分配',
    'allocation': '選取與保留', 'commerce': '交易與資訊', 'deckbuilding': '牌組構築',
    'progression': '成長與繼承', 'survival': '生存需求', 'stealth': '潛行與身分',
    'defense': '防守波次', 'cooperation': '合作與博弈', 'ecology': '繁育與生態',
    'matching': '消除與合併', 'projectiles': '瞄準與投射', 'movement': '移動與穿越',
    'command': '單位調度', 'narrative': '對話與事件', 'incremental': '收益與累積',
    'rhythm': '節拍與時序', 'driving': '載具操控',
}
NOTE_STATUS = {'pending': '待寫', 'draft': '草稿', 'reviewed': '已對照來源'}
HEADINGS = (
    '來源摘要', '問題與情境（本地分析）', '核心循環（本地分析）',
    '解法與取捨（本地分析）', '可調參數（本地分析）', '失敗模式（本地分析）',
    '最小原型與驗收（本地提案）', '相關模式', '參考來源',
)
FIELDS = {
    'schema_version', 'id', 'title', 'title_en', 'category', 'source_category',
    'tags', 'summary', 'note_status', 'related', 'sources',
}
SOURCE_FIELDS = {'title', 'url', 'accessed', 'access_method'}
SLUG = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*\Z')
LINK = re.compile(r'\[([^\]\n]+)\]\(([^\s)]+)\)')
TOKEN = re.compile(r'\[([^\]\n]+)\]\(([^\s)]+)\)|`([^`\n]+)`')
PLACEHOLDERS = ('TODO', 'TBD', 'FIXME', '占位', 'lorem')
_FULLWIDTH_DIGITS = str.maketrans('０１２３４５６７８９', '0123456789')
_PROTOTYPE_BULLETS = ('- 最小範圍：', '- 驗收：', '- 邊界驗收：')
# Two notes may phrase one edge the same way. Three or more copies of a
# 驗收 or 邊界驗收 sentence is the fixed template this check exists to stop.
MAX_SHARED_CHECK = 2


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def prototype_check_text(section: str, label: str) -> str:
    prefix = f'- {label}：'
    matches = [line[len(prefix):].strip() for line in section.splitlines() if line.startswith(prefix)]
    require(len(matches) == 1, f'prototype needs exactly one {label}')
    require(matches[0] != '', f'empty {label}')
    return matches[0]


def shared_check_overflow(notes: list[dict]) -> str | None:
    """Return an error when one 驗收 or 邊界驗收 sentence is used too widely."""
    proto_index = HEADINGS.index('最小原型與驗收（本地提案）')
    for label in ('驗收', '邊界驗收'):
        counts: dict[str, int] = {}
        for note in notes:
            text = prototype_check_text(note['sections'][proto_index], label)
            counts[text] = counts.get(text, 0) + 1
        worst = max(counts.values(), default=0)
        if worst > MAX_SHARED_CHECK:
            return f'{label} repeated {worst} times; more than {MAX_SHARED_CHECK} notes sharing one sentence is boilerplate'
    return None


def invented_prototype_number(note_id: str, section: str, catalog: Path) -> str | None:
    """A prototype number is allowed only when that digit run is in the note's source snapshot."""
    tokens = re.findall(r'[0-9０-９]+', section)
    if not tokens:
        return None
    source_path = catalog / 'sources' / 'text' / f'{note_id}.json'
    source = source_path.read_text(encoding='utf-8') if source_path.is_file() else ''
    for token in tokens:
        ascii_token = token.translate(_FULLWIDTH_DIGITS)
        if ascii_token not in source and token not in source:
            return ascii_token
    return None


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f'duplicate JSON key: {key}')
        result[key] = value
    return result


def read_json(text: str):
    return json.loads(text, object_pairs_hook=no_duplicates)


def valid_url(url: str) -> bool:
    if not isinstance(url, str) or re.search(r'[\s<>"\x00-\x1f\\]', url):
        return False
    try:
        parts = urlsplit(url)
        return bool(parts.scheme == 'https' and parts.hostname and '.' in parts.hostname
                    and not parts.username and not parts.password and not parts.port
                    and not parts.query and not parts.fragment)
    except ValueError:
        return False


def valid_date(value: str) -> bool:
    try:
        return isinstance(value, str) and dt.date.fromisoformat(value).isoformat() == value
    except (ValueError, TypeError):
        return False


def parse_note(path: Path):
    text = path.read_text(encoding='utf-8')
    require(text.startswith('---\n') and '\n---\n' in text[4:], f'{path.name}: missing JSON frontmatter')
    front, body = text[4:].split('\n---\n', 1)
    meta = read_json(front)
    require(isinstance(meta, dict) and set(meta) == FIELDS, f'{path.name}: unexpected metadata fields')
    require(type(meta['schema_version']) is int and meta['schema_version'] == 2, 'schema_version must be 2')
    for key, limit in [('id', 100), ('title', 100), ('title_en', 120), ('summary', 240)]:
        require(isinstance(meta[key], str) and 0 < len(meta[key].strip()) <= limit, f'invalid {key}')
    require(SLUG.fullmatch(meta['id']) is not None and path.stem == meta['id'], 'ID must equal filename stem')
    require(isinstance(meta['category'], str) and meta['category'] in CATEGORIES, 'unknown category')
    require(meta['source_category'] in CATEGORIES, 'unknown source category')
    require(meta['note_status'] in NOTE_STATUS, 'invalid note_status')
    for key, lower, upper in [('tags', 1, 8), ('related', 0, 6)]:
        values = meta[key]
        require(isinstance(values, list) and lower <= len(values) <= upper, f'invalid {key}')
        require(all(isinstance(value, str) and SLUG.fullmatch(value) for value in values), f'invalid {key} slug')
        require(len(set(values)) == len(values), f'duplicate {key}')
    require(meta['id'] not in meta['related'], 'self relation')
    require(isinstance(meta['sources'], list) and 1 <= len(meta['sources']) <= 5, 'sources required')
    for source in meta['sources']:
        require(isinstance(source, dict) and set(source) == SOURCE_FIELDS, 'invalid source fields')
        require(isinstance(source['title'], str) and 0 < len(source['title'].strip()) <= 200, 'invalid source title')
        require(valid_url(source['url']), 'source URL must be canonical HTTPS without credentials/query/fragment')
        require(valid_date(source['accessed']), 'invalid source accessed date')
        require(source['access_method'] in ('page-text', 'search-index-excerpt'), 'invalid access_method')
    urls = [source['url'] for source in meta['sources']]
    require(len(set(urls)) == len(urls), 'duplicate source URL')
    found = re.findall(r'^## (.+)$', body, re.M)
    require(found == list(HEADINGS), 'required sections must appear once in contract order; references last')
    sections = re.split(r'^## .+\n', body, flags=re.M)[1:]
    require(all(section.strip() for section in sections), 'empty note section')
    footer = body.split('## 參考來源\n', 1)[1]
    require(LINK.findall(footer) == [(source['title'], source['url']) for source in meta['sources']], 'reference footer must match metadata sources')
    require(all(len(section.strip()) >= 40 for section in sections), 'note section is not substantive')
    prototype = sections[HEADINGS.index('最小原型與驗收（本地提案）')]
    require('尚未實玩驗證' in prototype, 'prototype must stay unverified')
    require(all(bullet in prototype for bullet in _PROTOTYPE_BULLETS), 'prototype needs a short scope, check, and boundary')
    invented = invented_prototype_number(meta['id'], prototype, path.parents[1])
    require(invented is None, 'invented prototype number: ' + (invented or ''))
    for token in PLACEHOLDERS:
        require(token not in body, 'placeholder content')
    if meta['note_status'] == 'reviewed':
        require(all(source['access_method'] == 'page-text' for source in meta['sources']), 'reviewed requires page-text')
        require('玩家行動' in body and '系統回饋' in body and '下一個決策' in body, 'reviewed note needs an explicit loop')
        require('尚未實玩驗證' in body, 'reviewed prototype must stay unverified')
        require('本地分析' in body and '本地提案' in body, 'analysis must stay labeled')
    for _label, target in LINK.findall(body):
        require(target in urls or target in [f'{item}.md' for item in meta['related']], 'unregistered note link: ' + target)
    related_section = body.split('## 相關模式\n', 1)[1].split('## 參考來源\n', 1)[0]
    related_lines = [line for line in related_section.splitlines() if line.startswith('- ')]
    require([target for _label, target in LINK.findall(related_section)] == [f'{item}.md' for item in meta['related']], 'related section must match related IDs')
    for line in related_lines:
        reason = line.split(')', 1)[-1]
        require('：' in reason and len(reason.split('：', 1)[1].strip()) >= 12, 'related pattern needs a reason')
    return {'meta': meta, 'body': body.strip(), 'sections': sections}


def gap_rows(manifest: dict, notes: list[dict]):
    by_note = {note['meta']['id']: note for note in notes}
    rows = []
    for entry in manifest['entries']:
        reasons = []
        if entry['fetch_status'] != 'fetched':
            reasons.append(entry['fetch_status'])
        note = by_note.get(entry['source_id'])
        if note is None:
            reasons.append('missing-note')
        elif note['meta']['note_status'] != 'reviewed':
            reasons.append(note['meta']['note_status'])
        if reasons:
            rows.append({'id': entry['source_id'], 'reasons': reasons})
    extra = sorted(set(by_note) - {entry['source_id'] for entry in manifest['entries']})
    return rows, extra


def coverage_facts(site: dict, manifest: dict, notes: list[dict]):
    rows, extra = gap_rows(manifest, notes)
    counts = {status: sum(note['meta']['note_status'] == status for note in notes) for status in NOTE_STATUS}
    fetched = sum(entry['fetch_status'] == 'fetched' for entry in manifest['entries'])
    blocked = [entry['source_id'] for entry in manifest['entries'] if entry['fetch_status'] == 'blocked']
    return {
        'snapshot_id': manifest['snapshot_id'],
        'observed_at': manifest['observed_at'],
        'denominator': len(manifest['entries']),
        'groups': manifest['reconciliation']['enumerated_groups'],
        'fetched': fetched,
        'blocked': blocked,
        'notes': len(notes),
        'note_status': counts,
        'reviewed': counts['reviewed'],
        'gaps': rows,
        'extra_notes': extra,
        'claim': site['coverage']['claim'],
        'boundary': site['verification_boundary'],
        'homepage': manifest['reconciliation']['homepage_reported'],
        'differences': manifest['reconciliation']['differences'],
        'categories': manifest['categories'],
        'entries': [
            {
                'id': entry['source_id'],
                'fetch_status': entry['fetch_status'],
                'note_status': next((note['meta']['note_status'] for note in notes if note['meta']['id'] == entry['source_id']), 'missing'),
                'hash12': (entry.get('content_sha256') or '')[:12],
                'source_category': entry['source_category'],
            }
            for entry in manifest['entries']
        ],
    }


def coverage_markdown(facts: dict) -> str:
    gap_ids = [row['id'] + ' (' + ', '.join(row['reasons']) + ')' for row in facts['gaps']]
    gap_text = '無' if not gap_ids and not facts['extra_notes'] else '\n'.join(f'- {item}' for item in gap_ids + [f'extra:{item}' for item in facts['extra_notes']])
    differences = '\n'.join(f"- `{item['kind']}` {item['id']}：{item['summary']}" for item in facts['differences'])
    categories = '\n'.join(f"| {item['id']} | {item['name_en']} | {item['count']} |" for item in facts['categories'])
    rows = '\n'.join(
        f"| {item['id']} | {item['source_category']} | {item['fetch_status']} | {item['note_status']} | {item['hash12']} |"
        for item in facts['entries']
    )
    return f'''# 完整度報表

快照 `{facts['snapshot_id']}`，觀察時間 `{facts['observed_at']}`。分母是來源 manifest 的 {facts['denominator']} 個條目，不是筆記篇數回推。原站分類 {facts['groups']} 個。

| 項目 | 數量 |
| --- | --- |
| 來源條目（分母） | {facts['denominator']} |
| 已取得 fetched | {facts['fetched']} |
| 筆記 reviewed（計入完成） | {facts['note_status']['reviewed']} |
| 筆記 draft | {facts['note_status']['draft']} |
| 筆記 pending | {facts['note_status']['pending']} |
| blocked | {len(facts['blocked'])} |
| 缺漏 | {len(facts['gaps']) + len(facts['extra_notes'])} |

宣告：`{facts['claim']}`。`reviewed` 只表示作者已對照本次快照的公開頁面與內嵌條目，不是獨立審查，也不是實玩驗證。pending、draft、blocked 與模板占位不計入完成。

內容邊界：{facts['boundary']}

## 缺漏 ID

{gap_text}

## 入口差異

首頁觀察為 {facts['homepage']['mechanics']} 個機制、{facts['homepage']['groups']} 個分類。{facts['homepage']['evidence']}

{differences}

## 原站分類數量

| ID | 觀察到的英文名 | 條目 |
| --- | --- | --- |
{categories}

## 逐條狀態

完整雜湊在 `sources/manifest.json`。下表只留前 12 碼，避免把雜湊手抄成第二份權威資料。

| 來源 ID | 原站分類 | 取得 | 筆記 | 雜湊前綴 |
| --- | --- | --- | --- | --- |
{rows}
'''


def pattern_index(notes: list[dict], manifest: dict) -> str:
    by_source = {entry['source_id']: entry for entry in manifest['entries']}
    lines = [
        '# Pattern 筆記索引',
        '',
        f"來源快照 `{SNAPSHOT_ID}` 的分母是 {len(manifest['entries'])} 個機制。本表列的是本地筆記，不能用來反推來源是否完整。",
        '',
        '| Pattern | 本地分類 | 原站分類 | 筆記狀態 | 主要問題 |',
        '| --- | --- | --- | --- | --- |',
    ]
    for note in notes:
        meta = note['meta']
        source = by_source[meta['id']]['source_category']
        lines.append(f"| [{meta['title']}]({meta['id']}.md) | {CATEGORIES[meta['category']]} | {source} | {NOTE_STATUS[meta['note_status']]} | {meta['summary']} |")
    lines.append('')
    lines.append('欄位與維護方式見 [Metadata 指引](../METADATA.md)。來源對帳見 [完整度報表](../docs/coverage.md)。')
    lines.append('')
    return '\n'.join(lines)


def load_catalog(root: Path = ROOT):
    site = read_json((root / 'site.json').read_text(encoding='utf-8'))
    require(site.get('schema_version') == 2, 'invalid site schema')
    require(valid_url(site.get('url')), 'invalid site URL')
    require(valid_date(site.get('accessed')), 'invalid site date')
    coverage = site.get('coverage') or {}
    require(coverage.get('basis') == 'source-snapshot', 'coverage must name the snapshot basis')
    require(coverage.get('snapshot_id') == SNAPSHOT_ID, 'site snapshot id drift')
    require(coverage.get('claim') in ('complete', 'partial'), 'coverage claim')
    require(coverage.get('denominator') == 'sources/manifest.json', 'denominator must be the manifest')
    manifest = load_manifest(root / 'sources' / 'manifest.json')
    homepage = site.get('homepage_observation') or {}
    reported = manifest['reconciliation']['homepage_reported']
    require(homepage.get('mechanics') == reported['mechanics'] and homepage.get('groups') == reported['groups'], 'homepage observation drift')
    notes = [parse_note(path) for path in sorted((root / 'patterns').glob('*.md')) if path.name != 'README.md']
    ids = [note['meta']['id'] for note in notes]
    require(bool(ids) and len(set(ids)) == len(ids), 'empty catalog or duplicate ID')
    require(len({note['meta']['summary'] for note in notes}) == len(notes), 'duplicate summary')
    require(len({note['sections'][0] for note in notes}) == len(notes), 'duplicate source summary')
    overflow = shared_check_overflow(notes)
    require(overflow is None, overflow or '')
    by_source = {entry['source_id']: entry for entry in manifest['entries']}
    missing_notes = sorted(set(by_source) - set(ids))
    extra_notes = sorted(set(ids) - set(by_source))
    require(not missing_notes and not extra_notes, 'note set drifted from source manifest: ' + ', '.join(missing_notes + extra_notes))
    for note in notes:
        meta = note['meta']
        entry = by_source[meta['id']]
        require(meta['source_category'] == entry['source_category'], 'source category drift: ' + meta['id'])
        require(meta['title_en'] == entry['title_en'], 'English title drift: ' + meta['id'])
        require(meta['sources'][0]['url'] == entry['canonical_url'], 'canonical URL drift: ' + meta['id'])
        require(set(meta['related']).issubset(ids), 'unknown related ID')
        require(all(source['accessed'] <= site['accessed'] for source in meta['sources']), 'source date after snapshot')
        if meta['note_status'] == 'reviewed':
            require(entry['fetch_status'] == 'fetched', 'reviewed note has no fetched source: ' + meta['id'])
    rows, extra = gap_rows(manifest, notes)
    if coverage['claim'] == 'complete':
        require(not rows and not extra, 'complete claim has gaps: ' + ', '.join(row['id'] for row in rows) + ' '.join(extra))
    facts = coverage_facts(site, manifest, notes)
    require((root / 'docs' / 'coverage.md').read_text(encoding='utf-8') == coverage_markdown(facts), 'coverage report drift')
    require((root / 'patterns' / 'README.md').read_text(encoding='utf-8') == pattern_index(notes, manifest), 'pattern index drift')
    return site, notes, manifest


def inline(text: str) -> str:
    result, end = [], 0
    for match in TOKEN.finditer(text):
        result.append(html.escape(text[end:match.start()]))
        if match.group(3) is not None:
            result.append('<code>' + html.escape(match.group(3)) + '</code>')
        else:
            label, target = match.group(1), match.group(2)
            if target.endswith('.md'):
                target = target[:-3] + '.html'
            require(valid_url(target) or re.fullmatch(r'(?:\.\./)?[a-zA-Z0-9_./-]+(?:\.html|\.json)', target), 'unsafe rendered link')
            external = ' rel="noreferrer noopener"' if target.startswith('https://') else ''
            result.append(f'<a href="{html.escape(target, quote=True)}"{external}>{html.escape(label)}</a>')
        end = match.end()
    result.append(html.escape(text[end:]))
    return ''.join(result)


def markdown(text: str) -> str:
    """Small intentionally limited renderer: headings, paragraphs, lists, links, code spans."""
    out, paragraph, listing = [], [], False

    def flush():
        if paragraph:
            out.append('<p>' + inline(' '.join(paragraph)) + '</p>')
            paragraph.clear()

    for line in text.splitlines() + ['']:
        if line.startswith('- '):
            flush()
            if not listing:
                out.append('<ul>')
                listing = True
            out.append('<li>' + inline(line[2:]) + '</li>')
            continue
        if listing:
            out.append('</ul>')
            listing = False
        heading = re.match(r'^(#{1,3}) (.+)$', line)
        if heading:
            flush()
            level, title = len(heading.group(1)), heading.group(2)
            ident = ' id="references"' if title == '參考來源' else ''
            out.append(f'<h{level}{ident}>' + inline(title) + f'</h{level}>')
        elif line.startswith('|'):
            flush()
            cells = [cell.strip() for cell in line.strip().strip('|').split('|')]
            if cells and all(set(cell) <= set('-: ') and cell for cell in cells):
                continue
            if not out or not out[-1].startswith('<tr>'):
                out.append('<table>')
                tag = 'th'
            else:
                tag = 'td'
            out.append('<tr>' + ''.join(f'<{tag}>{inline(cell)}</{tag}>' for cell in cells) + '</tr>')
        elif line.strip():
            if out and out[-1].startswith('<tr>'):
                out.append('</table>')
            paragraph.append(line.strip())
        else:
            if out and out[-1].startswith('<tr>'):
                out.append('</table>')
            flush()
    return '\n'.join(out)


def page(title: str, description: str, content: str, prefix: str = '', script: bool = False):
    scripts = '<script src="app.js" defer></script>' if script else ''
    return f'''<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} · Gameplay Pattern Catalog</title><meta name="description" content="{html.escape(description, quote=True)}">
<meta name="referrer" content="no-referrer"><link rel="stylesheet" href="{prefix}style.css">{scripts}</head>
<body><a class="skip" href="#main">跳到內容</a><header><a class="brand" href="{prefix}index.html">GAMEPLAY / PATTERNS</a><nav aria-label="主要導覽"><a href="{prefix}metadata.html">Metadata 指引</a><a href="{prefix}coverage.html">完整度</a><a href="{prefix}catalog.json">JSON 索引</a></nav></header>
<main id="main">{content}</main><footer>獨立整理的設計模式筆記 · 非 Gameplay Atlas 官方網站 · 不包含原站圖片或全文</footer></body></html>\n'''


def build(out: Path, root: Path = ROOT):
    site, notes, manifest = load_catalog(root)
    facts = coverage_facts(site, manifest, notes)
    out = out.resolve()
    source = root.resolve()
    require(out != source and not source.is_relative_to(out), 'output cannot overwrite project or an ancestor')
    for reserved in ('patterns', 'docs', 'tests', 'sources'):
        path = source / reserved
        require(out != path and not out.is_relative_to(path), 'output cannot be inside source directories')
    marker = out / '.gameplay-pattern-catalog'
    require(not out.exists() or not any(out.iterdir()) or
            (marker.is_file() and marker.read_text() == 'generated-v1\n'),
            'refusing to overwrite a non-empty unmarked directory')
    out.mkdir(parents=True, exist_ok=True)
    for name in ('patterns', 'index.html', 'metadata.html', 'coverage.html', 'catalog.json',
                 'style.css', 'app.js', 'site.json', 'pattern.schema.json',
                 '.gameplay-pattern-catalog'):
        require(not (out / name).is_symlink(), 'output symlink is not allowed')
    (out / 'patterns').mkdir(exist_ok=True)
    require(not any(path.is_symlink() for path in (out / 'patterns').iterdir()), 'pattern output symlink is not allowed')
    marker.write_text('generated-v1\n', encoding='utf-8')
    expected = {note['meta']['id'] + '.html' for note in notes}
    for old in (out / 'patterns').glob('*.html'):
        if old.name not in expected:
            old.unlink()
    by_source = {entry['source_id']: entry for entry in manifest['entries']}
    cards = []
    for note in notes:
        meta = note['meta']
        title = html.escape(meta['title'])
        category = CATEGORIES[meta['category']]
        source_category = by_source[meta['id']]['source_category']
        status = NOTE_STATUS[meta['note_status']]
        search = ' '.join([
            meta['id'], meta['title'], meta['title_en'], category, source_category,
            meta['summary'], status, *meta['tags'], note['body'].split('## 相關模式', 1)[0],
        ])
        tags = ''.join('<span class="tag">' + html.escape(tag) + '</span>' for tag in meta['tags'])
        cards.append(
            f'<article class="card" data-category="{meta["category"]}" data-source-category="{html.escape(source_category, quote=True)}" '
            f'data-status="{meta["note_status"]}" data-search="{html.escape(search, quote=True)}">'
            f'<div class="eyebrow">{category}</div><p class="status {meta["note_status"]}">{status} · 原站 {html.escape(source_category)}</p>'
            f'<h2><a href="patterns/{meta["id"]}.html">{title}</a></h2><p class="english">{html.escape(meta["title_en"])}</p>'
            f'<p>{html.escape(meta["summary"])}</p><div class="tags">{tags}</div></article>'
        )
        body = (
            f'<article class="note"><a class="back" href="../index.html">← 回到全部模式</a>'
            f'<div class="eyebrow">{category} / {meta["id"]}</div><h1>{title}</h1>'
            f'<p class="english">{html.escape(meta["title_en"])}</p><p class="lead">{html.escape(meta["summary"])}</p>'
            f'<p class="status {meta["note_status"]}">{status} · 原站分類 {html.escape(source_category)} · 本地分類 {html.escape(meta["category"])}</p>'
            f'<aside>「來源摘要」是簡短改寫；其餘設計分析與原型為本地提案，並非原站或原遊戲的完整規格。已對照來源不是獨立審查。</aside>'
            f'{markdown(note["body"])}</article>'
        )
        (out / 'patterns' / f'{meta["id"]}.html').write_text(page(meta['title'], meta['summary'], body, '../'), encoding='utf-8')
    options = ''.join(f'<option value="{key}">{label}</option>' for key, label in CATEGORIES.items() if any(note['meta']['category'] == key for note in notes))
    statuses = ''.join(f'<option value="{key}">{label}</option>' for key, label in NOTE_STATUS.items())
    content = f'''<section class="hero"><div class="eyebrow">SOURCE SNAPSHOT {html.escape(manifest["snapshot_id"])}</div><h1>以來源快照為基準的設計模式筆記。</h1><p class="lead">每一篇對應一個公開機制頁。先看玩家的選擇，再讀取捨與最小驗證。<br>不是遊戲素材庫，也不是原站鏡像。</p><div class="stats"><strong>{facts["denominator"]} <small>個來源條目</small></strong><strong>{facts["reviewed"]} <small>篇已對照</small></strong><strong>{facts["groups"]} <small>個原站分類</small></strong></div></section>
<aside>分母來自 {html.escape(manifest["observed_at"])} 的來源 manifest，不是筆記篇數。已取得 {facts["fetched"]}、已對照 {facts["reviewed"]}、草稿 {facts["note_status"]["draft"]}、待寫 {facts["note_status"]["pending"]}、阻塞 {len(facts["blocked"])}、缺漏 {len(facts["gaps"])}。首頁曾觀察到 {facts["homepage"]["mechanics"]} / {facts["homepage"]["groups"]}，無 JavaScript 的首頁只顯示範例。</aside>
<form class="filters" role="search"><label>搜尋問題、機制或標籤<input id="search" type="search" placeholder="例如：背包、stamina、回饋" autocomplete="off"></label><label>依本地分類<select id="category"><option value="">全部分類</option>{options}</select></label><label>依核對狀態<select id="status"><option value="">全部狀態</option>{statuses}</select></label><button type="reset">清除</button></form><p id="count" role="status" aria-live="polite">顯示 {len(notes)} / {len(notes)} 篇</p><p id="empty" hidden>沒有符合的模式。請縮短關鍵字或清除分類。</p><noscript><p>JavaScript 未啟用：仍可閱讀全部筆記、狀態與來源，搜尋篩選暫不可用。</p></noscript><section class="grid" aria-label="設計模式">{''.join(cards)}</section>'''
    (out / 'index.html').write_text(page('玩法設計模式', '繁體中文 gameplay design pattern catalog：來源摘要、設計取捨、原型與逐篇參考網址。', content, script=True), encoding='utf-8')
    (out / 'metadata.html').write_text(page('Metadata 指引', '網站層級與 pattern 層級的欄位、來源與維護契約。', '<article class="note">' + markdown((root / 'METADATA.md').read_text(encoding='utf-8')) + '</article>'), encoding='utf-8')
    (out / 'coverage.html').write_text(page('完整度', '來源快照、筆記狀態與缺漏 ID。', '<article class="note">' + markdown(coverage_markdown(facts)) + '</article>'), encoding='utf-8')
    for name in ('style.css', 'app.js', 'site.json', 'pattern.schema.json'):
        (out / name).write_bytes((root / name).read_bytes())
    export = {
        'schema_version': 2,
        'website': site,
        'coverage': {key: value for key, value in facts.items() if key != 'entries'},
        'patterns': [{**note['meta'], 'page': f'patterns/{note["meta"]["id"]}.html', 'body_markdown': note['body']} for note in notes],
    }
    (out / 'catalog.json').write_text(json.dumps(export, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'PASS: built {len(notes)} patterns; denominator={facts["denominator"]}; output={out}')
    return len(notes)


def write_generated_docs(root: Path = ROOT) -> None:
    site = read_json((root / 'site.json').read_text(encoding='utf-8'))
    manifest = load_manifest(root / 'sources' / 'manifest.json')
    notes = [parse_note(path) for path in sorted((root / 'patterns').glob('*.md')) if path.name != 'README.md']
    facts = coverage_facts(site, manifest, notes)
    (root / 'docs' / 'coverage.md').write_text(coverage_markdown(facts), encoding='utf-8')
    (root / 'patterns' / 'README.md').write_text(pattern_index(notes, manifest), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='validate without writing output')
    parser.add_argument('--write-docs', action='store_true', help='regenerate the coverage report and pattern index')
    parser.add_argument('--out', type=Path, default=ROOT / 'dist')
    args = parser.parse_args()
    try:
        if args.write_docs:
            write_generated_docs()
            print('PASS: wrote coverage report and pattern index')
        elif args.check:
            _site, notes, manifest = load_catalog()
            print(f'PASS: {len(notes)} notes against {len(manifest["entries"])} source entries')
        else:
            build(args.out)
    except (ValueError, OSError, KeyError, TypeError) as exc:
        parser.exit(1, f'ERROR: {exc}\n')


if __name__ == '__main__':
    main()
