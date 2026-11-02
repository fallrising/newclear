"""Rebuild or re-check the Gameplay Atlas source manifest.

Offline ``--check`` validates the committed manifest. ``--write-from-cache``
turns a local fetch cache into that manifest. ``--fetch`` repeats the public
census at low rate and prints differences; it does not edit notes or publish.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.request
from collections import Counter
from pathlib import Path

from snapshot import SNAPSHOT_ID, canonical_url, content_sha256, load_manifest

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'sources' / 'manifest.json'
ASSET = 'fe93b4be8ae4079e'
UA = 'newclear-catalog-inventory/1.0 (public snapshot research; low rate; no images)'
OBSERVED_SYSTEMS = {
    'farming': ('种田与生长', 'Farming & growth'),
    'fishing': ('钓鱼与捕获', 'Fishing & catching'),
    'cooking': ('烹饪与料理', 'Cooking & food'),
    'gathering': ('采集与挖矿', 'Gathering & mining'),
    'automation': ('制造与自动化', 'Crafting & automation'),
    'building': ('建造与空间', 'Building & space'),
    'inventory': ('背包与资源', 'Inventory & resources'),
    'puzzles': ('解谜与推理', 'Puzzles & deduction'),
    'combat': ('战斗与对抗', 'Combat & tactics'),
    'exploration': ('探索与通路', 'Exploration & routes'),
    'relationships': ('社交与关系', 'Social & relationships'),
    'commerce': ('经营与交易', 'Business & trade'),
    'deckbuilding': ('卡组与效果构筑', 'Decks & synergies'),
    'progression': ('成长与跨局继承', 'Progression & legacy'),
    'survival': ('生存与身体状态', 'Survival & needs'),
    'stealth': ('潜行与身份', 'Stealth & identity'),
    'defense': ('防守与波次', 'Defense & waves'),
    'cooperation': ('合作与多人博弈', 'Cooperation & social play'),
    'ecology': ('繁育与生态', 'Breeding & ecology'),
    'matching': ('消除与合并', 'Matching & merging'),
    'projectiles': ('瞄准与投射', 'Aiming & projectiles'),
    'movement': ('移动与穿越', 'Movement & traversal'),
    'command': ('单位调度', 'Unit coordination'),
    'allocation': ('轮选与争夺', 'Drafting & allocation'),
    'narrative': ('对话与事件选择', 'Dialogue & event choices'),
    'incremental': ('收益与积累', 'Income & accumulation'),
    'rhythm': ('节拍与时序', 'Beats & timing'),
    'driving': ('载具操控', 'Vehicle handling'),
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def extract_page_entry(html: str) -> dict:
    match = re.search(r'<script type="application/json" id="atlas-entry">(.*?)</script>', html)
    require(match is not None, 'page has no embedded entry')
    return json.loads(match.group(1))


def sitemap_ids(text: str) -> list[str]:
    urls = re.findall(r'<loc>(.*?)</loc>', text)
    return sorted(url.rstrip('/').rsplit('/', 1)[-1] for url in urls if '/mechanic/' in url)


def build_manifest(cache: Path, observed_at: str) -> dict:
    catalog = json.loads((cache / 'catalog.json').read_text(encoding='utf-8'))
    index = json.loads((cache / 'index.json').read_text(encoding='utf-8'))
    site_ids = sitemap_ids((cache / 'sitemap.xml').read_text(encoding='utf-8'))
    by_id = {entry['id']: entry for entry in catalog}
    index_by_id = {entry['id']: entry for entry in index}
    require(sorted(by_id) == site_ids == sorted(index_by_id), 'public id sets differ')
    case_only = []
    prototype_only = []
    for source_id, indexed in index_by_id.items():
        full = by_id[source_id]
        for key, value in indexed.items():
            if key in ('cases', 'prototype'):
                continue
            require(value == full[key], f'index/catalog diverge on {source_id} {key}')
        require(indexed['prototype']['scope'] == full['prototype']['scope'], 'prototype scope drift ' + source_id)
        require(indexed['prototype']['interaction'] == full['prototype']['interaction'], 'prototype interaction drift ' + source_id)
        if indexed.get('cases') != full.get('cases'):
            case_only.append(source_id)
        if indexed.get('prototype') != full.get('prototype'):
            prototype_only.append(source_id)
    entries = []
    for source_id in sorted(by_id):
        full = by_id[source_id]
        page = extract_page_entry((cache / 'pages' / f'{source_id}.html').read_text(encoding='utf-8'))
        mechanic = json.loads((cache / 'mechjson' / f'{source_id}.json').read_text(encoding='utf-8'))
        digest = content_sha256(full)
        require(content_sha256(page) == digest == content_sha256(mechanic), 'projection mismatch ' + source_id)
        prefix = source_id.split('-', 1)[0]
        entries.append({
            'source_id': source_id,
            'title_en': full['name']['en'],
            'title_zh_observed': full['name']['zh'],
            'canonical_url': canonical_url(source_id),
            'source_category': full['system'],
            'slug_prefix': prefix,
            'slug_prefix_matches_category': prefix == full['system'],
            'discovery': ['sitemap', 'index-json', 'catalog-json', 'page-embedded-json', 'mechanic-json'],
            'observed_at': observed_at,
            'fetch_method': 'page-embedded-json',
            'fetch_status': 'fetched',
            'error': None,
            'content_sha256': digest,
            'page_sha256': digest,
            'mechanic_json_sha256': digest,
            'catalog_sha256': digest,
            'edition': full['edition'],
            'asset_revision': ASSET,
            'note_id': source_id,
            'note_path': f'patterns/{source_id}.md',
        })
    counts = Counter(entry['source_category'] for entry in entries)
    categories = []
    for system_id in sorted(counts):
        observed_zh, observed_en = OBSERVED_SYSTEMS[system_id]
        categories.append({
            'id': system_id,
            'name_en': observed_en,
            'name_zh_observed': observed_zh,
            'count': counts[system_id],
        })
    prefix_gaps = [entry['source_id'] for entry in entries if not entry['slug_prefix_matches_category']]
    manifest = {
        'schema_version': 1,
        'snapshot_id': SNAPSHOT_ID,
        'observed_at': observed_at,
        'source': {
            'title': 'Gameplay Atlas',
            'url': 'https://gameplayatlas.loopyhop.com/',
            'about': 'https://gameplayatlas.loopyhop.com/about/',
            'asset_revision': ASSET,
            'catalog_url': f'https://gameplayatlas.loopyhop.com/assets/{ASSET}/catalog.json',
            'index_url': f'https://gameplayatlas.loopyhop.com/assets/{ASSET}/index.json',
            'sitemap_url': 'https://gameplayatlas.loopyhop.com/sitemap.xml',
        },
        'reconciliation': {
            'denominator': 'manifest-entries',
            'enumerated_mechanics': len(entries),
            'enumerated_groups': len(categories),
            'homepage_reported': {
                'mechanics': 280,
                'groups': 28,
                'evidence': '首頁可見文字寫 280 mechanics 與 28 mechanic groups；og:image:alt 寫 280 mechanics across 28 systems。沒有 JavaScript 的首頁只渲染精選範例，所以它不是分母。',
            },
            'id_sets_equal': ['sitemap', 'index-json', 'catalog-json', 'page-embedded-json', 'mechanic-json'],
            'differences': [
                {
                    'kind': 'projection',
                    'id': 'index-json-cases',
                    'summary': f'index.json 的 cases 省略 catalog.json 才有的實作、來源、權利與觀察欄位。{len(case_only)} 條索引都只差在這裡；識別欄位一致。',
                },
                {
                    'kind': 'projection',
                    'id': 'index-json-prototype',
                    'summary': f'index.json 的 prototype 只留 scope 與 interaction。catalog.json 另外有編輯用的 firstStep、pitfall 與 test，{len(prototype_only)} 條都是這樣。這些編輯文字沒有抄進筆記。',
                },
                {
                    'kind': 'entrance',
                    'id': 'homepage-noscript-sample',
                    'summary': '沒有 JavaScript 的首頁只露出精選機制，不是完整公開清單。分母來自對帳後的 sitemap、index、catalog 與逐條機制文件。',
                },
                {
                    'kind': 'slug-prefix',
                    'id': 'prefix-differs-from-system',
                    'summary': '這些來源 ID 的 slug 前綴不是 system id：' + '、'.join(prefix_gaps) + '。',
                },
            ],
        },
        'categories': categories,
        'entries': entries,
    }
    load_manifest_text(manifest)
    return manifest


def load_manifest_text(data: dict) -> None:
    temporary = ROOT / 'sources' / '.manifest-check.json'
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    try:
        load_manifest(temporary)
    finally:
        temporary.unlink()


def fetch_into(cache: Path) -> None:
    cache.mkdir(parents=True, exist_ok=True)
    (cache / 'pages').mkdir(exist_ok=True)
    (cache / 'mechjson').mkdir(exist_ok=True)

    def read(url: str) -> bytes:
        request = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read()

    next_at = time.time()

    def paced(url: str) -> bytes:
        nonlocal next_at
        now = time.time()
        if now < next_at:
            time.sleep(next_at - now)
        next_at = time.time() + 0.4
        return read(url)

    (cache / 'sitemap.xml').write_bytes(paced('https://gameplayatlas.loopyhop.com/sitemap.xml'))
    (cache / 'index.json').write_bytes(paced(f'https://gameplayatlas.loopyhop.com/assets/{ASSET}/index.json'))
    (cache / 'catalog.json').write_bytes(paced(f'https://gameplayatlas.loopyhop.com/assets/{ASSET}/catalog.json'))
    catalog = json.loads((cache / 'catalog.json').read_text(encoding='utf-8'))
    for entry in catalog:
        source_id = entry['id']
        (cache / 'pages' / f'{source_id}.html').write_bytes(paced(f'https://gameplayatlas.loopyhop.com/mechanic/{source_id}/'))
        (cache / 'mechjson' / f'{source_id}.json').write_bytes(paced(f'https://gameplayatlas.loopyhop.com/assets/{ASSET}/mechanics/{source_id}.json'))


def diff_manifests(current: dict, live: dict) -> list[str]:
    changes = []
    current_ids = [entry['source_id'] for entry in current['entries']]
    live_ids = [entry['source_id'] for entry in live['entries']]
    if current_ids != live_ids:
        changes.append('id set changed')
    current_by = {entry['source_id']: entry for entry in current['entries']}
    for entry in live['entries']:
        previous = current_by.get(entry['source_id'])
        if previous and previous.get('content_sha256') != entry.get('content_sha256'):
            changes.append(entry['source_id'])
    return changes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--write-from-cache', type=Path)
    parser.add_argument('--fetch', action='store_true', help='re-census the public site and print differences without editing notes')
    parser.add_argument('--observed-at', default='2026-11-02T14:47:12Z')
    args = parser.parse_args()
    if args.check:
        load_manifest(MANIFEST)
        print(f'PASS: manifest {SNAPSHOT_ID}')
        return
    if args.write_from_cache:
        manifest = build_manifest(args.write_from_cache, args.observed_at)
        MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f'wrote {len(manifest["entries"])} entries')
        return
    if args.fetch:
        cache = Path('/tmp/atlas-cache-refresh')
        fetch_into(cache)
        live = build_manifest(cache, args.observed_at)
        current = load_manifest(MANIFEST)
        changes = diff_manifests(current, live)
        if changes:
            raise SystemExit('source drift: ' + ', '.join(changes[:20]))
        print('PASS: live public entrances match the committed snapshot ids and content hashes')
        return
    parser.error('choose --check, --write-from-cache or --fetch')


if __name__ == '__main__':
    main()
