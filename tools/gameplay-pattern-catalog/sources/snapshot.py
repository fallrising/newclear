"""Offline helpers for the Gameplay Atlas source snapshot.

Network access lives in ``inventory.py``. This module only canonicalizes the
public entry projection and checks a manifest that is already on disk.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter

SNAPSHOT_ID = 'atlas-public-2026-11-02'
CANONICAL = 'https://gameplayatlas.loopyhop.com/mechanic/{source_id}/'
TEXT_FIELDS = (
    'id', 'system', 'edition', 'name', 'summary', 'rules', 'loop', 'decisions',
    'parameters', 'tags', 'related', 'contrast', 'combination', 'walkthrough', 'prototype',
)
FETCH_STATUS = {'discovered', 'fetched', 'blocked', 'removed'}
SLUG = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*\Z')


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def text_projection(entry: dict) -> dict:
    """Stable text fingerprint. Image URLs and case write-ups are not part of it."""
    missing = [key for key in TEXT_FIELDS if key not in entry]
    require(not missing, 'entry missing text fields: ' + ', '.join(missing))
    return {key: entry[key] for key in TEXT_FIELDS}


def content_sha256(entry: dict) -> str:
    blob = json.dumps(text_projection(entry), ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(blob.encode()).hexdigest()


def canonical_url(source_id: str) -> str:
    require(SLUG.fullmatch(source_id) is not None, 'invalid source id')
    return CANONICAL.format(source_id=source_id)


def load_manifest(path) -> dict:
    text = path.read_text(encoding='utf-8')
    require('\n  "' in text or text.startswith('{'), 'manifest must be JSON')
    data = json.loads(text)
    require(data.get('schema_version') == 1, 'manifest schema')
    require(data.get('snapshot_id') == SNAPSHOT_ID, 'unexpected snapshot id')
    entries = data.get('entries')
    require(isinstance(entries, list) and entries, 'manifest entries required')
    ids, urls = [], []
    for entry in entries:
        require(isinstance(entry, dict), 'manifest entry')
        source_id = entry.get('source_id')
        require(SLUG.fullmatch(source_id or '') is not None, 'bad source id')
        require(entry.get('canonical_url') == canonical_url(source_id), 'canonical URL drift: ' + str(source_id))
        require(entry.get('fetch_status') in FETCH_STATUS, 'bad fetch status')
        require(entry.get('note_id') == source_id, 'note id must stay aligned with source id')
        require(entry.get('note_path') == f'patterns/{source_id}.md', 'note path drift')
        require(isinstance(entry.get('title_en'), str) and entry['title_en'].strip(), 'title_en')
        require(isinstance(entry.get('source_category'), str) and entry['source_category'], 'source category')
        if entry['fetch_status'] == 'fetched':
            require(re.fullmatch(r'[0-9a-f]{64}', entry.get('content_sha256', '')), 'fetched entry needs content hash')
            require(entry.get('content_sha256') == entry.get('page_sha256') == entry.get('mechanic_json_sha256'),
                    'page, mechanic JSON and catalog projection diverged: ' + source_id)
            require(not entry.get('error'), 'fetched entry cannot also carry an error')
        else:
            require(entry.get('error'), 'non-fetched entry needs an error')
        ids.append(source_id)
        urls.append(entry['canonical_url'])
    require(len(ids) == len(set(ids)), 'duplicate source id')
    require(len(urls) == len(set(urls)), 'duplicate canonical URL')
    reconciliation = data.get('reconciliation') or {}
    require(reconciliation.get('enumerated_mechanics') == len(entries), 'enumerated count must equal manifest entries')
    groups = {entry['source_category'] for entry in entries}
    require(reconciliation.get('enumerated_groups') == len(groups), 'enumerated groups must equal actual categories')
    listed = {item.get('id'): item.get('count') for item in data.get('categories') or []}
    require(listed == dict(Counter(entry['source_category'] for entry in entries)), 'category counts drifted from entries')
    homepage = reconciliation.get('homepage_reported') or {}
    require(isinstance(homepage.get('mechanics'), int) and isinstance(homepage.get('groups'), int), 'homepage observation')
    if homepage['mechanics'] != len(entries) or homepage['groups'] != len(groups):
        conflicts = [item for item in reconciliation.get('differences') or [] if item.get('kind') == 'count']
        require(conflicts, 'homepage count differs from enumeration without a count difference record')
    require(reconciliation.get('denominator') == 'manifest-entries', 'denominator must be the manifest, not the note count')
    return data
