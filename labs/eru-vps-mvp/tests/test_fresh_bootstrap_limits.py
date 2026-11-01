"""Bootstrap artifact records are explicitly bounded; legacy limits stay strict."""
import os
from pathlib import Path
import tempfile
import unittest

from fresh_execution_ops import PrivateFiles, MAX_BYTES
from fresh_observation_ops import _publish


class BootstrapInputLimitTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.project = Path(temp.name)
        (self.project/'private').mkdir(mode=0o700)

    def test_large_artifact_allowed_only_with_explicit_bound_and_rechecked(self):
        path = self.project/'private/core-artifact'
        with path.open('wb') as stream:
            stream.truncate(MAX_BYTES+1)
        path.chmod(0o600)
        files = PrivateFiles(self.project)
        try:
            with self.assertRaises(ValueError):
                files.read('private/core-artifact')
        finally:
            files.close()
        files = PrivateFiles(self.project, max_bytes=128*1024*1024)
        try:
            raw, _, digest = files.read('private/core-artifact')
            self.assertEqual(len(raw), MAX_BYTES+1)
            self.assertEqual(len(digest), 64)
            with path.open('r+b') as stream:
                stream.write(b'changed')
            with self.assertRaises(ValueError):
                files.recheck()
        finally:
            files.close()

    def test_invalid_bounds_and_oversize_publication_are_rejected(self):
        for bound in (True, 0, -1, 128*1024*1024+1, 'large'):
            with self.subTest(bound=bound), self.assertRaises(ValueError):
                PrivateFiles(self.project, max_bytes=bound)
        files = PrivateFiles(self.project, max_bytes=64)
        try:
            parent = files.directory(('bounded',), create=True)
            try:
                with self.assertRaises(ValueError):
                    _publish(files, parent, 'record.json', {'value':'x'*65})
                self.assertFalse((self.project/'private/bounded/record.json').exists())
            finally:
                os.close(parent)
        finally:
            files.close()
