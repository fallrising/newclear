"""NS-01 model preparation/math contracts; real inference evidence is separate."""
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
import numpy as np
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from semantic_models import MODELS, pool_vectors, prefixed_texts, verify_assets


class SemanticModelContracts(unittest.TestCase):
    def test_NS01_masked_mean_excludes_padding_and_normalizes(self):
        hidden = np.array([[[3., 0.], [0., 4.], [999., 999.]]])
        np.testing.assert_allclose(pool_vectors(hidden, np.array([[1, 1, 0]]), "mean", 2), [[.6, .8]], atol=1e-7)
        np.testing.assert_allclose(pool_vectors(hidden, np.array([[1, 1, 0]]), "cls", 2), [[1., 0.]], atol=1e-7)

    def test_NS01_invalid_vectors_cannot_enter_index(self):
        for hidden, mask, dimension in [
            (np.array([[[float("nan"), 1.]]]), np.ones((1, 1)), 2),
            (np.zeros((1, 1, 2)), np.ones((1, 1)), 2),
            (np.ones((1, 1, 2)), np.zeros((1, 1)), 2),
            (np.ones((1, 1, 2)), np.ones((1, 1)), 3),
        ]:
            with self.subTest(dimension=dimension), self.assertRaises(ValueError):
                pool_vectors(hidden, mask, "mean", dimension)

    def test_NS01_model_specific_prefixes_dimensions(self):
        self.assertEqual(prefixed_texts("bge_zh", ["問題"], query=True), ["为这个句子生成表示以用于检索相关文章：問題"])
        self.assertEqual(prefixed_texts("bge_zh", ["文件"], query=False), ["文件"])
        self.assertEqual(prefixed_texts("e5_multi", ["問題"], query=True), ["query: 問題"])
        self.assertEqual(prefixed_texts("e5_multi", ["文件"], query=False), ["passage: 文件"])
        self.assertEqual([MODELS[m]["dimension"] for m in ("bge_zh", "e5_multi")], [512, 384])

    def test_NS01_overflowing_norm_cannot_produce_zero_vector(self):
        hidden = np.array([[[3e38, 3e38]]], dtype=np.float32)
        with np.errstate(over="ignore"), self.assertRaisesRegex(ValueError, "Invalid model vectors"):
            pool_vectors(hidden, np.ones((1, 1)), "cls", 2)

    def test_NS01_missing_assets_fail_without_writes(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(FileNotFoundError, "Missing prepared semantic asset"):
                verify_assets(Path(temporary))
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_NS01_corrupt_asset_is_rejected_and_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "bge_zh/onnx/model.onnx"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"not a model")
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                verify_assets(Path(temporary), "bge_zh")
            self.assertEqual(path.read_bytes(), b"not a model")

    def test_NS01_symlink_cache_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "real").mkdir()
            (root / "link").symlink_to(root / "real", target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "symlink"):
                verify_assets(root / "link", "bge_zh")
            self.assertEqual(list((root / "real").iterdir()), [])


    def test_NS01_diagnostic_refuses_existing_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "exists"
            output.mkdir()
            sentinel = output / "keep.txt"
            sentinel.write_text("keep")
            result = subprocess.run([sys.executable, str(ROOT / "diagnose_vectors.py"), "--output", str(output),
                                     "--cache", str(Path(temporary) / "missing")], capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("already exists", result.stderr)
            self.assertEqual(sentinel.read_text(), "keep")

    def test_NS01_diagnostic_missing_assets_create_no_memory(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "not-created"
            result = subprocess.run([sys.executable, str(ROOT / "diagnose_vectors.py"), "--output", str(output),
                                     "--cache", str(Path(temporary) / "missing")], capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Missing prepared semantic asset", result.stderr)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
