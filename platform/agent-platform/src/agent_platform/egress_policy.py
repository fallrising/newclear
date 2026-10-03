"""Narrow, node-wide public egress contract for the pinned none-lane runtime.

Policy is immutable for a node lifetime. No credential injection, wildcard,
internal override, SOCKS or live policy replacement is admitted by this slice.
"""

import hashlib
import ipaddress
import json
import re

from .domain import Problem

REVISION = "node-egress-v1"
SANDBOXD_SHA256 = "d46adf71c028d428560a50a4e7ecfe08ac3c76c20ba0712497d82441d9efd6ca"
NODE_KEYS = {
    "listen",
    "data_dir",
    "cocoon_bin",
    "advertise_addr",
    "client_advertise",
    "api_token",
    "pools",
    "max_claims",
    "max_fork_count",
    "refill_concurrency",
    "release_delay_seconds",
    "restore_mode",
    "no_balloon",
    "no_direct_io",
    "audit_log",
}


def require(value, code="egress_policy_invalid"):
    if not value:
        raise Problem(409, code)


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def policy(value):
    require(isinstance(value, dict) and set(value) == {"revision", "allow"})
    require(value["revision"] == REVISION and isinstance(value["allow"], list))
    require(len(value["allow"]) <= 32)
    seen = set()
    for rule in value["allow"]:
        require(isinstance(rule, dict) and set(rule) == {"host", "methods", "ports"})
        host = rule["host"]
        require(isinstance(host, str) and len(host) <= 253 and host == host.lower())
        # Exact ASCII DNS names only. A resolved address still faces the dial-time IP guard.
        require(
            bool(
                re.fullmatch(
                    r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+"
                    r"[a-z][a-z0-9-]{0,61}[a-z0-9]",
                    host,
                )
            )
        )
        require(not host.endswith((".localhost", ".local", ".internal")))
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            require(False)
        # CONNECT is a destination TCP grant; it does not constrain encrypted HTTP verbs.
        require(rule["ports"] in ([80], [443]))
        require(type(rule["ports"][0]) is int)
        methods = rule["methods"]
        require(
            isinstance(methods, list) and bool(methods) and all(isinstance(m, str) for m in methods)
        )
        require(len(set(methods)) == len(methods))
        require(set(methods) <= ({"GET", "HEAD"} if rule["ports"] == [80] else {"CONNECT"}))
        key = (host, rule["ports"][0])
        require(key not in seen)
        seen.add(key)
    return value


def validate_node(node, config, token):
    """Validate the actual bytes supplied to sandboxd, not a policy-shaped claim."""
    expected = policy(config.get("egress_policy"))
    require(isinstance(node, dict) and not (set(node) - NODE_KEYS), "egress_node_options_forbidden")
    origin = config["origin"]
    require(bool(re.fullmatch(r"http://127\.0\.0\.1:[1-9][0-9]{0,4}", origin)))
    require(int(origin.rsplit(":", 1)[1]) <= 65535)
    require(node.get("listen") == origin.removeprefix("http://"))
    require(node.get("client_advertise") == origin)
    require(node.get("advertise_addr") == node["listen"])
    require(node.get("data_dir") == config["sandbox_data_dir"])
    require(node.get("api_token") == token and len(token) >= 32)
    require(node.get("audit_log") is True)
    require(node.get("max_claims") == 4)
    require(
        node.get("pools")
        == [
            {
                "template": config["template"],
                "net": "none",
                "size": "large",
                "warm": 0,
                "egress": {"allow": expected["allow"]},
            }
        ],
        "egress_pool_policy_mismatch",
    )
    return digest(expected)
