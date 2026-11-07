"""Cache the Gameplay Atlas text projection used for content hashes.

The cache stores the fields that ``snapshot.content_sha256`` already fingerprints.
Case write-ups and images stay out. Cached text is source data, not instructions.
``--check`` does not use the network. ``--fetch`` downloads the catalog URL
recorded in the manifest and writes a file only when every hash still matches.
"""
from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

from snapshot import TEXT_FIELDS, content_sha256, load_manifest, text_projection

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'sources' / 'manifest.json'
CACHE = ROOT / 'sources' / 'text'
UA = 'newclear-catalog-inventory/1.0 (public snapshot research; low rate; no images)'
MAX_BYTES = 40 * 1024 * 1024


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def projection_text(projection: dict) -> str:
    ordered = {key: projection[key] for key in TEXT_FIELDS}
    return json.dumps(ordered, ensure_ascii=False, indent=2) + '\n'


def load_cached(path: Path) -> dict:
    data = json.loads(path.read_text(encoding='utf-8'))
    require(isinstance(data, dict), path.name + ': cache entry must be an object')
    require(set(data) == set(TEXT_FIELDS), path.name + ': cache must be the text projection only')
    return {key: data[key] for key in TEXT_FIELDS}


def projections_from_catalog(catalog: list, manifest: dict) -> dict[str, dict]:
    require(isinstance(catalog, list), 'catalog must be a list')
    by_id = {}
    for entry in catalog:
        require(isinstance(entry, dict) and isinstance(entry.get('id'), str), 'catalog entry id')
        require(entry['id'] not in by_id, 'duplicate catalog id: ' + entry['id'])
        by_id[entry['id']] = entry
    found = {}
    for entry in manifest['entries']:
        source_id = entry['source_id']
        live = by_id.get(source_id)
        require(live is not None, 'catalog is missing ' + source_id)
        require(content_sha256(live) == entry['content_sha256'], 'hash drift: ' + source_id)
        found[source_id] = text_projection(live)
    extra = sorted(set(by_id) - set(found))
    require(not extra, 'catalog has ids outside the manifest: ' + ', '.join(extra[:5]))
    return found


def write_cache(projections: dict[str, dict], cache: Path = CACHE) -> None:
    cache.mkdir(parents=True, exist_ok=True)
    expected = {f'{source_id}.json' for source_id in projections}
    for source_id, projection in sorted(projections.items()):
        (cache / f'{source_id}.json').write_text(projection_text(projection), encoding='utf-8')
    for path in cache.glob('*.json'):
        if path.name not in expected:
            path.unlink()


def check_cache(manifest: dict, cache: Path = CACHE) -> None:
    require(cache.is_dir(), 'source text cache is missing')
    seen = set()
    for entry in manifest['entries']:
        source_id = entry['source_id']
        path = cache / f'{source_id}.json'
        require(path.is_file(), 'missing source text: ' + source_id)
        cached = load_cached(path)
        require(cached['id'] == source_id, 'cached id does not match filename: ' + source_id)
        require(content_sha256(cached) == entry['content_sha256'], 'cached hash drift: ' + source_id)
        seen.add(path.name)
    extra = sorted(path.name for path in cache.glob('*.json') if path.name not in seen)
    require(not extra, 'unexpected source text files: ' + ', '.join(extra[:5]))


def fetch_catalog(url: str) -> list:
    request = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = response.read(MAX_BYTES + 1)
    require(len(payload) <= MAX_BYTES, 'catalog response exceeds size bound')
    data = json.loads(payload.decode('utf-8'))
    require(isinstance(data, list), 'catalog response must be a list')
    return data


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--catalog-json', type=Path, help='read a local catalog.json instead of the network')
    args = parser.parse_args(argv)
    try:
        manifest = load_manifest(MANIFEST)
        if args.check:
            check_cache(manifest)
            print(f'PASS: {len(manifest["entries"])} source text files match the manifest hashes')
            return
        if args.fetch or args.catalog_json:
            if args.catalog_json:
                catalog = json.loads(args.catalog_json.read_text(encoding='utf-8'))
            else:
                catalog = fetch_catalog(manifest['source']['catalog_url'])
            write_cache(projections_from_catalog(catalog, manifest))
            check_cache(manifest)
            print(f'PASS: cached {len(manifest["entries"])} text projections')
            return
    except (OSError, ValueError, json.JSONDecodeError, UnicodeError) as exc:
        parser.exit(1, f'ERROR: {exc}\n')
    parser.error('choose --check or --fetch')


if __name__ == '__main__':
    main()
