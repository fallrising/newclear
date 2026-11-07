"""Immutable, revision-pinned source and Graphify index caches.

The cache is for one trusted local user on a POSIX filesystem.  File locks
serialize cooperating writers; they are not a security boundary against another
process that can modify the cache.  Nothing here executes the indexed project.
"""
from __future__ import annotations

import contextlib
import fcntl
import hashlib
import importlib.metadata
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import unquote, urlsplit


PINNED_GRAPHIFY_VERSION = "0.9.97"
CACHE_SCHEMA = 1
INDEX_SCHEMA = 2
_GIT_LOCATION_VARIABLES = (
    "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
)


class CacheError(RuntimeError):
    """An unavailable, changed, or invalid source/index must not count as a hit."""


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_json(path: Path) -> dict:
    if path.is_symlink():
        raise CacheError(f"cache metadata cannot be a symlink: {path.name}")
    try:
        result = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(result, dict):
            raise ValueError("expected an object")
        return result
    except (OSError, ValueError) as exc:
        raise CacheError(f"invalid cache metadata: {path.name}") from exc


def _write_json(path: Path, value: object) -> None:
    # Called only inside an unpublished directory, under its publication lock.
    path.write_text(_json(value) + "\n", encoding="utf-8")


@contextlib.contextmanager
def _lock(cache: Path, key: str):
    directory = cache / "locks"
    directory.mkdir(parents=True, exist_ok=True)
    lock_path = directory / f"{key}.lock"
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "a+b") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


def _cache_root(path: Path) -> Path:
    result = Path(path).expanduser().resolve()
    result.mkdir(parents=True, exist_ok=True)
    for name in ("sources", "indexes", "locks"):
        child = result / name
        if child.is_symlink():
            raise CacheError(f"cache directory cannot be a symlink: {name}")
        child.mkdir(exist_ok=True)
    return result


def _subdir(value: str) -> str:
    path = PurePosixPath(value)
    if not value or path.is_absolute() or ".." in path.parts or "\\" in value:
        raise CacheError("subdir must be a relative path without '..'")
    return str(path)


def _reference(reference: dict, allow_local: bool) -> tuple[str, str, str]:
    url = reference.get("url", "")
    commit = reference.get("commit", "")
    subdir = _subdir(reference.get("subdir", "."))
    if not isinstance(url, str) or not isinstance(commit, str):
        raise CacheError("reference URL and commit must be strings")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise CacheError("reference commit must be a complete lowercase SHA-1")
    parts = urlsplit(url)
    if parts.username or parts.password or parts.query or parts.fragment:
        raise CacheError("reference URL cannot contain credentials, query, or fragment")
    if parts.scheme == "file" and allow_local:
        if parts.netloc or not Path(unquote(parts.path)).is_absolute():
            raise CacheError("test file URL must identify an absolute local path")
    elif parts.scheme == "https" and parts.hostname and parts.path not in ("", "/"):
        if parts.port not in (None, 443):
            raise CacheError("reference URL must use HTTPS port 443")
        host = parts.hostname.lower()
        if host in ("localhost",) or host.endswith((".localhost", ".local")):
            raise CacheError("reference URL must name a public repository")
        try:
            if not ipaddress.ip_address(host).is_global:
                raise CacheError("reference URL must name a public repository")
        except ValueError:
            pass  # A DNS name; resolution and transport remain Git's responsibility.
    else:
        raise CacheError("reference URL must use HTTPS (local files require allow_local=True)")
    return url, commit, subdir


def _git(root: Path, *arguments: str, timeout: int = 120) -> str:
    command = ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
               "-c", "advice.detachedHead=false", *arguments]
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    # An inherited GIT_DIR/WORK_TREE can redirect validation to a different repo.
    for key in _GIT_LOCATION_VARIABLES:
        env.pop(key, None)
    try:
        result = subprocess.run(command, cwd=root, env=env, text=True,
                                capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise CacheError(f"git {arguments[0]} could not finish") from exc
    if result.returncode:
        # URLs never contain credentials; preserve useful transport diagnostics.
        raise CacheError(f"git {arguments[0]} failed: {result.stderr.strip()[-2000:]}")
    return result.stdout.strip()


def _inside(root: Path, candidate: Path) -> Path:
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root.resolve(strict=True))
    except (OSError, ValueError, RuntimeError) as exc:
        raise CacheError("source path or symlink escapes its checkout") from exc
    return resolved


def _check_links(root: Path) -> None:
    for directory, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [name for name in dirs if name != ".git"]
        for name in [*dirs, *files]:
            path = Path(directory) / name
            if path.is_symlink():
                _inside(root, path)


def _validate_checkout(root: Path, url: str, commit: str, subdir: str) -> Path:
    if root.is_symlink() or not (root / ".git").is_dir() or (root / ".git").is_symlink():
        raise CacheError("source cache is not an owned Git checkout")
    if _git(root, "rev-parse", "HEAD") != commit:
        raise CacheError("source cache revision differs from the pinned commit")
    if _git(root, "remote", "get-url", "origin") != url:
        raise CacheError("source cache origin differs from the pinned URL")
    if _git(root, "status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"):
        raise CacheError("source cache is dirty; keep references immutable")
    _check_links(root)
    source = _inside(root, root / subdir)
    if not source.is_dir():
        raise CacheError("reference subdir must be a directory")
    return source


def prepare_reference(reference: dict, cache_root: Path, offline: bool = False, *,
                      allow_local: bool = False) -> dict:
    """Fetch an exact commit once and validate every reuse, without pulling.

    ``allow_local`` exists for offline, real-Git regression tests.  User-facing
    manifests should keep the default HTTPS-only policy.  Different subdirs of
    the same URL/commit intentionally reuse one checkout.
    """
    started = time.perf_counter()
    url, commit, subdir = _reference(reference, allow_local)
    cache = _cache_root(cache_root)
    identity = {"schema": CACHE_SCHEMA, "url": url, "commit": commit}
    source_id = _digest(_json(identity).encode())
    entry = cache / "sources" / source_id
    with _lock(cache, f"source-{source_id}"):
        hit = entry.exists()
        if entry.is_symlink():
            raise CacheError("source cache entry cannot be a symlink")
        if hit:
            if _read_json(entry / "source.json") != identity:
                raise CacheError("source cache identity metadata mismatch")
        else:
            if offline:
                raise CacheError("pinned reference is absent from the offline cache")
            temporary = Path(tempfile.mkdtemp(prefix=f".build-{source_id[:12]}-",
                                             dir=entry.parent))
            try:
                root = temporary / "source"
                root.mkdir()
                _git(root, "init", "--quiet")
                _git(root, "remote", "add", "origin", url)
                _git(root, "fetch", "--depth=1", "--no-tags", "origin", commit)
                _git(root, "checkout", "--quiet", "--detach", commit)
                _validate_checkout(root, url, commit, subdir)
                _write_json(temporary / "source.json", identity)
                temporary.rename(entry)
            finally:
                if temporary.exists():
                    shutil.rmtree(temporary)
        root = entry / "source"
        source = _validate_checkout(root, url, commit, subdir)
    return {"source": str(source), "root": str(root), "cache_hit": hit,
            "source_id": source_id, "commit": commit, "url": url,
            "seconds": time.perf_counter() - started}


def source_fingerprint(source: Path) -> dict:
    """Hash names and bytes, excluding only Git metadata, never mtimes.

    Directory symlinks are rejected because recursive graph discovery may not
    follow them consistently.  Internal file symlinks are bounded and hashed.
    """
    source = Path(source).resolve(strict=True)
    if not source.is_dir():
        raise CacheError("source must be a directory")
    digest = hashlib.sha256()
    total_bytes = 0
    count = 0
    for directory, dirs, files in os.walk(source, followlinks=False):
        dirs[:] = sorted(name for name in dirs if name != ".git")
        for name in dirs:
            path = Path(directory) / name
            if path.is_symlink():
                _inside(source, path)
                raise CacheError("directory symlinks are unsupported in indexed sources")
        for name in sorted(files):
            if name == ".git":
                continue
            path = Path(directory) / name
            if path.is_symlink():
                _inside(source, path)
            if not path.is_file():
                raise CacheError("indexed sources must contain only regular files")
            data = path.read_bytes()
            relative = path.relative_to(source).as_posix()
            digest.update(_json([relative, len(data), _digest(data)]).encode() + b"\n")
            total_bytes += len(data)
            count += 1
    return {"sha256": digest.hexdigest(), "files": count, "bytes": total_bytes}


def runtime_identity() -> dict:
    """Bind indexes to the installed toolchain and the checked-in lock file."""
    try:
        version = importlib.metadata.version("graphifyy")
    except importlib.metadata.PackageNotFoundError as exc:
        raise CacheError("install the pinned Graphify dependencies first") from exc
    if version != PINNED_GRAPHIFY_VERSION:
        raise CacheError(f"Graphify version must be {PINNED_GRAPHIFY_VERSION}, got {version}")
    lock = Path(__file__).resolve().parents[1] / "requirements.lock"
    if not lock.is_file():
        raise CacheError("requirements.lock is missing")
    packages = sorted((dist.metadata["Name"].lower().replace("_", "-"), dist.version)
                      for dist in importlib.metadata.distributions())
    return {"graphify": version, "python": list(sys.version_info[:3]),
            "packages": packages, "lock_sha256": _digest(lock.read_bytes())}


def _configuration_file(path: Path, source: Path) -> dict:
    """Record presence as well as bytes: adding an ignore file changes inputs."""
    result = {"path": os.path.relpath(path, source), "state": "absent"}
    if path.is_file():
        result.update(state="file", sha256=_digest(path.read_bytes()))
        if path.is_symlink():
            result["target"] = os.path.relpath(path.resolve(), source)
    return result


def _js_scope(source: Path) -> list[dict]:
    """Bound cached JS resolution without implementing another resolver.

    Upstream's JS resolver searches beyond the Git root and may follow workspace
    globs, TS extends/references, path mappings and installed packages.  Cached
    JS indexes here require those inputs to live inside the scanned directory.
    A caller can index its containing project root, or use Graphify directly,
    when a subtree depends on resolver configuration outside that boundary.
    """
    from graphify.extractors.resolution import _read_json_config
    from graphify.rcfile import load_graphifyrc

    suffixes = {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts",
                ".vue", ".svelte", ".astro", ".ejs"}
    try:
        remapped = load_graphifyrc(source).get("languages", {})
        suffixes.update(ext for ext, target in remapped.items() if target in suffixes)
    except (OSError, ValueError):
        pass  # Graphify itself warns and ignores malformed rc configuration.
    files = [path for path in source.rglob("*")
             if path.is_file() and ".git" not in path.relative_to(source).parts]
    if not any(path.suffix.lower() in suffixes for path in files):
        return []

    inputs: list[dict] = []
    # Upstream _find_js_config/_find_workspace_root/_load_package_imports walk
    # to filesystem root, not just the nearest VCS marker. No recursive scan.
    for ancestor in source.parents:
        for name in ("tsconfig.json", "jsconfig.json", "package.json", "pnpm-workspace.yaml"):
            path = ancestor / name
            inputs.append(_configuration_file(path, source))
            if path.exists():
                raise CacheError("cached JS/TS source has ancestor resolver configuration; "
                                 "index the containing project root instead")
        if (ancestor / "node_modules").exists():
            raise CacheError("cached JS/TS source has external node_modules; "
                             "index the containing project root instead")

    def bounded(base: Path, value: str) -> None:
        if not (base / value).resolve().is_relative_to(source):
            raise CacheError("cached JS/TS resolver input escapes the scanned source; "
                             "index the containing project root instead")

    pending = [path for path in files if path.name == "jsconfig.json"
               or re.fullmatch(r"tsconfig(?:\.[^/]+)?\.json", path.name)]
    seen: set[Path] = set()
    while pending:
        path = pending.pop().resolve()
        if path in seen:
            continue
        seen.add(path)
        config = _read_json_config(path) or {}
        options = config.get("compilerOptions", {})
        if isinstance(options, dict):
            base = path.parent / str(options.get("baseUrl") or ".")
            bounded(source, str(base))
            paths = options.get("paths", {})
            if not isinstance(paths, dict):
                raise CacheError("cached JS/TS paths configuration must be an object")
            for values in paths.values():
                if isinstance(values, list):
                    for value in values:
                        if isinstance(value, str):
                            bounded(base, value)
        extended = config.get("extends", [])
        if isinstance(extended, str):
            extended = [extended]
        if not isinstance(extended, list):
            raise CacheError("cached JS/TS extends configuration must be a string or array")
        targets = [value for value in extended if isinstance(value, str) and not value.startswith("@")]
        references = config.get("references", [])
        if not isinstance(references, list):
            raise CacheError("cached JS/TS references configuration must be an array")
        targets.extend(ref["path"] for ref in references
                       if isinstance(ref, dict) and isinstance(ref.get("path"), str))
        for value in targets:
            bounded(path.parent, value)
            target = (path.parent / value).resolve()
            if target.is_dir():
                target = target / "tsconfig.json"
            elif not target.suffix:
                target = target.with_suffix(".json")
            if target.is_file():
                pending.append(target)
    # Source-contained workspace globs and package imports are bounded too;
    # all their real files are already covered by source_fingerprint.
    for path in files:
        if path.name == "pnpm-workspace.yaml":
            from graphify.extractors.resolution import _pnpm_workspace_globs
            for pattern in _pnpm_workspace_globs(path):
                bounded(path.parent, pattern)
        elif path.name == "package.json":
            config = _read_json_config(path) or {}
            workspace = config.get("workspaces", [])
            patterns = workspace.get("packages", []) if isinstance(workspace, dict) else workspace
            for pattern in patterns if isinstance(patterns, list) else []:
                if isinstance(pattern, str):
                    bounded(path.parent, pattern.lstrip("!"))
            pending_values = [config.get("imports", {})]
            while pending_values:
                value = pending_values.pop()
                if isinstance(value, dict):
                    pending_values.extend(value.values())
                elif isinstance(value, list):
                    pending_values.extend(value)
                elif isinstance(value, str) and value.startswith("."):
                    bounded(path.parent, value)
    return inputs


def context_fingerprint(source: Path) -> dict:
    """Fingerprint non-source inputs actually consulted by Graphify 0.9.97.

    Only ancestor ignore/config files and relevant Git state are read; this
    never hashes the rest of a monorepo. Source-contained settings are already
    in source_fingerprint. No config contents or credentials are persisted.
    """
    from graphify.detect import _find_vcs_root, _git_info_exclude

    source = Path(source).resolve(strict=True)
    vcs_root = _find_vcs_root(source)
    ceiling = vcs_root or source
    inputs = []
    directory = source
    while True:
        for name in (".graphifyignore", ".gitignore", ".graphifyrc"):
            inputs.append(_configuration_file(directory / name, source))
        if directory == ceiling:
            break
        directory = directory.parent

    git_state = {"root": str(vcs_root) if vcs_root else None, "head": None,
                 "tracked_paths_sha256": None}
    if vcs_root is not None and (vcs_root / ".git").exists():
        try:
            git_state["head"] = _git(source, "rev-parse", "--verify", "HEAD")
        except CacheError:
            pass  # Unborn Git repositories have no commit provenance yet.
        tracked = _git(vcs_root, "ls-files", "-z", "--cached", "--",
                       source.relative_to(vcs_root).as_posix())
        git_state["tracked_paths_sha256"] = _digest(tracked.encode())
        info_exclude = _git_info_exclude(vcs_root)
        inputs.append(_configuration_file(info_exclude, source) if info_exclude else
                      {"path": "git-info-exclude", "state": "absent"})
        try:
            configured = _git(vcs_root, "config", "--path", "--get", "core.excludesFile")
        except CacheError:
            configured = ""
        if configured:
            global_exclude = Path(configured).expanduser()
            if not global_exclude.is_absolute():
                global_exclude = vcs_root / global_exclude
        else:
            xdg = os.environ.get("XDG_CONFIG_HOME")
            base = Path(xdg) if xdg and Path(xdg).is_absolute() else Path.home() / ".config"
            global_exclude = base / "git" / "ignore"
        inputs.append(_configuration_file(global_exclude, source))
    inputs.extend(_js_scope(source))
    state = {"policy": "ancestor-settings-v2", "files": inputs, "git": git_state}
    return {**state, "sha256": _digest(_json(state).encode())}


def _validate_index(entry: Path, identity: dict) -> tuple[Path, dict]:
    if entry.is_symlink():
        raise CacheError("index cache entry cannot be a symlink")
    metadata = _read_json(entry / "index.json")
    # JSON round-tripping normalizes tuple-valued package identities to lists.
    if metadata.get("identity") != json.loads(_json(identity)):
        raise CacheError("index cache identity metadata mismatch")
    graph = entry / "graphify-out" / "graph.json"
    if graph.is_symlink() or not graph.is_file():
        raise CacheError("index graph is absent or a symlink")
    _inside(entry, graph)
    raw = graph.read_bytes()
    if _digest(raw) != metadata.get("graph_sha256"):
        raise CacheError("index graph integrity mismatch; refusing a corrupt cache hit")
    try:
        data = json.loads(raw)
        if not isinstance(data.get("nodes"), list) or not data["nodes"]:
            raise ValueError("empty or missing nodes")
        if data.get("built_at_commit") != identity["context"]["git"]["head"]:
            raise ValueError("graph commit provenance differs from its source")
    except (ValueError, AttributeError) as exc:
        raise CacheError("index graph is not a nonempty Graphify graph") from exc
    return graph, metadata


def ensure_index(source: Path, cache_root: Path, source_id: str, subdir: str = ".") -> dict:
    """Build a code-only graph once, publishing it only after validation.

    ``source`` is the already selected directory (prepare_reference's source);
    ``subdir`` records its manifest provenance and does not append another path.
    Source-path identity prevents reusing graph source pointers after relocation.
    """
    started = time.perf_counter()
    source = Path(source).resolve(strict=True)
    subdir = _subdir(subdir)
    if not isinstance(source_id, str) or not source_id:
        raise CacheError("source_id must be a nonempty provenance identifier")
    proposed_cache = Path(cache_root).expanduser().resolve()
    if proposed_cache == source or source in proposed_cache.parents:
        raise CacheError("index cache must be outside the indexed source directory")
    cache = _cache_root(proposed_cache)
    before = source_fingerprint(source)
    runtime = runtime_identity()
    context_before = context_fingerprint(source)
    identity = {"schema": INDEX_SCHEMA, "source_id": source_id,
                "source_path": str(source), "subdir": subdir,
                "source": before, "context": context_before, "runtime": runtime,
                "options": ["extract", "--code-only"]}
    key = _digest(_json(identity).encode())
    entry = cache / "indexes" / key
    with _lock(cache, f"index-{key}"):
        hit = entry.exists()
        if entry.is_symlink():
            raise CacheError("index cache entry cannot be a symlink")
        if not hit:
            temporary = Path(tempfile.mkdtemp(prefix=f".build-{key[:12]}-", dir=entry.parent))
            try:
                env = {k: v for k, v in os.environ.items() if not k.startswith("GRAPHIFY_")}
                for variable in _GIT_LOCATION_VARIABLES:
                    env.pop(variable, None)
                # -I prevents an indexed repository from shadowing the installed
                # graphify module through cwd/PYTHONPATH or Python user-site.
                result = subprocess.run(
                    [sys.executable, "-I", "-m", "graphify", "extract", str(source),
                     "--code-only", "--out", str(temporary)],
                    cwd=temporary, env=env, text=True, capture_output=True, timeout=300,
                )
                if result.returncode:
                    raise CacheError(f"Graphify extract failed ({result.returncode}): "
                                     f"{result.stderr.strip()[-2000:]}")
                if source_fingerprint(source) != before:
                    raise CacheError("source changed during index construction")
                if context_fingerprint(source) != context_before:
                    raise CacheError("ancestor configuration or Git state changed during index construction")
                graph = temporary / "graphify-out" / "graph.json"
                if not graph.is_file():
                    raise CacheError("Graphify exited without producing graph.json")
                metadata = {"identity": identity, "graph_sha256": _digest(graph.read_bytes()),
                            "build_seconds": time.perf_counter() - started}
                _write_json(temporary / "index.json", metadata)
                _validate_index(temporary, identity)
                temporary.rename(entry)
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise CacheError("Graphify index construction could not finish") from exc
            finally:
                if temporary.exists():
                    shutil.rmtree(temporary)
        graph, metadata = _validate_index(entry, identity)
        if source_fingerprint(source) != before:
            raise CacheError("source changed while opening its index")
        if context_fingerprint(source) != context_before:
            raise CacheError("ancestor configuration or Git state changed while opening its index")
    return {"graph": str(graph), "index_root": str(entry), "cache_hit": hit,
            "index_id": key, "source_id": source_id, "source": str(source),
            "source_fingerprint": before, "graph_sha256": metadata["graph_sha256"],
            "context_sha256": context_before["sha256"], "source_commit": context_before["git"]["head"],
            "build_seconds": metadata["build_seconds"],
            "seconds": time.perf_counter() - started}
