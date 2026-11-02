#!/usr/bin/env python3
"""Validate curated Markdown notes and build a dependency-free static catalog."""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
CATEGORIES = {
    'farming': '種植與照料', 'fishing': '釣魚與時機', 'cooking': '配方與製作',
    'gathering': '採集與工具', 'automation': '自動化與物流', 'building': '建造與支撐',
    'inventory': '背包與配置', 'puzzles': '解謎與位置', 'combat': '戰鬥與資源',
    'exploration': '探索與能力', 'relationships': '關係與分配',
    'allocation': '選取與保留', 'commerce': '交易與資訊',
}
HEADINGS = (
    '來源摘要', '問題與情境（本地分析）', '解法與取捨（本地分析）',
    '可調參數（本地分析）', '失敗模式（本地分析）',
    '最小原型與驗收（本地提案）', '相關模式', '參考來源',
)
FIELDS = {'schema_version', 'id', 'title', 'title_en', 'category', 'tags',
          'summary', 'related', 'sources'}
SOURCE_FIELDS = {'title', 'url', 'accessed', 'access_method'}
SLUG = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*\Z')
LINK = re.compile(r'\[([^\]\n]+)\]\(([^\s)]+)\)')
TOKEN = re.compile(r'\[([^\]\n]+)\]\(([^\s)]+)\)|`([^`\n]+)`')


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


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
    require(type(meta['schema_version']) is int and meta['schema_version'] == 1, 'schema_version must be 1')
    for key, limit in [('id', 100), ('title', 100), ('title_en', 120), ('summary', 240)]:
        require(isinstance(meta[key], str) and 0 < len(meta[key].strip()) <= limit, f'invalid {key}')
    require(SLUG.fullmatch(meta['id']) is not None and path.stem == meta['id'], 'ID must equal filename stem')
    require(isinstance(meta['category'], str) and meta['category'] in CATEGORIES, 'unknown category')
    for key, lower, upper in [('tags', 1, 8), ('related', 0, 6)]:
        values = meta[key]
        require(isinstance(values, list) and lower <= len(values) <= upper, f'invalid {key}')
        require(all(isinstance(v, str) and SLUG.fullmatch(v) for v in values), f'invalid {key} slug')
        require(len(set(values)) == len(values), f'duplicate {key}')
    require(meta['id'] not in meta['related'], 'self relation')
    require(isinstance(meta['sources'], list) and 1 <= len(meta['sources']) <= 5, 'sources required')
    for source in meta['sources']:
        require(isinstance(source, dict) and set(source) == SOURCE_FIELDS, 'invalid source fields')
        require(isinstance(source['title'], str) and 0 < len(source['title'].strip()) <= 200, 'invalid source title')
        require(valid_url(source['url']), 'source URL must be canonical HTTPS without credentials/query/fragment')
        require(valid_date(source['accessed']), 'invalid source accessed date')
        require(source['access_method'] in ('page-text', 'search-index-excerpt'), 'invalid access_method')
    urls = [s['url'] for s in meta['sources']]
    require(len(set(urls)) == len(urls), 'duplicate source URL')
    found = re.findall(r'^## (.+)$', body, re.M)
    require(found == list(HEADINGS), 'required sections must appear once in contract order; references last')
    sections = re.split(r'^## .+\n', body, flags=re.M)[1:]
    require(all(section.strip() for section in sections), 'empty note section')
    footer = body.split('## 參考來源\n', 1)[1]
    require(LINK.findall(footer) == [(s['title'], s['url']) for s in meta['sources']], 'reference footer must match metadata sources')
    for label, target in LINK.findall(body):
        require(target in urls or target in [f'{r}.md' for r in meta['related']], 'unregistered note link: ' + target)
    related_section = body.split('## 相關模式\n', 1)[1].split('## 參考來源\n', 1)[0]
    require([t for _, t in LINK.findall(related_section)] == [f'{r}.md' for r in meta['related']], 'related section must match related IDs')
    return {'meta': meta, 'body': body.strip()}


def load_catalog(root: Path = ROOT):
    site = read_json((root / 'site.json').read_text(encoding='utf-8'))
    require(site.get('schema_version') == 1, 'invalid site schema')
    require(valid_url(site.get('url')), 'invalid site URL')
    require(valid_date(site.get('accessed')), 'invalid site date')
    require(site.get('coverage') == 'curated-subset', 'coverage must distinguish this curated subset')
    notes = [parse_note(path) for path in sorted((root / 'patterns').glob('*.md')) if path.name != 'README.md']
    ids = [note['meta']['id'] for note in notes]
    require(bool(ids) and len(set(ids)) == len(ids), 'empty catalog or duplicate ID')
    require(type(site.get('curated_count')) is int and site['curated_count'] == len(notes), 'curated_count drift')
    reported = site.get('reported_counts', {})
    require(all(type(reported.get(k)) is int and reported[k] > 0 for k in ('mechanics', 'groups')), 'invalid reported counts')
    require(site['curated_count'] <= reported['mechanics'], 'curated count exceeds source snapshot')
    for note in notes:
        require(set(note['meta']['related']).issubset(ids), 'unknown related ID')
        require(all(s['accessed'] <= site['accessed'] for s in note['meta']['sources']), 'source date after snapshot')
    return site, notes


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
        elif line.strip():
            paragraph.append(line.strip())
        else:
            flush()
    return '\n'.join(out)


def page(title: str, description: str, content: str, prefix: str = '', script: bool = False):
    scripts = '<script src="app.js" defer></script>' if script else ''
    return f'''<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} · Gameplay Pattern Catalog</title><meta name="description" content="{html.escape(description, quote=True)}">
<meta name="referrer" content="no-referrer"><link rel="stylesheet" href="{prefix}style.css">{scripts}</head>
<body><a class="skip" href="#main">跳到內容</a><header><a class="brand" href="{prefix}index.html">GAMEPLAY / PATTERNS</a><nav aria-label="主要導覽"><a href="{prefix}metadata.html">Metadata 指引</a><a href="{prefix}catalog.json">JSON 索引</a></nav></header>
<main id="main">{content}</main><footer>獨立整理的設計模式筆記 · 非 Gameplay Atlas 官方網站 · 不包含原站圖片或全文</footer></body></html>\n'''


def build(out: Path, root: Path = ROOT):
    site, notes = load_catalog(root)
    out = out.resolve()
    source = root.resolve()
    require(out != source and not source.is_relative_to(out), 'output cannot overwrite project or an ancestor')
    for reserved in ('patterns', 'docs', 'tests'):
        path = source / reserved
        require(out != path and not out.is_relative_to(path), 'output cannot be inside source directories')
    marker = out / '.gameplay-pattern-catalog'
    require(not out.exists() or not any(out.iterdir()) or
            (marker.is_file() and marker.read_text() == 'generated-v1\n'),
            'refusing to overwrite a non-empty unmarked directory')
    out.mkdir(parents=True, exist_ok=True)
    for name in ('patterns', 'index.html', 'metadata.html', 'catalog.json',
                 'style.css', 'app.js', 'site.json', 'pattern.schema.json',
                 '.gameplay-pattern-catalog'):
        require(not (out / name).is_symlink(), 'output symlink is not allowed')
    (out / 'patterns').mkdir(exist_ok=True)
    require(not any(p.is_symlink() for p in (out / 'patterns').iterdir()), 'pattern output symlink is not allowed')
    marker.write_text('generated-v1\n', encoding='utf-8')
    expected = {note['meta']['id'] + '.html' for note in notes}
    # Remove only stale generated pattern pages, never arbitrary source files.
    for old in (out / 'patterns').glob('*.html'):
        if old.name not in expected:
            old.unlink()
    cards = []
    for note in notes:
        meta = note['meta']
        title = html.escape(meta['title'])
        category = CATEGORIES[meta['category']]
        search = ' '.join([meta['id'], meta['title'], meta['title_en'], category, meta['summary'], *meta['tags'], note['body'].split('## 相關模式', 1)[0]])
        tags = ''.join('<span class="tag">' + html.escape(tag) + '</span>' for tag in meta['tags'])
        cards.append(f'<article class="card" data-category="{meta["category"]}" data-search="{html.escape(search, quote=True)}"><div class="eyebrow">{category}</div><h2><a href="patterns/{meta["id"]}.html">{title}</a></h2><p class="english">{html.escape(meta["title_en"])}</p><p>{html.escape(meta["summary"])}</p><div class="tags">{tags}</div></article>')
        body = f'<article class="note"><a class="back" href="../index.html">← 回到全部模式</a><div class="eyebrow">{category} / {meta["id"]}</div><h1>{title}</h1><p class="english">{html.escape(meta["title_en"])}</p><p class="lead">{html.escape(meta["summary"])}</p><aside>「來源摘要」是簡短改寫；其餘設計分析與原型為本地提案，並非原站或原遊戲的完整規格。</aside>{markdown(note["body"])}</article>'
        (out / 'patterns' / f'{meta["id"]}.html').write_text(page(meta['title'], meta['summary'], body, '../'), encoding='utf-8')
    options = ''.join(f'<option value="{key}">{label}</option>' for key, label in CATEGORIES.items() if any(n['meta']['category'] == key for n in notes))
    content = f'''<section class="hero"><div class="eyebrow">A CURATED DESIGN PATTERN CATALOG</div><h1>從玩法，拆出可重用的設計。</h1><p class="lead">先看玩家面對的選擇，再讀規則、取捨與最小驗證。<br>不是遊戲素材庫，也不是原站鏡像。</p><div class="stats"><strong>{len(notes)} <small>篇獨立筆記</small></strong><strong>{len({n['meta']['category'] for n in notes})} <small>個本地分類</small></strong><strong>100% <small>逐篇附來源</small></strong></div></section>
<aside>收錄範圍：精選子集。原站於 {site['accessed']} 的首頁標示 {site['reported_counts']['mechanics']} 個機制／{site['reported_counts']['groups']} 類；此處未全量匯入，也未逐項驗證原站總數。</aside>
<form class="filters" role="search"><label>搜尋問題、機制或標籤<input id="search" type="search" placeholder="例如：背包、stamina、回饋" autocomplete="off"></label><label>依設計機制分類<select id="category"><option value="">全部分類</option>{options}</select></label><button type="reset">清除</button></form><p id="count" role="status" aria-live="polite">顯示 {len(notes)} / {len(notes)} 篇</p><p id="empty" hidden>沒有符合的模式。請縮短關鍵字或清除分類。</p><noscript><p>JavaScript 未啟用：仍可閱讀全部筆記與來源，搜尋篩選暫不可用。</p></noscript><section class="grid" aria-label="設計模式">{''.join(cards)}</section>'''
    (out / 'index.html').write_text(page('玩法設計模式', '繁體中文 gameplay design pattern catalog：來源摘要、設計取捨、原型與逐篇參考網址。', content, script=True), encoding='utf-8')
    (out / 'metadata.html').write_text(page('Metadata 指引', '網站層級與 pattern 層級的欄位、來源與維護契約。', '<article class="note">' + markdown((root / 'METADATA.md').read_text(encoding='utf-8')) + '</article>'), encoding='utf-8')
    for name in ('style.css', 'app.js', 'site.json', 'pattern.schema.json'):
        (out / name).write_bytes((root / name).read_bytes())
    export = {'schema_version': 1, 'website': site, 'patterns': [{**n['meta'], 'page': f'patterns/{n["meta"]["id"]}.html', 'body_markdown': n['body']} for n in notes]}
    (out / 'catalog.json').write_text(json.dumps(export, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'PASS: built {len(notes)} patterns; output={out}')
    return len(notes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='validate without writing output')
    parser.add_argument('--out', type=Path, default=ROOT / 'dist')
    args = parser.parse_args()
    try:
        if args.check:
            _, notes = load_catalog()
            print(f'PASS: {len(notes)} patterns, metadata, references and related links')
        else:
            build(args.out)
    except (ValueError, OSError, KeyError, TypeError) as exc:
        parser.exit(1, f'ERROR: {exc}\n')


if __name__ == '__main__':
    main()
