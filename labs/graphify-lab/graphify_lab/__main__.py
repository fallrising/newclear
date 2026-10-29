"""Local Graphify trial and shared-reference entrypoint."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import statistics
import subprocess
import sys
import time

from .cache import CacheError, ensure_index, prepare_reference, source_fingerprint

LAB = Path(__file__).resolve().parents[1]
REPO = LAB.parents[1]
DEFAULT_CACHE = Path(os.environ.get("GRAPHIFY_LAB_CACHE", str(
    Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "newclear" / "graphify-lab")))


def manifest() -> dict:
    data = json.loads((LAB / "references.lock.json").read_text())
    if data.get("schema") != 1 or not isinstance(data.get("references"), list):
        raise ValueError("unsupported reference manifest")
    names = [ref["name"] for ref in data["references"]]
    if not names or len(names) != len(set(names)):
        raise ValueError("reference names must be nonempty and unique")
    return data


def reference(name: str) -> dict:
    refs = [ref for ref in manifest()["references"] if ref["name"] == name]
    if len(refs) != 1:
        raise ValueError(f"unknown reference: {name}")
    return refs[0]


def environment() -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GRAPHIFY_")}
    env["GRAPHIFY_NO_TIPS"] = "1"
    env["GRAPHIFY_QUERY_LOG_DISABLE"] = "1"
    return env


def graph_command(arguments: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-I", "-m", "graphify", *arguments],
                          cwd=LAB, env=environment(), text=True,
                          capture_output=True, timeout=120)


def open_reference(name: str, cache: Path) -> tuple[dict, dict, dict]:
    ref = reference(name)
    source = prepare_reference(ref, cache, offline=True)
    index = ensure_index(Path(source["source"]), cache, source["source_id"], ref["subdir"])
    return ref, source, index


def node_at(graph: Path, label: str, filename: str | None = None) -> dict:
    data = json.loads(graph.read_text())
    found = [n for n in data["nodes"] if n.get("label") == label
             and (filename is None or n.get("source_file") == filename)]
    if len(found) != 1:
        raise ValueError(f"expected one exact source symbol, found {len(found)}: {label}")
    return found[0]


def source_excerpt(source: Path, node: dict, lines: int = 20) -> dict:
    if not 1 <= lines <= 100:
        raise ValueError("lines must be between 1 and 100")
    root = source.resolve(strict=True)
    target = (root / node["source_file"]).resolve(strict=True)
    if not target.is_relative_to(root) or not target.is_file():
        raise ValueError("graph source pointer escapes the source root")
    match = re.fullmatch(r"L(\d+)(?:[-:]L?\d+)?", node.get("source_location", ""))
    if not match:
        raise ValueError("symbol has no supported line location")
    start = int(match.group(1))
    text = target.read_text(encoding="utf-8").splitlines()
    if not 1 <= start <= len(text):
        raise ValueError("graph source line is outside the file")
    return {"path": target.relative_to(root).as_posix(), "line": start,
            "content": "\n".join(text[start - 1:start - 1 + lines])}


def tree_bytes(root: Path) -> int:
    return sum(p.stat().st_size for p in root.rglob("*") if p.is_file() and not p.is_symlink())


def portable(value, paths: dict[str, str]):
    if isinstance(value, dict):
        return {k: portable(v, paths) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [portable(v, paths) for v in value]
    if isinstance(value, str):
        for path, replacement in sorted(paths.items(), key=lambda item: len(item[0]), reverse=True):
            value = value.replace(path, replacement)
    return value


def inspect_real(source: Path, index: dict, label: str, filename: str) -> dict:
    graph_path = Path(index["graph"])
    graph = json.loads(graph_path.read_text())
    edges = graph.get("links", graph.get("edges", []))
    if not edges:
        raise ValueError("real project graph has no relationships")
    node = node_at(graph_path, label, filename)
    excerpt = source_excerpt(source, node, lines=1)
    name = label.removesuffix("()")
    if not re.match(rf"\s*(?:async\s+)?def\s+{re.escape(name)}\s*\(", excerpt["content"]):
        raise ValueError("graph definition location does not match the real source")
    explained = graph_command(["explain", node["id"], "--graph", str(graph_path)])
    if explained.returncode != 0 or label not in explained.stdout or filename not in explained.stdout:
        raise ValueError("real Graphify explain did not return the expected source symbol")
    latencies = []
    response_bytes = []
    for _ in range(5):
        started = time.perf_counter()
        result = graph_command(["query", f"{filename}::{label}", "--graph", str(graph_path), "--budget", "1000"])
        latencies.append(round(time.perf_counter() - started, 6))
        if result.returncode != 0 or label not in result.stdout:
            raise ValueError("real Graphify query did not recover the expected symbol")
        response_bytes.append(len(result.stdout.encode()))
    return {"nodes": len(graph["nodes"]), "edges": len(edges),
            "graph_json_bytes": graph_path.stat().st_size,
            "graph_sha256": hashlib.sha256(graph_path.read_bytes()).hexdigest(),
            "source": source_fingerprint(source),
            "oracle": {k: node.get(k) for k in ("id", "label", "source_file", "source_location")},
            "verified_declaration": excerpt,
            "explain": explained.stdout,
            "cli_query_seconds_including_startup": {"samples": latencies, "median": statistics.median(latencies)},
            "query_response_bytes": response_bytes}


def full_run(output: Path, cache: Path) -> dict:
    from .scenarios import run_suite

    output = output.resolve()
    cache = cache.expanduser().resolve()
    if output == cache or cache in output.parents or output in cache.parents:
        raise ValueError("run output and shared cache must be separate directory trees")
    for target in [LAB / "fixtures", *[(REPO / t["path"]).resolve() for t in manifest()["local_targets"]]]:
        if output == target or target in output.parents:
            raise ValueError("run output cannot be inside an indexed source")
    # Prevent a later run from modifying source/graph artifacts of an earlier run.
    output.mkdir(parents=True, exist_ok=False)
    code = [*sorted((LAB / "graphify_lab").glob("*.py")), LAB / "requirements.lock", LAB / "references.lock.json"]
    code += [p for p in sorted((LAB / "fixtures").rglob("*")) if p.is_file()]
    before_inputs = {str(p.relative_to(LAB)): hashlib.sha256(p.read_bytes()).hexdigest() for p in code}
    report = {"schema": 1, "status": "failed", "recorded_at": datetime.now(timezone.utc).isoformat(),
              "python": sys.version.split()[0], "graphify": importlib.metadata.version("graphifyy"),
              "network_policy": "Preparation fetches public Git; full uses prepared sources and code-only Graphify.",
              "manifest": manifest(), "cases": [], "limitations": [
                  "This bounded trial does not establish full static-analysis correctness or LLM answer quality.",
                  "Byte counts are logical regular-file bytes; no compression, allocated-block or token claims.",
                  "The storage comparisons are calculated counterfactuals from measured sizes, not ten physical clones.",
                  "The environment/dependencies are shared and reported separately, excluded from both source/index comparisons.",
                  "Index keys include the absolute source location; relocation requires rebuilding the graph.",
                  "References are immutable by validation, not chmod; cooperating POSIX processes share locks.",
              ]}
    paths = {str(output): "<run>", str(cache): "<cache>", str(REPO): "<newclear>", str(LAB): "<lab>"}

    def case(identifier, ac, action):
        started = time.perf_counter()
        row = {"id": identifier, "ac": ac}
        try:
            row["evidence"] = action()
            row["status"] = "passed"
        except Exception as exc:
            row["status"] = "failed"
            row["error"] = f"{type(exc).__name__}: {exc}"
        row["seconds"] = round(time.perf_counter() - started, 6)
        report["cases"].append(row)

    def reference_case():
        ref = reference("graphify")
        source = prepare_reference(ref, cache, offline=True)
        index = ensure_index(Path(source["source"]), cache, source["source_id"], ref["subdir"])
        # A second independent caller runs the same public adapter API.
        source_again = prepare_reference(ref, cache, offline=True)
        index_again = ensure_index(Path(source_again["source"]), cache, source_again["source_id"], ref["subdir"])
        if source["root"] != source_again["root"] or index["graph"] != index_again["graph"]:
            raise ValueError("consumers did not share the same physical source and graph")
        if not source_again["cache_hit"] or not index_again["cache_hit"]:
            raise ValueError("second consumer rebuilt the source/index")
        pointers = []
        for name in ("consumer-a", "consumer-b"):
            pointer = output / f"{name}.json"
            value = {"schema": 1, "reference": ref["name"], "commit": ref["commit"],
                     "source_id": source["source_id"], "index_id": index["index_id"],
                     "source": source["source"], "graph": index["graph"]}
            pointer.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n")
            pointers.append(value)
        if pointers[0] != pointers[1] or not os.path.samefile(pointers[0]["source"], pointers[1]["source"]):
            raise ValueError("consumer pointers do not identify one canonical source")
        if not os.path.samefile(pointers[0]["graph"], pointers[1]["graph"]):
            raise ValueError("consumer pointers do not identify one canonical graph")
        real = inspect_real(Path(source["source"]), index, "file_hash()", "cache.py")
        package = importlib.metadata.distribution("graphifyy")
        package_comparison = []
        for filename in ("__main__.py", "cli.py", "cache.py", "serve.py", "extract.py", "cross_repo_calls.py"):
            installed = Path(package.locate_file(f"graphify/{filename}"))
            source_hash = hashlib.sha256((Path(source["source"]) / filename).read_bytes()).hexdigest()
            installed_hash = hashlib.sha256(installed.read_bytes()).hexdigest()
            if source_hash != installed_hash:
                raise ValueError(f"installed Graphify differs from reviewed upstream core file: {filename}")
            package_comparison.append({"path": filename, "sha256": source_hash, "equal": True})
        real["source_url"] = f"https://github.com/Graphify-Labs/graphify/blob/{ref['commit']}/graphify/cache.py#L{real['verified_declaration']['line']}"
        root = Path(source["root"])
        sizes = {"source_checkout_excluding_git": source_fingerprint(root)["bytes"],
                 "git_metadata": tree_bytes(root / ".git"),
                 "source_cache_metadata": (root.parent / "source.json").stat().st_size,
                 "index_directory": tree_bytes(Path(index["index_root"])),
                 "one_pointer": (output / "consumer-a.json").stat().st_size}
        source_size = sizes["source_checkout_excluding_git"] + sizes["git_metadata"]
        bundle = source_size + sizes["index_directory"] + sizes["source_cache_metadata"]
        models = []
        for count in (1, 2, 5, 10):
            shared = bundle + count * sizes["one_pointer"]
            duplicated = count * bundle
            models.append({"consumers": count, "separate_source_and_index_bytes": duplicated,
                           "shared_source_index_and_pointers_bytes": shared,
                           "saved_bytes_like_for_like": duplicated - shared,
                           "saved_percent_like_for_like": round(100 * (duplicated - shared) / duplicated, 4),
                           "separate_source_only_bytes": count * source_size,
                           "saved_bytes_against_source_only": count * source_size - shared})
        entries = [p for p in (cache / "sources").glob("*/source.json")
                   if json.loads(p.read_text()).get("url") == ref["url"]
                   and json.loads(p.read_text()).get("commit") == ref["commit"]]
        if len(entries) != 1:
            raise ValueError("reference revision has multiple physical source entries")
        return {"reference": ref, "first_source_cache_hit": source["cache_hit"],
                "first_index_cache_hit": index["cache_hit"], "first_index_open_seconds": index["seconds"],
                "original_index_build_seconds": index["build_seconds"],
                "warm_source_validation_seconds": source_again["seconds"],
                "warm_index_validation_seconds": index_again["seconds"],
                "second_source_hit": source_again["cache_hit"], "second_index_hit": index_again["cache_hit"],
                "same_source_inode": True, "same_graph_inode": True,
                "source_entries_for_revision": len(entries), "consumer_pointer_files": ["consumer-a.json", "consumer-b.json"],
                "real_project": real, "reviewed_core_matches_installed_package": package_comparison,
                "measured_logical_bytes": sizes, "calculated_storage_models": models}

    def local_case():
        target = manifest()["local_targets"][0]
        source = (REPO / target["path"]).resolve(strict=True)
        baseline = target["observed_repository_commit"]
        fingerprint = source_fingerprint(source)
        if fingerprint != target["source_fingerprint"]:
            raise ValueError("local target differs from its recorded content fingerprint; update provenance before rerunning")
        source_id = f"newclear:{target['path']}:{fingerprint['sha256']}"
        index = ensure_index(source, cache, source_id, target["path"])
        result = inspect_real(source, index, "normalize_rates()", "codex_usage.py")
        result["repository_commit"] = baseline
        result["project"] = target["path"]
        result["source_url"] = f"https://github.com/fallrising/newclear/blob/{baseline}/{target['path']}/codex_usage.py#L{result['verified_declaration']['line']}"
        result["index_cache_hit"] = index["cache_hit"]
        result["index_open_seconds"] = index["seconds"]
        return result

    case("REF-01", ["AC-01", "AC-03", "AC-07", "AC-08"], reference_case)
    case("REPO-01", ["AC-03"], local_case)
    try:
        scenarios = run_suite(output / "scenarios")
        report["cases"].extend(scenarios["cases"])
        report["limitations"].extend(scenarios["limitations"])
    except Exception as exc:
        report["cases"].append({"id": "SCENARIOS", "status": "failed", "error": f"{type(exc).__name__}: {exc}"})
    report["environment_logical_bytes"] = tree_bytes(LAB / ".venv")
    report["input_sha256"] = {str(p.relative_to(LAB)): hashlib.sha256(p.read_bytes()).hexdigest() for p in code}
    if report["input_sha256"] != before_inputs:
        report["cases"].append({"id": "INPUT-INTEGRITY", "status": "failed", "error": "lab inputs changed during the run"})
    report["passed"] = sum(row["status"] == "passed" for row in report["cases"])
    report["failed"] = sum(row["status"] != "passed" for row in report["cases"])
    report["status"] = "passed" if not report["failed"] else "failed"
    report = portable(report, paths)
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE,
                        help="shared POSIX cache; keep outside indexed sources")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("prepare", help="fetch exact public reference revisions; explicit network phase")
    run = commands.add_parser("full", help="run real references and all developer scenarios using prepared sources")
    run.add_argument("--out", type=Path, required=True)
    locate = commands.add_parser("locate", help="validate and print local source/index pointers")
    locate.add_argument("reference")
    for operation in ("query", "explain"):
        child = commands.add_parser(operation)
        child.add_argument("reference")
        child.add_argument("symbol")
        if operation == "query":
            child.add_argument("--budget", type=int, default=1000, help="upstream soft token budget")
            child.add_argument("--context", help="upstream context filter, for example call")
    show = commands.add_parser("source", help="read a bounded source excerpt for an exact graph label")
    show.add_argument("reference")
    show.add_argument("label", help="exact label, e.g. file_hash()")
    show.add_argument("--file", dest="filename")
    show.add_argument("--lines", type=int, default=20)
    serve = commands.add_parser("serve", help="serve the shared reference graph over stdio MCP")
    serve.add_argument("reference")
    args = parser.parse_args(argv)
    try:
        if args.command == "prepare":
            for ref in manifest()["references"]:
                prepared = prepare_reference(ref, args.cache)
                print(json.dumps({"reference": ref["name"], "commit": prepared["commit"],
                                  "cache_hit": prepared["cache_hit"], "seconds": prepared["seconds"]}))
        elif args.command == "full":
            report = full_run(args.out, args.cache)
            print(json.dumps({k: report[k] for k in ("status", "passed", "failed")}))
            return 0 if report["status"] == "passed" else 1
        else:
            ref, source, index = open_reference(args.reference, args.cache)
            if args.command == "locate":
                print(json.dumps({"reference": ref["name"], "source": source, "index": index}, indent=2))
            elif args.command in ("query", "explain"):
                command = [args.command, args.symbol, "--graph", index["graph"]]
                if args.command == "query":
                    if not 1 <= args.budget <= 32000:
                        raise ValueError("budget must be between 1 and 32000")
                    command.extend(["--budget", str(args.budget)])
                    if args.context:
                        command.extend(["--context", args.context])
                result = graph_command(command)
                sys.stdout.write(result.stdout)
                sys.stderr.write(result.stderr)
                return result.returncode
            elif args.command == "source":
                node = node_at(Path(index["graph"]), args.label, args.filename)
                excerpt = source_excerpt(Path(source["source"]), node, args.lines)
                print(json.dumps({"reference": ref["name"], "commit": ref["commit"], **excerpt}, ensure_ascii=False, indent=2))
            elif args.command == "serve":
                os.execve(sys.executable, [sys.executable, "-I", "-m", "graphify.serve", "--graph", index["graph"]], environment())
        return 0
    except (CacheError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
