"""Loader boundaries; these tests do not represent native retrieval quality."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import semantic_sdk


class SemanticSdkBoundary(unittest.TestCase):
    def test_existing_sdk_cannot_be_silently_replaced(self):
        with patch.dict(sys.modules, {'memvid_sdk': object()}):
            with self.assertRaisesRegex(RuntimeError, 'before importing'):
                semantic_sdk.activate()

    def test_unverified_overlay_rejected_before_native_import(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'manifest.json').write_text(json.dumps({'patch': 'untrusted'}))
            with patch.object(semantic_sdk, 'BUILD', directory):
                with self.assertRaisesRegex(ValueError, 'identity/checksum'):
                    semantic_sdk.activate()
            self.assertNotIn('memvid_sdk', sys.modules)
            self.assertNotIn('memvid_sdk._lib', sys.modules)

    def test_failed_activation_removes_new_package_children(self):
        import importlib.machinery
        import types
        class FailingLoader:
            def create_module(self, spec):
                return None
            def exec_module(self, module):
                sys.modules['memvid_sdk._lib'] = types.ModuleType('memvid_sdk._lib')
                sys.modules['memvid_sdk.extra'] = types.ModuleType('memvid_sdk.extra')
                raise RuntimeError('controlled native import failure')
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'overlay').mkdir()
            library = directory / 'overlay/_lib.abi3.so'
            library.write_bytes(b'never loaded')
            manifest = {'patch': semantic_sdk.PATCH_ID, 'archive_sha256': semantic_sdk.ARCHIVE_SHA,
                        'cargo_lock_sha256': semantic_sdk.BUILD_LOCK_SHA,
                        'hnsw_archive_sha256': semantic_sdk.HNSW_SHA,
                        'preparer_sha256': semantic_sdk.digest(ROOT / 'prepare_semantic_sdk.py'),
                        'patch_sha256': semantic_sdk.digest(ROOT / 'semantic-sdk.patch'),
                        'lock_patch_sha256': semantic_sdk.digest(ROOT / 'semantic-sdk-lock.patch'),
                        'library_sha256': semantic_sdk.digest(library)}
            (directory / 'manifest.json').write_text(json.dumps(manifest))
            spec = importlib.machinery.ModuleSpec('memvid_sdk', FailingLoader())
            with patch.object(semantic_sdk, 'BUILD', directory), patch.object(semantic_sdk.importlib.util, 'spec_from_file_location', return_value=spec):
                with self.assertRaisesRegex(RuntimeError, 'controlled native import'):
                    semantic_sdk.activate()
            for name in ('memvid_sdk', 'memvid_sdk._lib', 'memvid_sdk.extra'):
                self.assertNotIn(name, sys.modules)
