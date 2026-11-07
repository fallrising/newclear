"""Bounded source readback for graph symbols; independent of CLI orchestration."""
from __future__ import annotations

import json
from pathlib import Path
import re


def node_at(graph: Path, label: str, filename: str | None = None) -> dict:
    data = json.loads(graph.read_text())
    found = [n for n in data["nodes"] if n.get("label") == label
             and (filename is None or n.get("source_file") == filename)]
    if len(found) != 1:
        raise ValueError(f"expected one exact source symbol, found {len(found)}: {label}")
    return found[0]


def validate_source_node_options(node_id: str, lines: int = 20,
                                 expected_index_id: str | None = None) -> None:
    if not isinstance(node_id, str) or not node_id.strip():
        raise ValueError('node_id must be a nonempty string')
    if type(lines) is not int or not 1 <= lines <= 100:
        raise ValueError('lines must be an integer between 1 and 100')
    if expected_index_id is not None and (
        not isinstance(expected_index_id, str)
        or re.fullmatch(r'[0-9a-f]{64}', expected_index_id) is None
    ):
        raise ValueError('expected_index_id must be 64 lowercase hexadecimal characters')


def source_node(index: dict, node_id: str, lines: int = 20,
                expected_index_id: str | None = None) -> dict:
    """Read one exact graph ID; callers enforce snapshot freshness around the read."""
    validate_source_node_options(node_id, lines, expected_index_id)
    if expected_index_id is not None and expected_index_id != index['index_id']:
        raise ValueError('expected index does not match the current index')
    graph = json.loads(Path(index['graph']).read_text())
    found = [node for node in graph['nodes'] if node.get('id') == node_id]
    if len(found) != 1:
        raise ValueError(f'expected one exact source node ID, found {len(found)}: {node_id}')
    node = found[0]
    return {'node': node, **source_excerpt(Path(index['source']), node, lines)}


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
