#!/usr/bin/env python3
"""Generate private offline review bundles; never execute SSH or a runtime."""
import copy
import json
import os
from pathlib import Path
import re
import stat
import sys

import labctl

MANIFEST_KEYS = {"schema_version", "lane", "source_plan", "runtime_spec", "bundle_sha256"}
RUNTIME_KEYS = {"schema_version", "template_revision", "runtime_uid", "runtime_gid",
                "secret_revision", "mithril_image", "mithril_image_provenance"}
PROVENANCE_KEYS = {"research_commit", "binary_sha256", "platform", "evidence_reference"}
CREDENTIAL_NAMES = ("backend_proxy", "backend_replication", "backend_operator", "proxy_app", "proxy_admin")
MAX_CREDENTIAL_BYTES = 64 * 1024
DEFAULT_DISABLED = "user default reset off resetpass -@all resetkeys resetchannels"
APP_COMMANDS = "+ping +set +get +ttl +del"
# DESIGN candidates, not runtime-verified least-privilege claims. The operator
# account performs cluster administration directly, never through the app user.
BACKEND_PROXY_COMMANDS = APP_COMMANDS + " +cluster|nodes +cluster|slots +cluster|shards +asking +readonly +readwrite"
BACKEND_OPERATOR_COMMANDS = APP_COMMANDS + " +info +role +cluster +client|list +acl|whoami"
PROXY_ADMIN_COMMANDS = "+ping +info +acl|whoami +acl|log +slowlog|get +slowlog|len"


def validate_runtime(runtime_spec, plan):
    labctl.shape(runtime_spec, RUNTIME_KEYS)
    labctl.integer(runtime_spec["schema_version"], 1, 1)
    labctl.require(runtime_spec["template_revision"] == "p1b-v1", "invalid-template-revision")
    for field in ("runtime_uid", "runtime_gid"):
        labctl.integer(runtime_spec[field], 1, 2 ** 31 - 1)
    revision = runtime_spec["secret_revision"]
    labctl.require(type(revision) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", revision) is not None,
                   "invalid-secret-revision")
    image, provenance = runtime_spec["mithril_image"], runtime_spec["mithril_image_provenance"]
    if image == "UNRESOLVED" or provenance == "UNRESOLVED":
        labctl.require(image == "UNRESOLVED" and provenance == "UNRESOLVED", "incomplete-image-provenance")
    else:
        labctl.require(type(image) is str and re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,190}@sha256:[0-9a-f]{64}", image) is not None,
            "invalid-runtime-image")
        labctl.shape(provenance, PROVENANCE_KEYS)
        lock = plan["runtime_lock"]
        for field, expected in (("research_commit", lock["research_commit"]),
                                ("binary_sha256", lock["mithril_binary_sha256"]),
                                ("platform", lock["platform"])):
            labctl.require(type(provenance[field]) is str and provenance[field] == expected,
                           "image-provenance-mismatch")
        labctl.reference(provenance["evidence_reference"])
        labctl.require(provenance["evidence_reference"] != "UNRESOLVED", "incomplete-image-provenance")
    return copy.deepcopy(runtime_spec)


def build_manifest(plan, expected_plan_digest, runtime_spec):
    """Bind validated declarations, without upgrading the fixture evidence lane."""
    plan = labctl.validate_plan(plan, expected_plan_digest)
    labctl.require(plan["executable"], "draft-source-plan-refused")
    manifest = {"schema_version": 1, "lane": "offline-bundle",
                "source_plan": copy.deepcopy(plan), "runtime_spec": validate_runtime(runtime_spec, plan)}
    manifest["bundle_sha256"] = labctl.digest(manifest)
    return manifest


def validate_manifest(manifest, expected_bundle_digest):
    """Reconstruct exact semantics; a recomputed unkeyed hash grants no authority."""
    labctl.shape(manifest, MANIFEST_KEYS)
    labctl.require(type(expected_bundle_digest) is str and labctl.HEX.fullmatch(expected_bundle_digest) is not None,
                   "invalid-bundle-digest")
    labctl.require(manifest["bundle_sha256"] == expected_bundle_digest, "bundle-digest-mismatch")
    plan = manifest["source_plan"]
    labctl.require(type(plan) is dict and "plan_sha256" in plan, "invalid-source-plan")
    derived = build_manifest(plan, plan["plan_sha256"], manifest["runtime_spec"])
    labctl.require(labctl.canonical(manifest) == labctl.canonical(derived), "bundle-semantic-mismatch")
    return derived


def validate_credentials(credentials):
    labctl.shape(credentials, {"schema_version", *CREDENTIAL_NAMES})
    labctl.integer(credentials["schema_version"], 1, 1)
    for name in CREDENTIAL_NAMES:
        value = credentials[name]
        # Common unquoted subset of Redis config/ACL and Mithril's whitespace
        # parser. Excludes comments, quotes, escapes, rule operators and shells.
        labctl.require(type(value) is str and re.fullmatch(r"[A-Za-z0-9_-]{1,256}", value) is not None,
                       "invalid-credentials")
    labctl.require(len({credentials[name] for name in CREDENTIAL_NAMES}) == 5, "duplicate-credentials")
    return dict(credentials)


class Bundle:
    """Private in-memory result. repr deliberately excludes all bound contents."""
    def __init__(self, manifest, hosts, files, credentials):
        self.manifest = manifest
        self.hosts = hosts
        self.files = files
        self._credentials = credentials
        self.classification = "draft" if manifest["runtime_spec"]["mithril_image"] == "UNRESOLVED" else "review-only"
        self.live_ready = False
        self.live_runtime = "UNEXECUTED"

    def __repr__(self):
        return "<PrivateOfflineBundle>"


def labels(manifest, role):
    plan = manifest["source_plan"]
    return {"io.mithril-research.run": plan["run_id"],
            "io.mithril-research.plan": plan["plan_sha256"],
            "io.mithril-research.bundle": manifest["bundle_sha256"],
            "io.mithril-research.role": role}


def mount(source, target, readonly):
    return {"type": "bind", "source": source, "target": target,
            "read_only": readonly, "bind": {"create_host_path": False}}


def compose_service(manifest, host, node):
    plan, runtime = manifest["source_plan"], manifest["runtime_spec"]
    role, root = node["role"], host["data_root"]
    proxy = role == "A"
    filename = "mithril.conf" if proxy else "redis.conf"
    mounts = [mount(f"{root}/config/{role}/{filename}", "/config/" + filename, True)]
    if not proxy:
        mounts.extend([mount(f"{root}/config/{role}/users.acl", "/config/users.acl", True),
                       mount(f"{root}/data/{role}", "/data", False)])
    return {"image": runtime["mithril_image"] if proxy else plan["runtime_lock"]["redis_image"],
            "platform": plan["runtime_lock"]["platform"],
            "user": f"{runtime['runtime_uid']}:{runtime['runtime_gid']}",
            "entrypoint": ["mithril" if proxy else "redis-server"],
            "command": ["/config/" + filename], "network_mode": "host",
            "read_only": True, "cap_drop": ["ALL"],
            "security_opt": ["no-new-privileges:true"], "pids_limit": 128,
            "mem_limit": str(plan["caps"]["proxy_memory_mib" if proxy else "redis_memory_mib"]) + "m",
            "logging": {"driver": "json-file", "options": {"max-size": "10m", "max-file": "3"}},
            "restart": "no", "stop_grace_period": "15s", "volumes": mounts,
            "tmpfs": ["/tmp:size=16m,mode=1777"], "labels": labels(manifest, role)}


def redis_config(plan, host, node, credentials):
    caps = plan["caps"]
    lines = [f"bind {host['tailnet_ipv4']}", "protected-mode yes", f"port {node['port']}",
             "daemonize no", 'logfile ""', "dir /data", "cluster-enabled yes",
             "cluster-config-file /data/nodes.conf", f"cluster-port {node['bus_port']}",
             f"cluster-announce-ip {host['tailnet_ipv4']}", f"cluster-announce-port {node['port']}",
             f"cluster-announce-bus-port {node['bus_port']}", "appendonly yes",
             "appendfsync everysec", "appenddirname appendonlydir", 'save ""',
             f"maxmemory {caps['redis_maxmemory_mib']}mb", "maxmemory-policy noeviction",
             f"maxclients {caps['maxclients']}", "aclfile /config/users.acl",
             "masteruser backend_replication", "masterauth " + credentials["backend_replication"]]
    # Role/replica associations are declarations in the bound topology only:
    # cluster formation must use actual node IDs in later approved tooling.
    return "\n".join(lines) + "\n"


def backend_acl(plan, credentials):
    prefix = plan["run_id"] + ":*"
    return "\n".join([
        DEFAULT_DISABLED,
        f"user backend_proxy reset on >{credentials['backend_proxy']} ~{prefix} resetchannels -@all {BACKEND_PROXY_COMMANDS}",
        f"user backend_replication reset on >{credentials['backend_replication']} resetkeys resetchannels -@all +ping +psync +replconf",
        f"user backend_operator reset on >{credentials['backend_operator']} ~{prefix} resetchannels -@all {BACKEND_OPERATOR_COMMANDS}",
    ]) + "\n"


def mithril_config(plan, hosts, credentials):
    caps, address = plan["caps"], hosts["H4"]["tailnet_ipv4"]
    bootstrap = ",".join(f"{hosts['H' + str(i)]['tailnet_ipv4']}:17001" for i in range(1, 4))
    return "\n".join([
        f"bind {address}", "port 17979", f"announce-addr {address}:17979", f"bootstrap {bootstrap}",
        f"worker-threads {caps['proxy_workers']}", f"backend-conns {caps['backend_conns']}",
        f"maxclients {caps['maxclients']}", f"query-buffer-limit {caps['query_buffer_mib']}mb",
        "backend-sharding no", "reply-cache no", "slave-mode off", "acl-pubsub-default resetchannels",
        DEFAULT_DISABLED, "backend-auth-user backend_proxy", "backend-auth-pass " + credentials["backend_proxy"],
        f"user proxy_app reset on >{credentials['proxy_app']} ~{plan['run_id']}:* resetchannels -@all {APP_COMMANDS}",
        f"user proxy_admin reset on >{credentials['proxy_admin']} resetkeys resetchannels -@all {PROXY_ADMIN_COMMANDS}",
    ]) + "\n"


def build_bundle(plan, expected_plan_digest, runtime_spec, credentials):
    """Pure renderer. Does no filesystem, subprocess, network or runtime I/O."""
    manifest = build_manifest(plan, expected_plan_digest, runtime_spec)
    credentials = validate_credentials(credentials)
    plan = manifest["source_plan"]
    hosts = {host["role"]: host for host in plan["inventory"]["hosts"]}
    documents, files = {}, {}
    for host_role, host in hosts.items():
        document = {"services": {}}
        if host_role == "H4" and runtime_spec["mithril_image"] == "UNRESOLVED":
            document["x-mithril-draft"] = {"classification": "draft", "reason": "mithril-image-unresolved",
                                          "live_ready": False, "live_runtime": "UNEXECUTED"}
        else:
            for node in plan["topology"]:
                if node["host"] == host_role:
                    document["services"][node["role"]] = compose_service(manifest, host, node)
        documents[host_role] = document
    for node in plan["topology"]:
        if node["role"] != "A":
            base = f"{node['host']}/config/{node['role']}/"
            files[base + "redis.conf"] = redis_config(plan, hosts[node["host"]], node, credentials)
            files[base + "users.acl"] = backend_acl(plan, credentials)
    files["H4/config/A/mithril.conf"] = mithril_config(plan, hosts, credentials)
    return Bundle(manifest, documents, files, credentials)


def _verified_bundle(bundle):
    labctl.require(type(bundle) is Bundle, "invalid-bundle")
    labctl.shape(bundle.manifest, MANIFEST_KEYS)
    manifest = validate_manifest(bundle.manifest, bundle.manifest.get("bundle_sha256"))
    plan = manifest["source_plan"]
    derived = build_bundle(plan, plan["plan_sha256"], manifest["runtime_spec"], bundle._credentials)
    # Revalidate even rendered filenames and labels before any writes. No file
    # hashes are published; in particular secret-bearing configs are not hashed.
    for field in ("manifest", "hosts", "files", "classification", "live_ready", "live_runtime"):
        labctl.require(labctl.canonical(getattr(bundle, field)) == labctl.canonical(getattr(derived, field)),
                       "rendered-bundle-mismatch")
    return derived


def _output_path(output_path, plan):
    path = Path(output_path)
    labctl.require(path.is_absolute() and ".." not in path.parts and str(path) == os.path.normpath(str(path)),
                   "unsafe-output-path")
    labctl.outside_source(path)
    labctl.require(path != Path("/"), "unsafe-output-path")
    for host in plan["inventory"]["hosts"]:
        remote = Path(host["data_root"])
        labctl.require(path != remote and remote not in path.parents and path not in remote.parents,
                       "remote-intent-output-path")
    return path


def _private_directory(fd):
    info = os.fstat(fd)
    labctl.require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
                   and stat.S_IMODE(info.st_mode) == 0o700, "unsafe-private-directory")
    return info


def _save_file(rootfd, relative, payload):
    """Fixed generated relative names, new private files, no-follow descriptors."""
    parts = relative.split("/")
    labctl.require(all(re.fullmatch(r"[A-Za-z0-9_.-]+", p) and p not in {".", ".."} for p in parts),
                   "invalid-output-name")
    data = payload.encode("utf-8")
    labctl.require(len(data) <= labctl.MAX_BYTES, "output-limit")
    dirfd = os.dup(rootfd)
    try:
        for part in parts[:-1]:
            try:
                os.mkdir(part, 0o700, dir_fd=dirfd)
            except FileExistsError:
                pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dirfd)
            os.close(dirfd)
            dirfd = child
            _private_directory(dirfd)
        fd = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=dirfd)
        try:
            info = labctl.file_stat(fd, private=True)
            labctl.require(info.st_size == 0, "unsafe-output-file")
            with os.fdopen(fd, "wb", closefd=False) as stream:
                stream.write(data)
                stream.flush()
                os.fsync(fd)
        finally:
            os.close(fd)
        os.fsync(dirfd)
    finally:
        os.close(dirfd)


def summary(bundle):
    return {"lane": "offline-bundle", "classification": bundle.classification,
            "hosts": 4, "redis_nodes": 6, "proxy_configs": 1,
            "live_ready": False, "live_runtime": "UNEXECUTED"}


def write_bundle(bundle, output_path):
    """Write an exclusively new private directory; retain partial output on error."""
    bundle = _verified_bundle(bundle)
    path = _output_path(output_path, bundle.manifest["source_plan"])
    try:
        with labctl.directory(path.parent) as parentfd:
            _private_directory(parentfd)
            os.mkdir(path.name, 0o700, dir_fd=parentfd)
            rootfd = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parentfd)
            try:
                rootinfo = _private_directory(rootfd)
                payloads = {"manifest.json": labctl.canonical(bundle.manifest).decode("ascii") + "\n"}
                payloads.update({f"{host}/compose.json": labctl.canonical(document).decode("ascii") + "\n"
                                 for host, document in bundle.hosts.items()})
                payloads.update(bundle.files)
                for name, payload in sorted(payloads.items()):
                    current = os.stat(path.name, dir_fd=parentfd, follow_symlinks=False)
                    labctl.require((rootinfo.st_dev, rootinfo.st_ino) == (current.st_dev, current.st_ino),
                                   "output-path-replaced")
                    _save_file(rootfd, name, payload)
                os.fsync(rootfd)
                os.fsync(parentfd)
            finally:
                os.close(rootfd)
    except OSError:
        raise labctl.LabError("unsafe-or-unwritable-output") from None
    return summary(bundle)


def load_credentials(path):
    """Credentials enter through one bounded private regular file, never argv/env."""
    path = Path(path)
    labctl.require(".." not in path.parts, "unsafe-credential-input")
    try:
        with labctl.directory(path.parent) as parentfd:
            _private_directory(parentfd)
            fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parentfd)
            try:
                info = labctl.file_stat(fd, private=True)
                labctl.require(info.st_size <= MAX_CREDENTIAL_BYTES, "credential-input-limit")
                with os.fdopen(fd, "rb", closefd=False) as stream:
                    raw = stream.read(MAX_CREDENTIAL_BYTES + 1)
                labctl.require(len(raw) <= MAX_CREDENTIAL_BYTES, "credential-input-limit")
                return validate_credentials(labctl.decode(raw))
            finally:
                os.close(fd)
    except OSError:
        raise labctl.LabError("unsafe-or-unreadable-credentials") from None


class Parser(labctl.Parser):
    def print_help(self, file=None):
        print(json.dumps({"lane": "offline-bundle", "result": "help",
                          "usage": "--plan FILE --expected-plan-digest SHA256 --runtime-spec FILE --credentials FILE --output NEW_PRIVATE_DIR",
                          "live_ready": False, "live_runtime": "UNEXECUTED"}), file=file)


def main(argv=None):
    try:
        parser = Parser(description=__doc__)
        parser.add_argument("--plan", required=True)
        parser.add_argument("--expected-plan-digest", required=True)
        parser.add_argument("--runtime-spec", required=True)
        parser.add_argument("--credentials", required=True)
        parser.add_argument("--output", required=True)
        args = parser.parse_args(argv)
        result = build_bundle(labctl.load_json(args.plan), args.expected_plan_digest,
                              labctl.load_json(args.runtime_spec), load_credentials(args.credentials))
        print(labctl.canonical(write_bundle(result, args.output)).decode("ascii"))
        return 0
    except (labctl.LabError, OSError, ValueError, TypeError, RecursionError):
        # Fixed text only: never serialize credentials, paths or parser diagnostics.
        print(json.dumps({"lane": "offline-bundle", "result": "error", "error": "bundle-refused",
                          "live_ready": False, "live_runtime": "UNEXECUTED"}, sort_keys=True))
        return 2


if __name__ == "__main__":
    sys.exit(main())
