"""Regression checks for versioned node governance."""
import re
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sdd


class NodeRevisionTests(unittest.TestCase):
    def test_revision_is_positive_not_pinned_to_initial_version(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(sdd.ROOT / "docs/nodes", root / "docs/nodes")
            shutil.copy(sdd.ROOT / "docs/graph.yaml", root / "docs/graph.yaml")
            shutil.copy(sdd.ROOT / "SPEC.md", root / "SPEC.md")
            node = root / "docs/nodes/N00-foundation-ci-contracts.md"
            text = node.read_text()
            with patch.object(sdd, "ROOT", root):
                metadata = sdd.spec_metadata()
                digest = sdd.sha256_file(root / "SPEC.md")
                for revision in ("1", "2", "10"):
                    node.write_text(re.sub(r"(?m)^revision: .*", f"revision: {revision}", text))
                    sdd.validate_graph(metadata, digest)
                for revision in ("0", "-1", "1.5", "", "draft"):
                    node.write_text(re.sub(r"(?m)^revision: .*", f"revision: {revision}", text))
                    with self.assertRaises(sdd.VerificationError):
                        sdd.validate_graph(metadata, digest)


if __name__ == "__main__":
    unittest.main()
