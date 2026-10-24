"""Pure, fail-closed review configuration/resource checks; no Docker mutation."""
from copy import deepcopy
from pathlib import Path
import re

SERVICES = frozenset(("kafka", "postgres", "console-api", "gateway-produce", "gateway-consume", "scheduler", "console-web", "prometheus", "alertmanager", "grafana", "push-sink"))
BUILT = frozenset(("console-api", "gateway-produce", "gateway-consume", "scheduler", "console-web"))
VOLUMES = frozenset(("kafka-data", "postgres-data", "prometheus-data", "grafana-data"))
ENV_KEYS = {
    "postgres": {"POSTGRES_USER": "FE_REVIEW_DB_USER", "POSTGRES_PASSWORD": "FE_REVIEW_DB_PASSWORD"},
    "console-api": {"OJBQUAY_DATABASE_USER": "FE_REVIEW_DB_USER", "OJBQUAY_DATABASE_PASSWORD": "FE_REVIEW_DB_PASSWORD", "OJBQUAY_ADMIN_USERNAME": "FE_REVIEW_ADMIN_USER", "OJBQUAY_ADMIN_PASSWORD": "FE_REVIEW_ADMIN_PASSWORD"},
    "scheduler": {"OJBQUAY_DATABASE_USER": "FE_REVIEW_DB_USER", "OJBQUAY_DATABASE_PASSWORD": "FE_REVIEW_DB_PASSWORD"},
    "grafana": {"GF_SECURITY_ADMIN_USER": "FE_REVIEW_GRAFANA_USER", "GF_SECURITY_ADMIN_PASSWORD": "FE_REVIEW_GRAFANA_PASSWORD"},
}


def require(value, code):
    if not value:
        raise ValueError("REVIEW_" + code)


def identity(run, source):
    require(re.fullmatch(r"fe-ojb-[0-9a-f]{16}", run), "RUN_ID")
    require(re.fullmatch(r"[0-9a-f]{40}", source), "SOURCE")
    return {"fe.review.run": run, "fe.review.source": source}


def require_fresh_inventory(resources):
    require(isinstance(resources, list) and not resources, "EXISTING_PROJECT")


def private_root(path, uid):
    p = Path(path)
    require(p.is_absolute() and p.resolve() == p and not p.is_symlink(), "PRIVATE_PATH")
    st = p.stat()
    require(p.is_dir() and st.st_uid == uid and st.st_mode & 0o777 == 0o700, "PRIVATE_MODE")
    require(not any(p.iterdir()), "PRIVATE_NOT_EMPTY")
    return p


def checked_config(base, model, run, source, credentials):
    """Compare privately resolved base/overlay models; never return secret values."""
    labels = identity(run, source)
    require(model.get("name") == base.get("name") == run, "PROJECT_NAME")
    require(set(base.get("services", {})) == set(model.get("services", {})) == SERVICES, "SERVICES")
    require(set(base.get("volumes", {})) == set(model.get("volumes", {})) == VOLUMES, "VOLUMES")
    require(set(base.get("networks", {})) == set(model.get("networks", {})) == {"default"}, "NETWORKS")
    require(set(model) == set(base) | {"x-review-labels"}, "TOP_LEVEL")
    require(model.get("x-review-labels") == labels, "REVIEW_EXTENSION")
    for key in set(base) - {"services", "volumes", "networks"}:
        require(model[key] == base[key], "TOP_LEVEL_DELTA")
    for name, service in model["services"].items():
        before = base["services"][name]
        require(not service.get("ports"), "PUBLISHED_PORTS")
        require(not service.get("network_mode") and set(service.get("networks", {})) == {"default"}, "SERVICE_NETWORK")
        require(not service.get("privileged") and not service.get("devices"), "SERVICE_PRIVILEGE")
        require(service.get("labels") == {**before.get("labels", {}), **labels}, "SERVICE_LABELS")
        expected = deepcopy(before)
        expected.pop("ports", None)
        expected["labels"] = service["labels"]
        if name in BUILT:
            expected["image"] = f"fe-review-ojb/{name}:{run}"
        for key, variable in ENV_KEYS.get(name, {}).items():
            value = credentials.get(variable)
            require(isinstance(value, str) and len(value) >= 16, "FRESH_CREDENTIAL")
            require(value != before.get("environment", {}).get(key), "REUSED_CREDENTIAL")
            expected.setdefault("environment", {})[key] = value
        if name == "postgres":
            expected["healthcheck"]["test"] = ["CMD-SHELL", 'pg_isready -U "$${POSTGRES_USER}" -d ojbquay']
        actual = deepcopy(service)
        actual.pop("ports", None)
        require(actual == expected, "SERVICE_DELTA")
        # Bind mounts may only be the original read-only deployment configuration.
        for mount in service.get("volumes", []):
            require(mount.get("type") in {"bind", "volume"}, "MOUNT_TYPE")
            if mount["type"] == "bind":
                require(mount.get("read_only") is True and "docker.sock" not in mount.get("source", ""), "BIND_MOUNT")
            else:
                require(mount.get("source") in VOLUMES, "FOREIGN_VOLUME")
    for kind in ("volumes", "networks"):
        for name, resource in model[kind].items():
            before = base[kind][name]
            require(not resource.get("external"), "EXTERNAL_RESOURCE")
            require(resource.get("name") == f"{run}_{name}", "RESOURCE_NAME")
            expected = {**before, "labels": {**before.get("labels", {}), **labels}}
            require(resource == expected, "RESOURCE_DELTA")
    return {"project": run, "services": sorted(SERVICES), "publishedPorts": 0, "volumes": sorted(VOLUMES), "network": run + "_default", "source": source}


def checked_resources(records, run, source):
    """Normalized Docker inspect records. Unknown types/IDs/labels fail closed."""
    labels = identity(run, source)
    require(isinstance(records, list) and records, "RESOURCE_INVENTORY")
    keys = set()
    for r in records:
        require(r.get("kind") in {"container", "network", "volume"}, "RESOURCE_KIND")
        require(isinstance(r.get("id"), str) and bool(r["id"]), "RESOURCE_ID")
        key = (r["kind"], r["id"])
        require(key not in keys, "DUPLICATE_RESOURCE")
        keys.add(key)
        actual = r.get("labels", {})
        require(all(actual.get(k) == v for k, v in labels.items()), "RESOURCE_OWNER")
        require(actual.get("com.docker.compose.project") == run, "COMPOSE_OWNER")
        if r["kind"] == "container":
            require(actual.get("com.docker.compose.service") in SERVICES, "FOREIGN_SERVICE")
            require(not r.get("publishedPorts") and r.get("networkMode") != "host", "RESOURCE_EXPOSURE")
        if r["kind"] == "network":
            require(actual.get("com.docker.compose.network") == "default", "NETWORK_OWNER")
        if r["kind"] == "volume":
            require(actual.get("com.docker.compose.volume") in VOLUMES, "VOLUME_OWNER")
    return keys


def cleanup_plan(owned, current, run, source):
    """Require the exact recorded set and fresh ownership before each cleanup batch.

    Callers remove only these IDs/names, then verify absence. If an earlier cleanup
    already removed items, pass only the still-owned recorded subset, never infer
    ownership for newly discovered resources. Network member checks are mandatory.
    """
    keys = checked_resources(owned, run, source)
    require(checked_resources(current, run, source) == keys, "CLEANUP_ID_DRIFT")
    old = {(r["kind"], r["id"]): r for r in owned}
    container_ids = {r["id"] for r in owned if r["kind"] == "container"}
    for r in current:
        require(r["labels"] == old[(r["kind"], r["id"])]["labels"], "CLEANUP_LABEL_DRIFT")
        if r["kind"] == "network":
            require(set(r.get("members", [])) <= container_ids, "FOREIGN_NETWORK_MEMBER")
    return [{"kind": r["kind"], "id": r["id"]} for kind in ("container", "network", "volume") for r in current if r["kind"] == kind]
