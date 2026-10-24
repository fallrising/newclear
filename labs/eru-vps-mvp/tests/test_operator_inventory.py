"""Offline private inventory injection; never contacts an operator host."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from labctl import Operator, load_inventory
from operator_inventory import load_inventory_file


def inventory(prefix="lab-host-"):
    return [{"alias": prefix + str(i).zfill(2), "node": "worker-" + str(i),
             "role": "core" if i == 1 else "worker", "ip": "100.64.0." + str(i)}
            for i in range(1, 5)]


class InventoryInjectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.path = self.project / "private/deployment-plan.json"
        self.path.parent.mkdir()

    def write(self, rows):
        self.path.write_text(json.dumps(rows))

    def test_arbitrary_reviewed_aliases_preserve_logical_nodes_and_roles(self):
        rows = inventory("operator-selected-")
        self.write(rows)
        self.assertEqual(rows, load_inventory(self.project))
        with patch("subprocess.run", side_effect=AssertionError("no remote command")):
            op = Operator(self.project)
        self.assertEqual(rows, op.inventory)
        self.assertEqual(rows[0], op.core)

    def test_each_operator_keeps_its_own_inventory_without_global_override(self):
        self.write(inventory("first-"))
        first = Operator(self.project)
        with tempfile.TemporaryDirectory() as second_dir:
            second = Path(second_dir)
            (second / "private").mkdir()
            (second / "private/deployment-plan.json").write_text(json.dumps(inventory("second-")))
            other = Operator(second)
            self.assertNotEqual(first.inventory[0]["alias"], other.inventory[0]["alias"])
            self.assertEqual("first-01", first.core["alias"])

    def test_core_and_worker_routing_use_captured_inventory(self):
        from core_patch import PatchOperator
        from component_reinstall import ComponentReinstall
        rows = inventory("reviewed-transport-")
        self.write(rows)
        op = PatchOperator(self.project)
        with patch.object(op, "command", return_value=json.dumps({
                "ActiveState": "active", "InvocationID": "fixture", "sha256": "a" * 64})) as command:
            op.core_runtime()
        self.assertEqual(rows[0]["alias"], command.call_args.args[0])
        selected = ComponentReinstall(op, target="worker-2")
        self.assertEqual(rows[1]["alias"], selected.alias)

    def test_missing_inventory_fails_before_operation_directory_is_created(self):
        with patch("subprocess.run", side_effect=AssertionError("no remote command")):
            with self.assertRaises((ValueError, OSError)):
                Operator(self.project)
        self.assertFalse((self.project / "private/operations").exists())

    def test_invalid_scope_never_reaches_remote_command(self):
        cases = []
        for kind in ("duplicate-alias", "unsafe-alias", "missing-field", "wrong-node", "wrong-role", "wrong-order", "duplicate-ip", "invalid-ip", "evidence-collision"):
            rows = inventory()
            if kind == "duplicate-alias": rows[1]["alias"] = rows[0]["alias"]
            if kind == "unsafe-alias": rows[1]["alias"] = "-oProxyCommand=unsafe"
            if kind == "missing-field": rows[1].pop("alias")
            if kind == "wrong-node": rows[1]["node"] = "worker-4"
            if kind == "wrong-role": rows[1]["role"] = "core"
            if kind == "wrong-order": rows.reverse()
            if kind == "duplicate-ip": rows[1]["ip"] = rows[0]["ip"]
            if kind == "invalid-ip": rows[1]["ip"] = "not-an-address"
            if kind == "evidence-collision": rows[1]["alias"] = "ckc-" + rows[0]["alias"]
            cases.append((kind, rows))
        for kind, rows in cases:
            with self.subTest(kind=kind):
                self.write(rows)
                with patch("subprocess.run", side_effect=AssertionError("no remote command")):
                    with self.assertRaises(ValueError):
                        Operator(self.project)
                self.assertFalse((self.project / "private/operations").exists())

    def test_duplicate_json_fields_and_symlink_inputs_fail_before_operations(self):
        self.path.write_text('[{"alias":"first","alias":"second"}]')
        with self.assertRaisesRegex(ValueError, 'duplicate fields'):
            Operator(self.project)
        self.assertFalse((self.project / 'private/operations').exists())
        actual = self.project / 'inventory.json'
        actual.write_text(json.dumps(inventory()))
        self.path.unlink()
        self.path.symlink_to(actual)
        with self.assertRaisesRegex(ValueError, 'missing or unsafe'):
            Operator(self.project)
        self.assertFalse((self.project / 'private/operations').exists())
        self.path.unlink()
        self.path.parent.rmdir()
        actual_private = self.project / 'actual-private'
        actual_private.mkdir()
        (actual_private / self.path.name).write_text(json.dumps(inventory()))
        self.path.parent.symlink_to(actual_private, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'missing or unsafe'):
            load_inventory_file(self.path)
        self.assertFalse((actual_private / 'operations').exists())

    def test_project_loader_supports_only_the_trusted_private_root_boundary(self):
        rows = inventory()
        self.write(rows)
        backing = self.project / 'private-backing'
        self.path.parent.rename(backing)
        self.path.parent.symlink_to(backing, target_is_directory=True)
        with patch('subprocess.run', side_effect=AssertionError('no remote command')):
            self.assertEqual(rows, load_inventory(self.project))
            self.assertEqual(rows, Operator(self.project).inventory)
        actual = backing / self.path.name
        actual.unlink()
        target = self.project / 'inventory.json'
        target.write_text(json.dumps(rows))
        actual.symlink_to(target)
        with self.assertRaisesRegex(ValueError, 'missing or unsafe'):
            load_inventory(self.project)

    def test_project_symlink_and_ancestor_are_not_trusted_private_roots(self):
        self.write(inventory())
        child = self.project / 'child'
        (child / 'private').mkdir(parents=True)
        (child / 'private/deployment-plan.json').write_text(json.dumps(inventory()))
        with tempfile.TemporaryDirectory() as links_dir:
            linked = Path(links_dir) / 'linked-project'
            linked.symlink_to(self.project, target_is_directory=True)
            for project in (linked, linked / 'child/..', linked / 'child'):
                with self.subTest(project=project):
                    with self.assertRaisesRegex(ValueError, 'missing or unsafe'):
                        load_inventory(project)
        self.assertFalse((self.project / 'private/operations').exists())
        self.assertFalse((child / 'private/operations').exists())

    def test_oversized_and_missing_inventory_remain_rejected(self):
        with self.path.open('wb') as stream:
            stream.truncate(16 * 1024 * 1024 + 1)
        with self.assertRaisesRegex(ValueError, 'missing or unsafe'):
            load_inventory(self.project)
        self.path.unlink()
        with self.assertRaisesRegex(ValueError, 'missing or unsafe'):
            load_inventory(self.project)
        self.assertFalse((self.project / 'private/operations').exists())


if __name__ == "__main__":
    unittest.main()
