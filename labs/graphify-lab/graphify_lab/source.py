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
