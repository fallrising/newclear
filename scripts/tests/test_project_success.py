import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("success", Path(__file__).resolve().parents[1] / "check_project_success.py")
success = importlib.util.module_from_spec(spec)
spec.loader.exec_module(success)

def contract(mainline="incomplete", status="pending", tag="none", kind="tool"):
    return f"""---
project: tools/example
purpose: 測試工具
kind: {kind}
mainline: {mainline}
usable_tag: {tag}
reviewed: 2026-10-21
source_commit: {'a' * 40}
---
# Example
## 主線與範圍
A concrete tool.
## 驗收條件
| AC | Given / When / Then | 狀態 | 證據 |
| --- | --- | --- | --- |
| AC-01 | Given input When started Then expected output | {status} | [entry](README.md) |
| AC-02 | Given invalid input When submitted Then rejected | {status} | missing live verification |
## 現況與缺口
Not certified.
## 啟動與驗證
[entry](README.md)
## 可用版本
No published usable version.
"""

class SuccessContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.project = self.root / "tools/example"
        self.project.mkdir(parents=True)
        for name in ("README.md", "AGENTS.md"):
            (self.project / name).write_text("[status](SUCCESS.md)\n", encoding="utf-8")

    def check(self, text):
        (self.project / "SUCCESS.md").write_text(text, encoding="utf-8")
        return success.check_contract(self.root, "tools/example")[1]

    def test_incomplete_project_is_valid_without_a_release(self):
        self.assertEqual([], self.check(contract()))

    def test_completed_project_cannot_have_unpassed_criteria(self):
        self.assertIn("complete mainline has unpassed AC", self.check(contract(mainline="complete")))

    def test_tag_requires_qualification_and_completed_scope(self):
        errors = self.check(contract(tag="usable/example/v0.1.0"))
        self.assertIn("usable tag requires completed executable scope", errors)
        self.assertIn("usable tag requires a local qualification record", errors)

    def test_a_version_number_is_not_a_usable_certification(self):
        self.assertIn("invalid usable tag", self.check(contract(tag="v0.1.0")))

    def test_dangling_evidence_is_rejected(self):
        self.assertTrue(any("broken/outside" in e for e in self.check(contract().replace("(README.md)", "(missing.md)"))))

    def test_reference_has_explicit_non_runtime_status(self):
        self.assertEqual([], self.check(contract(mainline="not-applicable", kind="reference")))
        self.assertIn("not-applicable requires reference/archived kind", self.check(contract(mainline="not-applicable")))

    def test_duplicate_acceptance_ids_are_rejected(self):
        self.assertIn("duplicate AC ID", self.check(contract().replace("AC-02", "AC-01")))

    def test_missing_readme_navigation_is_rejected(self):
        (self.project / "README.md").write_text("A tool\n")
        self.assertIn("README.md must link SUCCESS.md", self.check(contract()))

    def test_new_component_is_not_silently_omitted(self):
        (self.root / "tools/new-tool").mkdir()
        found = success.discovered_projects(self.root, [{"path": "tools/example"}])
        self.assertEqual({"tools/example", "tools/new-tool"}, found)

    def test_qualification_identity_is_exact_and_unique(self):
        tag = "usable/example/v0.1.0"
        text = contract(mainline="complete", status="passed", tag=tag).replace("usable_tag:", "qualification: evidence.md\nusable_tag:")
        valid = "RESULT: PASS\nProject: tools/example\nTag: " + tag + "\nSource: " + "a" * 40 + "\nStartup: synthetic process — passed\nCore: exact output — passed\nChecks: native tests — passed\n"
        record = self.root / "evidence.md"
        record.write_text(valid)
        self.assertEqual([], self.check(text))
        for invalid in (valid.replace("RESULT: PASS", "RESULT: PASSING PRECHECK ONLY"), valid.replace("Project: tools/example", "Project: tools/example-other"), valid.replace(tag, tag + "1"), valid + "RESULT: FAIL\n", valid.replace("a" * 40, "b" * 40)):
            with self.subTest(record=invalid):
                record.write_text(invalid)
                self.assertTrue(self.check(text))

    def test_inventory_path_cannot_escape_repository(self):
        for project in ("../outside/component", "/tmp/component", "tools/../tools/example", "tools//example"):
            with self.subTest(project=project):
                self.assertTrue(success.check_contract(self.root, project)[1])

    def test_symlink_project_cannot_escape_repository(self):
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside)
            (target / "SUCCESS.md").write_text(contract().replace("tools/example", "tools/linked"))
            for name in ("README.md", "AGENTS.md"):
                (target / name).write_text("[status](SUCCESS.md)\n")
            (self.root / "tools/linked").symlink_to(target, target_is_directory=True)
            self.assertTrue(success.check_contract(self.root, "tools/linked")[1])

    def test_navigation_cannot_read_outside_symlink(self):
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside) / "AGENTS.md"
            target.write_text("[status](SUCCESS.md)\n")
            (self.project / "AGENTS.md").unlink()
            (self.project / "AGENTS.md").symlink_to(target)
            self.assertIn("AGENTS.md must link SUCCESS.md", self.check(contract()))

    def test_new_category_is_discovered(self):
        (self.root / "new-category/new-tool").mkdir(parents=True)
        found = success.discovered_projects(self.root, [{"path": "tools/example"}])
        self.assertIn("new-category/new-tool", found)

    def test_local_evidence_cannot_escape_repository(self):
        self.assertTrue(any("broken/outside" in e for e in self.check(contract().replace("(README.md)", "(../../../outside.md)"))))

if __name__ == "__main__":
    unittest.main()
