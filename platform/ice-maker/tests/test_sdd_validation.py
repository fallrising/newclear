import tempfile
import unittest
from pathlib import Path
import shutil

from ice_maker.sdd import parse_front_matter, validate_sdd


VALID = """---
id: SDD-0001
title: Example feature
status: approved
owner: human
risk: medium
data_class: internal
budget_usd: 2
allowed_paths:
  - src/ice_maker/**
forbidden_paths:
  - .git/**
---

# Example

## Context
Why.
## Goals
- G-1: Do it.
## Non-goals
- Nothing else.
## User stories
- As an operator, I can validate.
## Functional requirements
- FR-1: Validate.
## Non-functional requirements
- NFR-1: Offline.
## Acceptance criteria
Scenario: Works
Given input
When run
Then pass
## Failure modes
- Bad input: fail.
## Open questions
- None.
"""


class SddValidationTest(unittest.TestCase):
    def test_missing_required_field_is_reported(self):
        result = validate_sdd(VALID.replace("owner: human\n", ""))
        self.assertFalse(result.valid)
        self.assertIn("front_matter.required", {issue.code for issue in result.issues})

    def test_duplicate_keys_are_rejected(self):
        with self.assertRaises(ValueError) as caught:
            parse_front_matter("---\nid: SDD-0001\nid: SDD-0002\n---\n")
        self.assertIn("duplicate key 'id'", str(caught.exception))

    def test_valid_current_sdd_passes_without_mutating_input(self):
        result = validate_sdd(VALID)
        self.assertTrue(result.valid, result.issues)
        self.assertEqual(result.data["id"], "SDD-0001")

    def test_unsafe_path_and_task_identifier_are_rejected(self):
        text = VALID.replace("src/ice_maker/**", "../escape").replace("SDD-0001", "SDD-01")
        result = validate_sdd(text)
        codes = {issue.code for issue in result.issues}
        self.assertIn("path.traversal", codes)
        self.assertIn("id.invalid", codes)

    def test_directory_requires_all_four_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "spec.md").write_text(VALID, encoding="utf-8")
            result = validate_sdd(root)
        self.assertFalse(result.valid)
        self.assertIn("file.missing", {issue.code for issue in result.issues})

    def test_user_stories_heading_is_required_and_exact(self):
        result = validate_sdd(VALID.replace("## User stories", "## User Stories"))
        self.assertIn("content.required", {issue.code for issue in result.issues})

    def test_wrong_width_and_suffixed_task_ids_are_rejected(self):
        source = Path("specs/active/sdd-cli")
        for invalid_id in ("T-05", "T-005x"):
            with self.subTest(invalid_id=invalid_id), tempfile.TemporaryDirectory() as directory:
                root = Path(directory) / "sdd"
                shutil.copytree(source, root)
                tasks = root / "tasks.md"
                tasks.write_text(tasks.read_text(encoding="utf-8").replace("T-005", invalid_id), encoding="utf-8")
                result = validate_sdd(root)
            self.assertIn("task.id.invalid", {issue.code for issue in result.issues})

    def test_nested_and_multiline_yaml_are_rejected(self):
        for front_matter in (
            "---\nmeta:\n  nested: value\n---\n",
            "---\ntitle: |\n  multiline\n---\n",
        ):
            with self.assertRaises(ValueError):
                parse_front_matter(front_matter)

    def test_absolute_drive_and_double_slash_paths_are_rejected(self):
        for unsafe in ("/tmp/out", "C:/tmp/out", "C:\\tmp\\out", "//server/share", "src//escape"):
            result = validate_sdd(VALID.replace("src/ice_maker/**", unsafe))
            self.assertIn("path.traversal", {issue.code for issue in result.issues}, unsafe)

    def test_current_governed_sdd_directories_pass(self):
        for directory in (Path("specs/active/sdd-cli"), Path("specs/active/full-build")):
            result = validate_sdd(directory)
            self.assertTrue(result.valid, (directory, result.issues))

    def test_symlinked_sdd_directory_is_rejected_before_reading_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            shutil.copytree(Path("specs/active/sdd-cli"), target)
            linked = root / "linked"
            linked.symlink_to(target, target_is_directory=True)
            result = validate_sdd(linked)
        self.assertFalse(result.valid)
        self.assertIn("file.symlink", {issue.code for issue in result.issues})

    def test_symlinked_governed_files_are_rejected_before_reading_targets(self):
        governed = ("spec.md", "plan.md", "tasks.md", "verification.md")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in governed:
                with self.subTest(name=name):
                    sdd = root / name
                    target = root / f"target-{name}"
                    shutil.copytree(Path("specs/active/sdd-cli"), root / "sdd", dirs_exist_ok=True)
                    sdd = root / "sdd" / name
                    target.write_text(sdd.read_text(encoding="utf-8"), encoding="utf-8")
                    sdd.unlink()
                    sdd.symlink_to(target)
                    result = validate_sdd(root / "sdd")
                    self.assertFalse(result.valid)
                    self.assertIn("file.symlink", {issue.code for issue in result.issues})
                    sdd.unlink()
                    sdd.write_text(target.read_text(encoding="utf-8"), encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
