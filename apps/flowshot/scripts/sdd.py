#!/usr/bin/env python3
"""Generate and verify Flowshot's SDD-derived artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "MANIFEST.json"
CHECKSUMS_PATH = ROOT / "SHA256SUMS"
COMPLETE_EXPORT_PATH = ROOT / "docs/reference/complete-sdd.md"
NODE_ID = re.compile(r"^[NA]\d{2}$")


class VerificationError(Exception):
    """Raised when a documentation invariant is violated."""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def frontmatter(path: Path) -> dict[str, Any]:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0] != "---":
        raise VerificationError(f"{path.relative_to(ROOT)}: missing front matter")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise VerificationError(
            f"{path.relative_to(ROOT)}: unterminated front matter"
        ) from exc

    result: dict[str, Any] = {}
    active_list: str | None = None
    for line in lines[1:end]:
        list_item = re.match(r"^\s+-\s+(.+?)\s*$", line)
        if active_list and list_item:
            result[active_list].append(list_item.group(1))
            continue

        scalar = re.match(r"^([a-z0-9_]+):\s*(.*?)\s*$", line)
        if not scalar:
            continue
        key, value = scalar.groups()
        if value == "[]":
            result[key] = []
            active_list = None
        elif value:
            result[key] = value
            active_list = None
        else:
            result[key] = []
            active_list = key
    return result


def parse_graph(path: Path) -> tuple[dict[str, str], dict[str, dict[str, Any]]]:
    globals_: dict[str, str] = {}
    nodes: dict[str, dict[str, Any]] = {}
    current: dict[str, Any] | None = None
    reading_dependencies = False
    in_nodes = False

    for line in path.read_text(encoding="utf-8").splitlines():
        if line == "nodes:":
            in_nodes = True
            current = None
            continue
        if line == "milestones:":
            break

        if not in_nodes:
            scalar = re.match(
                r"^(project|spec_version|spec_sha256):\s*(\S+)\s*$", line
            )
            if scalar:
                globals_[scalar.group(1)] = scalar.group(2)
            continue

        node_start = re.match(r"^  ([NA]\d{2}):\s*$", line)
        if node_start:
            node_id = node_start.group(1)
            current = {"depends_on": []}
            nodes[node_id] = current
            reading_dependencies = False
            continue

        if current is None:
            continue
        if line == "    depends_on:" or line == "    depends_on: []":
            reading_dependencies = line.endswith(":")
            continue
        dependency = re.match(r"^    -\s+([NA]\d{2})\s*$", line)
        if reading_dependencies and dependency:
            current["depends_on"].append(dependency.group(1))
            continue

        field = re.match(
            r"^    (title|kind|milestone|size|status|spec|contract_lock|verification):"
            r"\s*(.*?)\s*$",
            line,
        )
        if field:
            current[field.group(1)] = field.group(2)
            reading_dependencies = False

    return globals_, nodes


def spec_metadata() -> dict[str, str]:
    metadata = frontmatter(ROOT / "SPEC.md")
    required = ("project_slug", "version", "date")
    missing = [key for key in required if not metadata.get(key)]
    if missing:
        raise VerificationError(f"SPEC.md: missing {', '.join(missing)}")
    return {key: str(metadata[key]) for key in required}


def complete_export_sources() -> list[Path]:
    return [
        ROOT / "SPEC.md",
        ROOT / "docs/graph.yaml",
        ROOT / "docs/protocols/llm-execution-protocol.md",
        ROOT / "docs/protocols/document-change-control.md",
        *sorted((ROOT / "docs/nodes").glob("[AN][0-9][0-9]-*.md")),
        *sorted((ROOT / "docs/templates").glob("*.md")),
    ]


def generate_complete_export(metadata: dict[str, str]) -> None:
    COMPLETE_EXPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    sections = [
        "---",
        "document_id: GENERATED-COMPLETE-SDD",
        f"project: {metadata['project_slug']}",
        f"version: {metadata['version']}",
        f"generated_from: {metadata['project_slug']}-sdd-v{metadata['version']}",
        "status: generated-non-authoritative-export",
        "---",
        "",
        "# Flowshot / Markdown Annotator — Complete SDD Export",
        "",
        "> This is a generated convenience export. The repository's `SPEC.md`,",
        "> node specs, and Rust contracts remain authoritative. Do not edit this",
        "> file directly.",
        "",
    ]

    for source in complete_export_sources():
        relative = source.relative_to(ROOT).as_posix()
        content = source.read_text(encoding="utf-8").rstrip()
        sections.extend(["", "---", "", f"# FILE: `{relative}`", ""])
        if source.suffix == ".yaml":
            sections.extend(["```yaml", content, "```"])
        else:
            sections.append(content)

    COMPLETE_EXPORT_PATH.write_text(
        "\n".join(sections).rstrip() + "\n", encoding="utf-8"
    )


def inventory_paths() -> list[Path]:
    fixed = [
        ROOT / "README.md",
        ROOT / "SPEC.md",
        ROOT / "START-HERE.md",
        ROOT / "CHANGELOG.md",
        ROOT / "contracts/README.md",
        ROOT / "fixtures/README.md",
        ROOT / "scripts/README.md",
        ROOT / "scripts/sdd.py",
    ]
    dynamic = [
        path
        for base in (ROOT / "contracts/locks", ROOT / "docs")
        if base.exists()
        for path in base.rglob("*")
        if path.is_file()
        and path.name != ".DS_Store"
        and "__pycache__" not in path.parts
    ]
    return sorted(set(fixed + dynamic), key=lambda path: path.relative_to(ROOT).as_posix())


def inventory() -> list[dict[str, Any]]:
    entries = []
    for path in inventory_paths():
        if not path.is_file():
            raise VerificationError(f"missing required file: {path.relative_to(ROOT)}")
        data = path.read_bytes()
        entries.append(
            {
                "path": path.relative_to(ROOT).as_posix(),
                "sha256": sha256_bytes(data),
                "bytes": len(data),
            }
        )
    return entries


def generate_integrity(metadata: dict[str, str]) -> None:
    entries = inventory()
    spec_hash = sha256_file(ROOT / "SPEC.md")
    manifest = {
        "schema_version": 1,
        "project": metadata["project_slug"],
        "package_version": metadata["version"],
        "generated_at": f"{metadata['date']}T00:00:00Z",
        "spec_sha256": spec_hash,
        "files": entries,
    }
    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    CHECKSUMS_PATH.write_text(
        "".join(f"{entry['sha256']}  {entry['path']}\n" for entry in entries),
        encoding="utf-8",
    )


def validate_graph(
    metadata: dict[str, str], spec_hash: str
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    graph_globals, graph_nodes = parse_graph(ROOT / "docs/graph.yaml")
    expected_globals = {
        "project": metadata["project_slug"],
        "spec_version": metadata["version"],
        "spec_sha256": spec_hash,
    }
    for key, expected in expected_globals.items():
        if graph_globals.get(key) != expected:
            raise VerificationError(
                f"docs/graph.yaml: {key}={graph_globals.get(key)!r}, expected {expected!r}"
            )

    node_files = sorted((ROOT / "docs/nodes").glob("[AN][0-9][0-9]-*.md"))
    file_nodes: dict[str, dict[str, Any]] = {}
    for path in node_files:
        node = frontmatter(path)
        node_id = str(node.get("id", ""))
        if not NODE_ID.fullmatch(node_id):
            raise VerificationError(f"{path.relative_to(ROOT)}: invalid node id")
        if node_id in file_nodes:
            raise VerificationError(f"duplicate node id: {node_id}")
        if node.get("source_version") != metadata["version"]:
            raise VerificationError(f"{path.relative_to(ROOT)}: stale source_version")
        if node.get("source_sha256") != spec_hash:
            raise VerificationError(f"{path.relative_to(ROOT)}: stale source_sha256")
        if node.get("revision") != "1":
            raise VerificationError(f"{path.relative_to(ROOT)}: missing revision")
        file_nodes[node_id] = {"path": path, **node}

    if set(file_nodes) != set(graph_nodes):
        raise VerificationError(
            "graph/node ID mismatch: "
            f"files-only={sorted(set(file_nodes) - set(graph_nodes))}, "
            f"graph-only={sorted(set(graph_nodes) - set(file_nodes))}"
        )

    for node_id, node in file_nodes.items():
        graph_node = graph_nodes[node_id]
        expected_path = node["path"].relative_to(ROOT).as_posix()
        if graph_node.get("spec") != expected_path:
            raise VerificationError(f"{node_id}: graph spec path mismatch")
        for field in ("title", "kind", "milestone", "size", "status"):
            if graph_node.get(field) != node.get(field):
                raise VerificationError(
                    f"{node_id}: graph/front-matter {field} mismatch"
                )
        source_spec = (node["path"].parent / str(node.get("source_spec", ""))).resolve()
        if source_spec != (ROOT / "SPEC.md").resolve():
            raise VerificationError(f"{node_id}: source_spec does not resolve to SPEC.md")
        file_dependencies = node.get("depends_on", [])
        if graph_node.get("depends_on", []) != file_dependencies:
            raise VerificationError(
                f"{node_id}: dependency mismatch "
                f"{graph_node.get('depends_on', [])!r} != {file_dependencies!r}"
            )
        for dependency in file_dependencies:
            if dependency not in file_nodes:
                raise VerificationError(f"{node_id}: unknown dependency {dependency}")

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str) -> None:
        if node_id in visiting:
            raise VerificationError(f"dependency cycle includes {node_id}")
        if node_id in visited:
            return
        visiting.add(node_id)
        for dependency in graph_nodes[node_id].get("depends_on", []):
            visit(dependency)
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in sorted(graph_nodes):
        visit(node_id)
    return graph_globals, graph_nodes


def validate_links() -> None:
    for path in inventory_paths():
        if path.suffix != ".md" or path == COMPLETE_EXPORT_PATH:
            continue
        content = path.read_text(encoding="utf-8")
        for match in re.finditer(r"\[[^\]]+\]\(([^)]+)\)", content):
            target = match.group(1).strip().strip("<>")
            if (
                not target
                or target.startswith(("#", "http://", "https://", "mailto:"))
                or "{" in target
            ):
                continue
            relative_target = target.split("#", 1)[0]
            resolved = (path.parent / relative_target).resolve()
            if not resolved.exists():
                raise VerificationError(
                    f"{path.relative_to(ROOT)}: broken link {target!r}"
                )


def validate_node_index(graph_nodes: dict[str, dict[str, Any]]) -> None:
    index_path = ROOT / "docs/nodes/README.md"
    indexed: dict[str, dict[str, Any]] = {}
    for line in index_path.read_text(encoding="utf-8").splitlines():
        cells = [cell.strip() for cell in line.split("|")]
        if len(cells) < 7 or not NODE_ID.fullmatch(cells[1]):
            continue
        dependencies = [] if cells[4] == "—" else [
            dependency.strip() for dependency in cells[4].split(",")
        ]
        indexed[cells[1]] = {
            "milestone": cells[2],
            "size": cells[3],
            "depends_on": dependencies,
            "status": cells[5],
        }

    if set(indexed) != set(graph_nodes):
        raise VerificationError("docs/nodes/README.md: node ID set is stale")
    for node_id, entry in indexed.items():
        graph_node = graph_nodes[node_id]
        for field in ("milestone", "size", "depends_on", "status"):
            if entry[field] != graph_node.get(field):
                raise VerificationError(
                    f"docs/nodes/README.md: {node_id} {field} is stale"
                )


def declared_hash(path: Path, key: str) -> str | None:
    pattern = re.compile(rf"^\s+{re.escape(key)}:\s*([0-9a-f]{{64}})\s*$", re.MULTILINE)
    match = pattern.search(path.read_text(encoding="utf-8"))
    return match.group(1) if match else None


def validate_n00_artifacts(metadata: dict[str, str], spec_hash: str) -> None:
    task_dir = ROOT / "docs/tasks/N00"
    plan_path = task_dir / "00-implementation-plan.md"
    test_plan_path = task_dir / "01-test-plan.md"
    lock_path = ROOT / "contracts/locks/N00.json"
    present = [path.exists() for path in (plan_path, test_plan_path, lock_path)]
    if not any(present):
        return
    if not all(present):
        raise VerificationError("N00 planning artifacts are incomplete")

    node_path = ROOT / "docs/nodes/N00-foundation-ci-contracts.md"
    node_hash = sha256_file(node_path)
    plan_hash = sha256_file(plan_path)
    test_plan_hash = sha256_file(test_plan_path)

    for path, expected_type in (
        (plan_path, "implementation-plan"),
        (test_plan_path, "test-plan"),
    ):
        metadata_ = frontmatter(path)
        if metadata_.get("document_type") != expected_type:
            raise VerificationError(f"{path.relative_to(ROOT)}: invalid document_type")
        if metadata_.get("node_id") != "N00":
            raise VerificationError(f"{path.relative_to(ROOT)}: invalid node_id")
        if metadata_.get("source_version") != metadata["version"]:
            raise VerificationError(f"{path.relative_to(ROOT)}: stale source_version")
        if declared_hash(path, "SPEC.md") != spec_hash:
            raise VerificationError(f"{path.relative_to(ROOT)}: stale SPEC hash")
        if declared_hash(path, "N00") != node_hash:
            raise VerificationError(f"{path.relative_to(ROOT)}: stale N00 hash")
        for source in metadata_.get("derived_from", []):
            if not (path.parent / source).resolve().exists():
                raise VerificationError(
                    f"{path.relative_to(ROOT)}: missing derived source {source}"
                )

    if declared_hash(test_plan_path, "plan") != plan_hash:
        raise VerificationError("N00 test plan has a stale implementation-plan hash")

    task_files = sorted(task_dir.glob("T[0-9][0-9]-*.md"))
    if not task_files:
        raise VerificationError("N00 has no executable task cards")
    task_cards: dict[str, dict[str, Any]] = {}
    for path in task_files:
        card = frontmatter(path)
        task_id = str(card.get("id", ""))
        if not re.fullmatch(r"T\d{2}", task_id):
            raise VerificationError(f"{path.relative_to(ROOT)}: invalid task ID")
        if not path.name.startswith(f"{task_id}-"):
            raise VerificationError(f"{path.relative_to(ROOT)}: filename/ID mismatch")
        if task_id in task_cards:
            raise VerificationError(f"N00 duplicate task ID: {task_id}")
        if card.get("document_type") != "task" or card.get("node_id") != "N00":
            raise VerificationError(f"{path.relative_to(ROOT)}: invalid task front matter")
        if card.get("source_version") != metadata["version"]:
            raise VerificationError(f"{path.relative_to(ROOT)}: stale source_version")
        if not card.get("allowed_paths") or not card.get("forbidden_paths"):
            raise VerificationError(f"{path.relative_to(ROOT)}: missing ownership")
        if declared_hash(path, "SPEC.md") != spec_hash:
            raise VerificationError(f"{path.relative_to(ROOT)}: stale SPEC hash")
        if declared_hash(path, "N00") != node_hash:
            raise VerificationError(f"{path.relative_to(ROOT)}: stale N00 hash")
        if declared_hash(path, "plan") != plan_hash:
            raise VerificationError(f"{path.relative_to(ROOT)}: stale plan hash")
        if declared_hash(path, "test_plan") != test_plan_hash:
            raise VerificationError(f"{path.relative_to(ROOT)}: stale test-plan hash")
        for source in card.get("derived_from", []):
            if not (path.parent / source).resolve().exists():
                raise VerificationError(
                    f"{path.relative_to(ROOT)}: missing derived source {source}"
                )
        task_cards[task_id] = {"path": path, **card}

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(task_id: str) -> None:
        if task_id in visiting:
            raise VerificationError(f"N00 task cycle includes {task_id}")
        if task_id in visited:
            return
        visiting.add(task_id)
        for dependency in task_cards[task_id].get("depends_on", []):
            if dependency not in task_cards:
                raise VerificationError(f"{task_id}: unknown task dependency {dependency}")
            visit(dependency)
        visiting.remove(task_id)
        visited.add(task_id)

    for task_id in sorted(task_cards):
        visit(task_id)

    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    if lock.get("node_id") != "N00" or lock.get("spec_version") != metadata["version"]:
        raise VerificationError("contracts/locks/N00.json: invalid identity/version")
    if lock.get("spec_sha256") != spec_hash:
        raise VerificationError("contracts/locks/N00.json: stale SPEC hash")
    if lock.get("commands") != ["get_build_info"]:
        raise VerificationError("contracts/locks/N00.json: unexpected command surface")
    if lock.get("status") == "frozen":
        for key in ("source_sha256", "generator_version", "frozen_at"):
            if not lock.get(key):
                raise VerificationError(f"frozen N00 lock is missing {key}")
    elif lock.get("status") != "planned":
        raise VerificationError("N00 lock status must be planned or frozen")


def verify_integrity(metadata: dict[str, str], spec_hash: str) -> None:
    expected_entries = inventory()
    expected_by_path = {entry["path"]: entry for entry in expected_entries}

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    expected_manifest_header = {
        "schema_version": 1,
        "project": metadata["project_slug"],
        "package_version": metadata["version"],
        "spec_sha256": spec_hash,
    }
    for key, expected in expected_manifest_header.items():
        if manifest.get(key) != expected:
            raise VerificationError(f"MANIFEST.json: invalid {key}")
    manifest_by_path = {entry["path"]: entry for entry in manifest.get("files", [])}
    if manifest_by_path != expected_by_path:
        raise VerificationError("MANIFEST.json does not match current documentation")

    checksum_by_path: dict[str, str] = {}
    for line in CHECKSUMS_PATH.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
        if not match:
            raise VerificationError(f"SHA256SUMS: invalid line {line!r}")
        checksum_by_path[match.group(2)] = match.group(1)
    expected_checksums = {
        path: entry["sha256"] for path, entry in expected_by_path.items()
    }
    if checksum_by_path != expected_checksums:
        raise VerificationError("SHA256SUMS does not match current documentation")


def generate() -> None:
    metadata = spec_metadata()
    generate_complete_export(metadata)
    generate_integrity(metadata)
    print(
        f"generated {COMPLETE_EXPORT_PATH.relative_to(ROOT)}, "
        f"{MANIFEST_PATH.relative_to(ROOT)}, and "
        f"{CHECKSUMS_PATH.relative_to(ROOT)}"
    )


def verify() -> None:
    metadata = spec_metadata()
    spec_hash = sha256_file(ROOT / "SPEC.md")
    _, graph_nodes = validate_graph(metadata, spec_hash)
    validate_node_index(graph_nodes)
    validate_links()
    validate_n00_artifacts(metadata, spec_hash)
    verify_integrity(metadata, spec_hash)
    print("SDD verification passed")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("generate", "verify"))
    args = parser.parse_args()
    try:
        if args.command == "generate":
            generate()
        else:
            verify()
    except (OSError, ValueError, VerificationError) as exc:
        print(f"SDD error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
