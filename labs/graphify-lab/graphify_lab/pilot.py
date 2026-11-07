"""Replay a bounded development investigation on an immutable Git source snapshot."""
from __future__ import annotations

import argparse
import ast
import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import time

from .__main__ import DEFAULT_CACHE, LAB, REPO, environment, node_at, source_excerpt
from .cache import PINNED_GRAPHIFY_VERSION

PREFIX = "labs/graphify-lab/"
HELPERS = ("node_at", "source_excerpt")


def validate_baseline(value: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("baseline must be a full lowercase commit SHA")
    return value


def validate_output(output: Path, *, lab: Path = LAB, cache: Path = DEFAULT_CACHE) -> Path:
    output = output.expanduser().resolve()
    for protected in (lab / "graphify_lab", lab / "tests", cache):
        protected = protected.expanduser().resolve()
        if output == protected or output in protected.parents or protected in output.parents:
            raise ValueError("output must not overlap live implementation, tests, or cache")
    if output.exists():
        raise FileExistsError("output already exists; preserve previous evidence and choose a new run directory")
    return output


def _git(repo: Path, *args: str) -> bytes:
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    result = subprocess.run(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", *args],
                            cwd=repo, env=env, capture_output=True, timeout=30)
    if result.returncode:
        raise ValueError(f"Git read failed: {args[0]}: {result.stderr.decode(errors='replace')[-1000:]}")
    return result.stdout


def snapshot_source(repo: Path, baseline: str, destination: Path) -> dict:
    """Read committed regular Python blobs, without checkout, imports or execution."""
    validate_baseline(baseline)
    resolved = _git(repo, "rev-parse", "--verify", baseline + "^{commit}").decode().strip()
    if resolved != baseline:
        raise ValueError("baseline must identify a commit, not a tag object")
    listing = _git(repo, "ls-tree", "-rz", baseline, "--", PREFIX + "graphify_lab", PREFIX + "tests")
    entries = []
    for item in listing.split(b"\0"):
        if not item:
            continue
        metadata, raw_path = item.split(b"\t", 1)
        mode, kind, oid = metadata.decode().split()
        path = raw_path.decode("utf-8")
        relative = PurePosixPath(path.removeprefix(PREFIX))
        if relative.suffix != ".py":
            continue
        if (not path.startswith(PREFIX) or relative.parts[0] not in ("graphify_lab", "tests")
                or ".." in relative.parts or mode not in ("100644", "100755") or kind != "blob"):
            raise ValueError("snapshot contains a nonregular or unsafe Python source")
        entries.append((relative, oid))
    if not entries or not any(path.parts[0] == "tests" for path, _ in entries):
        raise ValueError("baseline lacks implementation and tests")
    if not any(path.parts[0] == "graphify_lab" for path, _ in entries):
        raise ValueError("baseline lacks implementation and tests")
    destination.mkdir(parents=True, exist_ok=False)
    files = {}
    for path, oid in entries:
        content = _git(repo, "cat-file", "blob", oid)
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        files[str(path)] = {"sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content), "git_blob": oid}
    digest = hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"baseline": baseline, "scope": PREFIX + "{graphify_lab,tests}/**/*.py",
            "git_read_commands_observed": 2 + len(entries),
            "files": files, "fingerprint_sha256": digest, "baseline_executed": False}


def sanitize(value, replacements: dict[str, str]):
    if isinstance(value, dict):
        return {key: sanitize(item, replacements) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize(item, replacements) for item in value]
    if isinstance(value, str):
        for path, replacement in sorted(replacements.items(), key=lambda item: len(item[0]), reverse=True):
            value = value.replace(path, replacement)
    return value


def _error_text(exc: BaseException) -> str:
    if isinstance(exc, BaseExceptionGroup):
        return f"{type(exc).__name__}: " + "; ".join(_error_text(child) for child in exc.exceptions)
    return f"{type(exc).__name__}: {exc}"


def verify_node(source: Path, node: dict, name: str, filename: str) -> dict:
    """A graph pointer passes only if it identifies the exact AST declaration."""
    if node.get("label", "").rsplit(".", 1)[-1] not in (name + "()", name) or node.get("source_file") != filename:
        raise ValueError("graph candidate does not match requested symbol and file")
    excerpt = source_excerpt(source, node, lines=12)
    tree = ast.parse((source / filename).read_text(encoding="utf-8"))
    found = [part for part in ast.walk(tree) if isinstance(part, (ast.FunctionDef, ast.AsyncFunctionDef))
             and part.name == name and part.lineno == excerpt["line"]]
    if len(found) != 1:
        raise ValueError("graph source location does not match an exact AST declaration")
    return {**excerpt, "ast_verified": True, "end_line": found[0].end_lineno}


def _command(args: list[str], cwd: Path, commands: list[dict]) -> dict:
    start = time.perf_counter()
    result = subprocess.run(args, cwd=cwd, env=environment(), capture_output=True, text=True, timeout=120)
    record = {"command": args, "seconds": round(time.perf_counter() - start, 6),
              "exit_code": result.returncode, "stdout": result.stdout, "stderr": result.stderr,
              "stdout_bytes": len(result.stdout.encode()), "stderr_bytes": len(result.stderr.encode())}
    commands.append(record)
    if result.returncode:
        raise RuntimeError(f"command exited {result.returncode}: {result.stderr[-1000:]}")
    return record


def _callsites(source: Path, helper: str) -> list[dict]:
    result = []
    for path in sorted(source.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        # Assign each call to its nearest function, excluding nested function bodies.
        def visit(part, owner=None):
            if isinstance(part, (ast.FunctionDef, ast.AsyncFunctionDef)):
                owner = part
            if isinstance(part, ast.Call) and isinstance(part.func, ast.Name) and part.func.id == helper:
                result.append({"source_file": path.relative_to(source).as_posix(), "line": part.lineno,
                               "caller": owner.name if owner else "<module>",
                               "caller_line": owner.lineno if owner else None})
            for child in ast.iter_child_nodes(part):
                visit(child, owner)
        visit(tree)
    return result


async def _mcp(graph: Path, definitions: list[dict], output: Path) -> dict:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    params = StdioServerParameters(command=sys.executable,
        args=["-I", "-m", "graphify.serve", "--graph", str(graph)], cwd=str(output), env=environment())
    records = []
    started = time.perf_counter()
    with (output / "mcp.stderr.log").open("w", encoding="utf-8") as log:
        async with stdio_client(params, errlog=log) as (read, write):
            timeout = timedelta(seconds=20) if importlib.metadata.version("mcp").startswith("1.") else 20.0
            async with ClientSession(read, write, read_timeout_seconds=timeout) as session:
                initialized = await session.initialize()
                listed = await session.list_tools()
                names = sorted(tool.name for tool in listed.tools)
                if not {"get_node", "query_graph"} <= set(names):
                    raise ValueError("real MCP server lacks required tools")
                for definition in definitions:
                    node = definition["node"]
                    for tool, arguments in (("get_node", {"node_id": node["id"]}),
                                            ("query_graph", {"question": node["label"], "depth": 2,
                                                             "token_budget": 3000, "context_filter": ["call"]})):
                        start = time.perf_counter()
                        result = await session.call_tool(tool, arguments)
                        seconds = time.perf_counter() - start
                        answer = "\n".join(block.text for block in result.content if hasattr(block, "text"))
                        if getattr(result, "isError", False) or node["label"] not in answer:
                            raise ValueError(f"MCP {tool} failed to recover exact symbol")
                        if tool == "get_node" and (node["source_file"] not in answer or node["source_location"] not in answer):
                            raise ValueError("MCP get_node omitted verified source pointer")
                        records.append({"tool": tool, "arguments": arguments, "seconds": round(seconds, 6),
                                        "output_bytes": len(answer.encode()), "output": answer, "correct": True})
    return {"transport": "stdio", "initialize": initialized.model_dump(by_alias=True), "tools": names,
            "requests": records, "protocol_requests_observed": 2 + len(records),
            "protocol_notifications_included": False, "seconds_including_startup": round(time.perf_counter() - started, 6)}


def run_pilot(baseline: str, output: Path) -> dict:
    validate_baseline(baseline)
    output = validate_output(output)
    version = importlib.metadata.version("graphifyy")
    if version != PINNED_GRAPHIFY_VERSION:
        raise ValueError(f"Graphify must be {PINNED_GRAPHIFY_VERSION}, got {version}")
    output.mkdir(parents=True, exist_ok=False)
    start = time.perf_counter()
    report = {"schema": 1, "status": "failed", "baseline": baseline,
              "recorded_at": datetime.now(timezone.utc).isoformat(), "graphify_version": version,
              "python_version": sys.version.split()[0], "commands": [], "limitations": [
                  "Known-task replay on one public component; no blind evaluation or causal productivity claim.",
                  "Graphify returns graph neighborhoods; rg returns matching lines. Command timings are different operations.",
                  "AST direct-name calls are source evidence, not proof of runtime reachability or complete dependencies.",
                  "No baseline code is imported or executed; only the installed pinned Graphify processes it.",
                  "Graphify Git metadata can inherit the enclosing checkout; the source manifest identifies the actual frozen baseline.",
                  "Token budgets are upstream settings, not measured tokens. No provider or cost instrumentation is available."]}
    paths = {str(output): "<run>", str(LAB): "<lab>", str(REPO): "<repo>",
             str(Path(sys.prefix)): "<python-env>", str(Path.home()): "<home>"}
    source = output / "source"
    commands = report["commands"]
    graph_args = [sys.executable, "-I", "-m", "graphify"]
    try:
        t0 = time.perf_counter()
        manifest = snapshot_source(REPO, baseline, source)
        report["snapshot_seconds"] = round(time.perf_counter() - t0, 6)
        report["source_manifest"] = manifest
        (output / "source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        report["build"] = _command([*graph_args, "extract", str(source), "--code-only", "--out", str(output / "index")], output, commands)
        graph_path = output / "index/graphify-out/graph.json"
        graph = json.loads(graph_path.read_text())
        graph_hash = hashlib.sha256(graph_path.read_bytes()).hexdigest()
        report["graph"] = {"nodes": len(graph["nodes"]), "edges": len(graph.get("links", graph.get("edges", []))),
                           "sha256": graph_hash, "bytes": graph_path.stat().st_size}
        definitions = []
        report["definitions"] = definitions
        report["relationship_checks"] = []
        for helper in HELPERS:
            node = node_at(graph_path, helper + "()", "graphify_lab/__main__.py")
            query = _command([*graph_args, "query", helper, "--graph", str(graph_path), "--context", "call", "--budget", "3000"], output, commands)
            explain = _command([*graph_args, "explain", node["id"], "--graph", str(graph_path)], output, commands)
            if node["label"] not in query["stdout"] or f'{node["source_file"]} {node["source_location"]}' not in explain["stdout"]:
                raise ValueError("CLI query/explain did not recover the exact source definition")
            t0 = time.perf_counter()
            verified = verify_node(source, node, helper, "graphify_lab/__main__.py")
            definitions.append({"node": {key: node[key] for key in ("id", "label", "source_file", "source_location")},
                                "query": query, "explain": explain, "source": verified,
                                "source_read_and_ast_seconds": round(time.perf_counter() - t0, 6),
                                "source_excerpt_bytes": len(verified["content"].encode())})
            for call in _callsites(source, helper):
                callers = [candidate for candidate in graph["nodes"]
                           if candidate.get("source_file") == call["source_file"]
                           and candidate.get("source_location") == f'L{call["caller_line"]}']
                edges = [edge for edge in graph.get("links", graph.get("edges", []))
                         if edge.get("relation") == "calls" and edge.get("target", edge.get("_tgt")) == node["id"]
                         and any(edge.get("source", edge.get("_src")) == caller["id"] for caller in callers)]
                report["relationship_checks"].append({**call, "callee": helper,
                    "status": "present" if edges else "absent", "edges": edges,
                    "caller_in_helper_query": any(caller.get("label", "") in query["stdout"] for caller in callers)})
        # Explicit known caller/test queries also verify context when Python import edges are absent.
        context = []
        report["context"] = context
        for name, filename in (("inspect_real", "graphify_lab/__main__.py"),
                               ("test_same_name_requires_file_selection", "tests/test_cli.py"),
                               ("test_source_pointer_containment_and_bounds", "tests/test_cli.py")):
            tree = ast.parse((source / filename).read_text())
            declaration = next(part for part in ast.walk(tree) if isinstance(part, ast.FunctionDef) and part.name == name)
            candidates = [node for node in graph["nodes"] if node.get("source_file") == filename
                          and node.get("source_location") == f"L{declaration.lineno}"]
            if len(candidates) != 1:
                raise ValueError(f"graph failed to locate known caller/test: {name}")
            node = candidates[0]
            query = _command([*graph_args, "query", name, "--graph", str(graph_path), "--budget", "3000"], output, commands)
            if name not in query["stdout"] or filename not in query["stdout"]:
                raise ValueError(f"query failed to return caller/test source context: {name}")
            # Class method labels may be qualified; verify exact AST name and location.
            t0 = time.perf_counter()
            excerpt = verify_node(source, node, name, filename)
            context.append({"name": name, "node": node, "query": query, "source": excerpt,
                            "source_read_and_ast_seconds": round(time.perf_counter() - t0, 6),
                            "source_excerpt_bytes": len(excerpt["content"].encode())})
        absent = sum(row["status"] == "absent" for row in report["relationship_checks"])
        if absent:
            report["limitations"].append(f"{absent} source-proven direct calls lack a graph calls edge; absent relationships are not passed checks.")
        rg = shutil.which("rg")
        if not rg:
            raise ValueError("rg is required for the bounded baseline")
        report["rg_baseline"] = []
        for helper in HELPERS:
            result = _command([rg, "--line-number", "--fixed-strings", "--glob", "*.py", "--", helper, "graphify_lab", "tests"], source, commands)
            expected = next(row for row in definitions if row["node"]["label"] == helper + "()")
            pointer = f'graphify_lab/__main__.py:{expected["source"]["line"]}:def {helper}('
            if pointer not in result["stdout"] or "tests/test_cli.py:" not in result["stdout"]:
                raise ValueError("rg failed to find the source-verified declaration and test references")
            t0 = time.perf_counter()
            excerpt = verify_node(source, expected["node"], helper, "graphify_lab/__main__.py")
            report["rg_baseline"].append({"helper": helper, "lookup": result, "correct": True, "source": excerpt,
                                          "source_read_and_ast_seconds": round(time.perf_counter() - t0, 6),
                                          "source_excerpt_bytes": len(excerpt["content"].encode())})
        report["mcp"] = asyncio.run(asyncio.wait_for(_mcp(graph_path, definitions, output), timeout=90))
        if hashlib.sha256(graph_path.read_bytes()).hexdigest() != graph_hash:
            raise ValueError("read-only investigation modified graph.json")
        for path, expected in manifest["files"].items():
            if hashlib.sha256((source / path).read_bytes()).hexdigest() != expected["sha256"]:
                raise ValueError("investigation modified frozen source")
        report["status"] = "passed"
    except Exception as exc:
        report["error"] = _error_text(exc)
    report["measurements"] = {"snapshot_at": datetime.now(timezone.utc).isoformat(),
        "coverage": "This pilot process only; local child commands and explicit MCP requests. Excludes orchestrator/agent and provider activity.",
        "recorded_cli_commands_observed": len(commands),
        "git_read_commands_observed": report.get("source_manifest", {}).get("git_read_commands_observed"),
        "mcp_protocol_requests_observed": report.get("mcp", {}).get("protocol_requests_observed"),
        "outer_tool_calls": None, "agent_starts": None, "provider_requests": None, "tokens": None,
        "cost": None, "agent_elapsed_seconds": None, "command_retries": 0,
        "pilot_elapsed_seconds": round(time.perf_counter() - start, 6)}
    report = sanitize(report, paths)
    (output / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    try:
        report = run_pilot(args.baseline, args.out)
    except (ValueError, FileExistsError, OSError) as exc:
        parser.exit(2, f"pilot: {exc}\n")
    print(json.dumps({key: report[key] for key in ("status", "baseline")}))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
