from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'sources'))
import status
from snapshot import SNAPSHOT_ID, TEXT_FIELDS


def git(repo: Path, *args: str, env: dict) -> None:
    subprocess.check_call(['git', '-C', str(repo), *args], env=env)


class StatusTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name) / 'repo'
        self.catalog = self.repo / 'tools' / 'gameplay-pattern-catalog'
        (self.catalog / 'patterns').mkdir(parents=True)
        (self.catalog / 'review').mkdir()
        (self.repo / 'docs' / 'project-success').mkdir(parents=True)
        note = {
            'id': 'example-note',
            'note_status': 'draft',
        }
        (self.catalog / 'patterns' / 'example-note.md').write_text(
            '---\n' + json.dumps(note, ensure_ascii=False, indent=2) + '\n---\n\nBody.\n',
            encoding='utf-8',
        )
        (self.catalog / 'SUCCESS.md').write_text(
            '---\nproject: tools/gameplay-pattern-catalog\nsource_commit: ' + ('0' * 40) + '\n---\n'
            '# Gameplay Pattern Catalog — 驗收入口\n\n'
            '<!-- catalog-status:start -->\nold\n<!-- catalog-status:end -->\n',
            encoding='utf-8',
        )
        (self.repo / 'docs' / 'project-success' / 'inventory.json').write_text(
            '{\n  "projects": [\n    {\n      "path": "tools/gameplay-pattern-catalog",\n'
            '      "last_source_update": "2026-11-03T00:00:00Z",\n'
            '      "source_commit": "' + ('0' * 40) + '"\n    }\n  ]\n}\n',
            encoding='utf-8',
        )
        self.env = os.environ.copy()
        self.env.update({
            'GIT_AUTHOR_NAME': 'Test',
            'GIT_AUTHOR_EMAIL': 'test@example.com',
            'GIT_COMMITTER_NAME': 'Test',
            'GIT_COMMITTER_EMAIL': 'test@example.com',
        })

    def test_notes_tree_matches_git_and_real_counts_are_draft(self):
        lines = []
        for path in sorted((ROOT / 'patterns').glob('*.md')):
            if path.name == 'README.md':
                continue
            blob = subprocess.check_output(['git', 'hash-object', str(path)], text=True).strip()
            lines.append(f'100644 blob {blob}\t{path.name}\n')
        tree = subprocess.check_output(['git', 'mktree'], input=''.join(lines), text=True).strip()
        facts = status.compute(ROOT)
        self.assertEqual(tree, facts['source_commit'])
        self.assertEqual(facts['draft'], facts['total'])
        self.assertEqual(facts['reviewed'], 0)
        self.assertEqual(facts['pending'], 0)
        auto_path = ROOT / 'review' / 'auto-check.json'
        if auto_path.exists():
            notes = json.loads(auto_path.read_text(encoding='utf-8'))['notes']
            self.assertEqual(facts['auto_check'], 'present')
            self.assertEqual(facts['auto_checked'], len(notes))
            self.assertEqual(facts['flagged'], sum(item['verdict'] == 'flag' for item in notes))
        else:
            self.assertEqual(facts['flagged'], 0)
            self.assertEqual(facts['auto_check'], 'absent')
        self.assertEqual(facts['snapshot_id'], SNAPSHOT_ID)
        self.assertNotEqual(facts['total'], 0)

    def test_write_is_idempotent_and_disagreement_fails(self):
        facts = status.write(self.catalog)
        self.assertEqual([], status.check(self.catalog))
        self.assertEqual([], status.check(self.catalog))
        inventory = (self.repo / 'docs' / 'project-success' / 'inventory.json').read_text(encoding='utf-8')
        self.assertIn(facts['source_commit'], inventory)
        self.assertEqual(facts['source_commit'], status.frontmatter_value((self.catalog / 'SUCCESS.md').read_text(encoding='utf-8'), 'source_commit'))
        broken = inventory.replace(facts['source_commit'], 'a' * 40)
        (self.repo / 'docs' / 'project-success' / 'inventory.json').write_text(broken, encoding='utf-8')
        errors = status.check(self.catalog)
        self.assertIn('inventory.json catalog source_commit does not match the notes tree', errors)
        status.write(self.catalog)
        snippet = (self.catalog / 'review' / 'pr-snippet.md').read_text(encoding='utf-8')
        (self.catalog / 'review' / 'pr-snippet.md').write_text(snippet.replace('draft:', 'draft: 1'), encoding='utf-8')
        self.assertIn('review/pr-snippet.md does not match the notes', status.check(self.catalog))

    def test_flagged_count_comes_from_auto_check(self):
        result = {
            'schema_version': 1,
            'snapshot_id': SNAPSHOT_ID,
            'llm': 'command',
            'model': None,
            'generated_at': '2026-11-03T00:00:00Z',
            'notes': [{
                'id': 'example-note',
                'verdict': 'flag',
                'issues': [{'kind': 'wrong-number', 'detail': 'the example adds to the wrong total'}],
            }],
        }
        (self.catalog / 'review' / 'auto-check.json').write_text(json.dumps(result) + '\n', encoding='utf-8')
        facts = status.compute(self.catalog)
        self.assertEqual(1, facts['flagged'])
        self.assertEqual(1, facts['auto_checked'])
        self.assertEqual('present', facts['auto_check'])
        self.assertEqual(facts['draft'], facts['total'])

    def test_pr_description_must_carry_the_snippet_only_when_the_catalog_changes(self):
        status.write(self.catalog)
        git(self.repo, 'init', '-b', 'main', env=self.env)
        git(self.repo, 'add', '.', env=self.env)
        git(self.repo, '-c', 'commit.gpgsign=false', 'commit', '-m', 'init', env=self.env)
        (self.repo / 'README.md').write_text('unrelated\n', encoding='utf-8')
        git(self.repo, 'add', 'README.md', env=self.env)
        git(self.repo, '-c', 'commit.gpgsign=false', 'commit', '-m', 'docs', env=self.env)
        base = subprocess.check_output(['git', '-C', str(self.repo), 'rev-parse', 'HEAD~1'], text=True).strip()
        self.assertEqual([], status.check_pr_body(self.catalog, '', base))
        (self.catalog / 'review' / 'note.txt').write_text('review helper\n', encoding='utf-8')
        git(self.repo, 'add', 'tools/gameplay-pattern-catalog/review/note.txt', env=self.env)
        git(self.repo, '-c', 'commit.gpgsign=false', 'commit', '-m', 'catalog', env=self.env)
        base = subprocess.check_output(['git', '-C', str(self.repo), 'rev-parse', 'HEAD~1'], text=True).strip()
        self.assertIn('PR description is missing the generated catalog status snippet', status.check_pr_body(self.catalog, 'stale counts', base))
        snippet = (self.catalog / 'review' / 'pr-snippet.md').read_text(encoding='utf-8')
        self.assertEqual([], status.check_pr_body(self.catalog, 'prefix\n' + snippet + '\nsuffix\n', base))

    def test_inventory_row_change_requires_the_snippet(self):
        head = '{\n  "projects": [\n    {\n      "path": "tools/gameplay-pattern-catalog",\n      "last_source_update": "2026-11-03T00:00:00Z",\n      "source_commit": "' + ('b' * 40) + '"\n    }\n  ]\n}\n'
        base = head.replace('b' * 40, 'a' * 40)
        self.assertTrue(status.needs_snippet(['docs/project-success/inventory.json'], base, head))
        same = head.replace('2026-11-03T00:00:00Z', '2026-11-04T00:00:00Z')
        self.assertFalse(status.needs_snippet(['docs/project-success/inventory.json'], head, same))
        self.assertFalse(status.needs_snippet(['README.md'], None, head))

    def test_repository_status_matches_after_generation(self):
        self.assertEqual([], status.check(ROOT))

    def test_workflows_do_not_run_the_model_or_promote_notes(self):
        for path in (REPO / '.github' / 'workflows').glob('*.yml'):
            text = path.read_text(encoding='utf-8')
            self.assertNotIn('auto_check.py', text, path.name)
            self.assertNotIn('promote.py', text, path.name)
            self.assertNotIn('CATALOG_REVIEW', text, path.name)


class TextCacheTests(unittest.TestCase):
    def test_projection_round_trip_and_hash_drift(self):
        sys.path.insert(0, str(ROOT / 'sources'))
        import text_cache
        from snapshot import content_sha256

        entry = {key: 'sample-id' if key == 'id' else 'value' for key in TEXT_FIELDS}
        digest = content_sha256(entry)
        manifest = {'entries': [{'source_id': 'sample-id', 'content_sha256': digest}]}
        cached = text_cache.projections_from_catalog([dict(entry), ], manifest)
        directory = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, directory)
        text_cache.write_cache(cached, directory)
        text_cache.check_cache(manifest, directory)
        drifted = dict(entry)
        drifted['summary'] = 'other'
        with self.assertRaisesRegex(ValueError, 'hash drift'):
            text_cache.projections_from_catalog([drifted], manifest)
        path = directory / 'sample-id.json'
        stored = json.loads(path.read_text(encoding='utf-8'))
        stored['cases'] = ['not stored']
        path.write_text(json.dumps(stored), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'text projection only'):
            text_cache.check_cache(manifest, directory)

    def test_committed_cache_matches_the_manifest(self):
        subprocess.check_call([sys.executable, 'sources/text_cache.py', '--check'], cwd=ROOT)


if __name__ == '__main__':
    unittest.main()
