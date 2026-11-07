"""Output safety checks; real CLI/MCP acceptance is workspace_trial itself."""
from pathlib import Path
import tempfile
import unittest

from graphify_lab.workspace_trial import validate_output


class TrialOutputBoundaries(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.lab = self.root / 'lab'
        self.source = self.root / 'source'
        self.env = self.root / 'environment'
        self.cache = self.root / 'cache'
        for path in (self.lab, self.source, self.env, self.cache):
            path.mkdir()

    def validate(self, path):
        return validate_output(path, lab=self.lab, source=self.source,
                               environment_root=self.env, cache=self.cache)

    def test_protected_trees_and_ancestors(self):
        protected = [self.lab / name for name in ('graphify_lab', 'tests', 'fixtures', '.venv')]
        protected.extend((self.source, self.env, self.cache))
        for path in protected:
            for output in (path, path / 'new-run', path.parent):
                with self.subTest(output=output), self.assertRaises(ValueError):
                    self.validate(output)

    def test_existing_directory_and_file_preserved(self):
        output = self.lab / 'work' / 'old'
        output.mkdir(parents=True)
        marker = output / 'keep'
        marker.write_text('owner data')
        for path in (output, marker):
            with self.subTest(path=path), self.assertRaises(FileExistsError):
                self.validate(path)
        self.assertEqual(marker.read_text(), 'owner data')

    def test_symlink_to_protected_tree_rejected(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.source, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.validate(alias / 'new-run')

    def test_dangling_output_symlink_is_not_a_new_directory(self):
        alias = self.root / 'dangling'
        alias.symlink_to(self.root / 'missing', target_is_directory=True)
        with self.assertRaises(FileExistsError):
            self.validate(alias)
        self.assertFalse((self.root / 'missing').exists())

    def test_new_work_directory_is_allowed_without_creating_it(self):
        output = self.lab / 'work' / 'new-run'
        self.assertEqual(self.validate(output), output)
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
