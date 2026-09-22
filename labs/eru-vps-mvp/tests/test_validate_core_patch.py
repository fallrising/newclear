"""Regression for git apply silently skipping a nested, untracked source tree."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from validate_core_patch import apply_source_patch


class PatchRunnerTests(unittest.TestCase):
    def test_patch_under_enclosing_git_repository_really_changes_source(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            subprocess.run(['git', 'init', '--quiet', str(parent)], check=True)
            source = parent / 'private/build/core'
            source.mkdir(parents=True)
            (source / 'lock.go').write_text('broken\n')
            patch = parent / 'fix.patch'
            patch.write_text('--- a/lock.go\n+++ b/lock.go\n@@ -1 +1 @@\n-broken\n+fixed\n')
            apply_source_patch(source, patch, check=True)
            apply_source_patch(source, patch, include='lock.go')
            self.assertEqual((source / 'lock.go').read_text(), 'fixed\n')
            self.assertTrue((source / '.git').is_dir())
