import copy
import unittest
from ownership import BUILT, ENV_KEYS, SERVICES, VOLUMES, checked_config, cleanup_plan, identity, require_fresh_inventory

RUN = "fe-ojb-0123456789abcdef"
SOURCE = "a" * 40


def models():
    labels = identity(RUN, SOURCE)
    credentials = {v: "fresh-synthetic-" + v.lower() for keys in ENV_KEYS.values() for v in keys.values()}
    base = {"name": RUN, "services": {}, "volumes": {}, "networks": {"default": {"name": RUN + "_default"}}}
    for name in SERVICES:
        base["services"][name] = {"image": "original:" + name, "networks": {"default": None}, "ports": [{"target": 8080, "published": "8080"}], "environment": {k: "old" for k in ENV_KEYS.get(name, {})}}
    base["services"]["postgres"]["healthcheck"] = {"test": ["CMD-SHELL", "pg_isready -U old -d ojbquay"], "retries": 12}
    base["volumes"] = {v: {"name": RUN + "_" + v} for v in VOLUMES}
    model = copy.deepcopy(base)
    model["x-review-labels"] = labels.copy()
    for name, s in model["services"].items():
        s.pop("ports")
        s["labels"] = labels.copy()
        if name in BUILT:
            s["image"] = f"fe-review-ojb/{name}:{RUN}"
        s["environment"].update({k: credentials[v] for k, v in ENV_KEYS.get(name, {}).items()})
    model["services"]["postgres"]["healthcheck"]["test"] = ["CMD-SHELL", 'pg_isready -U "$${POSTGRES_USER}" -d ojbquay']
    for kind in ("volumes", "networks"):
        for r in model[kind].values():
            r["labels"] = labels.copy()
    return base, model, credentials


def resources():
    common = {**identity(RUN, SOURCE), "com.docker.compose.project": RUN}
    return [
        {"kind": "container", "id": "owned-container", "labels": {**common, "com.docker.compose.service": "postgres"}, "networkMode": RUN + "_default", "publishedPorts": []},
        {"kind": "network", "id": "owned-network", "labels": {**common, "com.docker.compose.network": "default"}, "members": ["owned-container"]},
        {"kind": "volume", "id": RUN + "_postgres-data", "labels": {**common, "com.docker.compose.volume": "postgres-data"}},
    ]


class OwnershipTests(unittest.TestCase):
    def test_valid_overlay_and_exact_cleanup(self):
        base, model, credentials = models()
        self.assertEqual(checked_config(base, model, RUN, SOURCE, credentials)["publishedPorts"], 0)
        self.assertEqual(len(cleanup_plan(resources(), resources(), RUN, SOURCE)), 3)
        require_fresh_inventory([])

    def test_existing_project_rejected(self):
        with self.assertRaisesRegex(ValueError, "EXISTING_PROJECT"):
            require_fresh_inventory([{"id": "already-there"}])

    def test_configuration_rejects_exposure_foreign_resources_and_topology_changes(self):
        changes = [
            lambda m: m.update({"x-unapproved": {"field": "extra"}}),
            lambda m: m["x-review-labels"].update({"fe.review.run": "foreign"}),
            lambda m: m["services"]["console-api"].update(ports=[{"published": "8080"}]),
            lambda m: m["volumes"]["postgres-data"].update(external=True),
            lambda m: m["networks"]["default"].update(external=True),
            lambda m: m["services"]["console-api"].update(network_mode="host"),
            lambda m: m["services"]["console-api"].update(command=["different-server"]),
            lambda m: m["services"]["console-api"]["labels"].update({"fe.review.run": "other"}),
            lambda m: m["services"]["postgres"]["environment"].update(POSTGRES_PASSWORD="old"),
        ]
        for change in changes:
            with self.subTest(change=changes.index(change)):
                base, model, credentials = models()
                change(model)
                with self.assertRaises(ValueError):
                    checked_config(base, model, RUN, SOURCE, credentials)

    def test_cleanup_rejects_foreign_ids_labels_and_bridge_members(self):
        changes = [
            lambda r: r[0].update(id="replacement-container"),
            lambda r: r[0]["labels"].update({"fe.review.run": "foreign"}),
            lambda r: r[0]["labels"].update({"other-label": "changed"}),
            lambda r: r[1]["members"].append("foreign-container"),
            lambda r: r.append(copy.deepcopy(r[0])),
        ]
        for change in changes:
            with self.subTest(change=changes.index(change)):
                observed = resources()
                change(observed)
                with self.assertRaises(ValueError):
                    cleanup_plan(resources(), observed, RUN, SOURCE)


if __name__ == "__main__":
    unittest.main()
