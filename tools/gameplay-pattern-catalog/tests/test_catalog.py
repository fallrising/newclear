from __future__ import annotations

import copy
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import build


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.targets = []
    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name in ('href', 'src'):
                self.targets.append(value)


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'project'
        shutil.copytree(ROOT, self.root, ignore=shutil.ignore_patterns('dist', '__pycache__'))
        self.path = self.root / 'patterns' / 'inventory-shape-packing.md'

    def mutate(self, operation):
        text = self.path.read_text(encoding='utf-8')
        front, body = text[4:].split('\n---\n', 1)
        meta = json.loads(front)
        operation(meta)
        self.path.write_text('---\n' + json.dumps(meta, ensure_ascii=False) + '\n---\n' + body, encoding='utf-8')

    def test_current_catalog(self):
        site, notes = build.load_catalog(self.root)
        self.assertEqual(len(notes), 14)
        self.assertEqual(len({n['meta']['category'] for n in notes}), 13)
        self.assertEqual(site['coverage'], 'curated-subset')
        methods = [s['access_method'] for n in notes for s in n['meta']['sources']]
        self.assertEqual(methods.count('page-text'), 13)
        self.assertEqual(methods.count('search-index-excerpt'), 1)

    def test_schema_fields_and_categories_match_validator(self):
        schema = json.loads((self.root / 'pattern.schema.json').read_text())
        self.assertEqual(set(schema['required']), build.FIELDS)
        self.assertEqual(set(schema['properties']['category']['enum']), set(build.CATEGORIES))
        self.assertFalse(schema['additionalProperties'])

    def test_missing_and_extra_metadata(self):
        self.mutate(lambda m: m.update(unexpected=True))
        with self.assertRaisesRegex(ValueError, 'fields'):
            build.load_catalog(self.root)

    def test_duplicate_json_key_rejected(self):
        text = self.path.read_text()
        self.path.write_text(text.replace('"schema_version": 1,', '"schema_version": 1, "schema_version": 1,'))
        with self.assertRaisesRegex(ValueError, 'duplicate JSON key'):
            build.load_catalog(self.root)

    def test_id_must_match_filename(self):
        self.mutate(lambda m: m.update(id='different-id'))
        with self.assertRaisesRegex(ValueError, 'filename'):
            build.load_catalog(self.root)

    def test_unknown_relation_rejected(self):
        text = self.path.read_text()
        self.path.write_text(text.replace('inventory-adjacency', 'missing-pattern'))
        with self.assertRaisesRegex(ValueError, 'unknown related'):
            build.load_catalog(self.root)

    def test_self_relation_rejected(self):
        self.mutate(lambda m: m.update(related=[m['id']]))
        with self.assertRaisesRegex(ValueError, 'self relation'):
            build.load_catalog(self.root)

    def test_unsafe_and_noncanonical_urls(self):
        for value in ['javascript:alert(1)', 'http://example.com/', 'https://user:pass@example.com/',
                      'https://example.com/?utm_source=test', 'https://example.com/#x',
                      'https://localhost/', 'https://example.com:443/', 'https://example.com/\\evil',
                      'https://example.com/ x', 'https://[broken/']:
            with self.subTest(url=value):
                self.assertFalse(build.valid_url(value))
        self.assertTrue(build.valid_url('https://gameplayatlas.loopyhop.com/mechanic/inventory-adjacency/'))

    def test_bad_date_rejected(self):
        self.mutate(lambda m: m['sources'][0].update(accessed='2026-02-30'))
        with self.assertRaisesRegex(ValueError, 'date'):
            build.load_catalog(self.root)

    def test_reference_footer_must_match(self):
        text = self.path.read_text()
        self.path.write_text(text.rsplit('## 參考來源', 1)[0] + '## 參考來源\n\n沒有網址。\n')
        with self.assertRaisesRegex(ValueError, 'reference footer'):
            build.load_catalog(self.root)

    def test_references_must_be_last_section(self):
        self.path.write_text(self.path.read_text() + '\n## 額外內容\n\n不可插在參考來源後。\n')
        with self.assertRaisesRegex(ValueError, 'references last'):
            build.load_catalog(self.root)

    def test_count_drift_rejected(self):
        path = self.root / 'site.json'
        site = json.loads(path.read_text())
        site['curated_count'] += 1
        path.write_text(json.dumps(site))
        with self.assertRaisesRegex(ValueError, 'count drift'):
            build.load_catalog(self.root)

    def test_types_and_empty_sections(self):
        self.mutate(lambda m: m.update(tags='not-an-array'))
        with self.assertRaisesRegex(ValueError, 'tags'):
            build.load_catalog(self.root)

    def test_html_is_escaped_and_unsafe_links_are_rejected(self):
        rendered = build.markdown('## 題目\n\n<script>alert(1)</script>\n\n- `x < y`')
        self.assertNotIn('<script>', rendered)
        self.assertIn('&lt;script&gt;', rendered)
        self.assertIn('<code>x &lt; y</code>', rendered)
        with self.assertRaisesRegex(ValueError, 'unsafe rendered link'):
            build.inline('[bad](javascript:payload)')

    def test_deterministic_build_and_complete_local_links(self):
        output = Path(self.tmp.name) / 'site'
        build.build(output, self.root)
        def digest():
            return {p.relative_to(output).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in output.rglob('*') if p.is_file()}
        first = digest()
        build.build(output, self.root)
        self.assertEqual(first, digest())
        for path in output.rglob('*.html'):
            parser = Links()
            parser.feed(path.read_text())
            for target in parser.targets:
                if target.startswith('#') or urlsplit(target).scheme:
                    continue
                destination = (path.parent / target).resolve()
                self.assertTrue(destination.is_relative_to(output), target)
                self.assertTrue(destination.is_file(), f'{path.name}: {target}')
        exported = json.loads((output / 'catalog.json').read_text())
        self.assertEqual(len(exported['patterns']), 14)
        for note in exported['patterns']:
            detail = (output / note['page']).read_text()
            self.assertIn('id="references"', detail)
            self.assertIn(note['sources'][0]['url'], detail)
            self.assertTrue(note['body_markdown'].endswith('。'))
        self.assertNotIn('https://', (output / 'app.js').read_text())

    def test_build_does_not_overwrite_sources_or_unmarked_output(self):
        for output in (self.root, self.root.parent, self.root / 'patterns' / 'output'):
            with self.subTest(output=output), self.assertRaises(ValueError):
                build.build(output, self.root)
        output = Path(self.tmp.name) / 'unrelated'
        output.mkdir()
        (output / 'index.html').write_text('keep this')
        with self.assertRaisesRegex(ValueError, 'unmarked'):
            build.build(output, self.root)
        self.assertEqual((output / 'index.html').read_text(), 'keep this')

    def test_stale_generated_page_removed(self):
        output = Path(self.tmp.name) / 'site'
        build.build(output, self.root)
        stale = output / 'patterns' / 'removed-pattern.html'
        stale.write_text('old generated page')
        build.build(output, self.root)
        self.assertFalse(stale.exists())

    def test_output_symlink_rejected(self):
        output = Path(self.tmp.name) / 'site'
        build.build(output, self.root)
        asset = output / 'app.js'
        asset.unlink()
        asset.symlink_to(self.root / 'app.js')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            build.build(output, self.root)


if __name__ == '__main__':
    unittest.main()
