"""Neutral offline identities; never an operator inventory default."""
ALIASES = tuple("lab-host-" + str(i).zfill(2) for i in range(1, 5))
TOPOLOGY = tuple((alias, "worker-" + str(i), "core" if i == 1 else "worker")
                 for i, alias in enumerate(ALIASES, 1))
WORKERS = {node: alias for alias, node, role in TOPOLOGY if role == "worker"}
CORE_ALIAS = ALIASES[0]
WORKER_ALIAS = ALIASES[3]
NODES = WORKERS


def inventory():
    return [{"alias": alias, "node": node, "role": role, "ip": "100.64.0." + str(i)}
            for i, (alias, node, role) in enumerate(TOPOLOGY, 1)]


def complete_snapshot(snapshot):
    """Supply neutral idle peers when a recovery fixture previously used one node."""
    import copy
    node_template = snapshot["nodes"][0]
    host_template = next(iter(snapshot["hosts"].values()))
    for row in inventory()[1:]:
        if not any(n["name"] == row["node"] for n in snapshot["nodes"]):
            snapshot["nodes"].append({**copy.deepcopy(node_template), "name": row["node"],
                                      "available": True, "resource_usage": "{}"})
        snapshot["hosts"].setdefault(row["alias"], copy.deepcopy(host_template))
    return snapshot
