#!/usr/bin/env python3
"""Validate project success documents; this does not certify runtime readiness."""
from __future__ import annotations
import argparse
import datetime as dt
import json
import re
from pathlib import Path
from urllib.parse import unquote

FIELDS = {"project", "purpose", "kind", "mainline", "usable_tag", "reviewed", "source_commit"}
KINDS = {"application", "service", "tool", "lab", "reference", "archived"}
HEADINGS = ("主線與範圍", "驗收條件", "現況與缺口", "啟動與驗證", "可用版本")
LINK = re.compile(r"\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)")
SHA = re.compile(r"[0-9a-f]{40}")

def parse(text):
    if not text.startswith("---\n") or "\n---\n" not in text[4:]:
        raise ValueError("missing frontmatter")
    front, body = text[4:].split("\n---\n", 1)
    meta = {}
    for line in front.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        if ":" not in line:
            raise ValueError("invalid frontmatter line")
        key, value = line.split(":", 1)
        if key in meta:
            raise ValueError("duplicate field: " + key)
        meta[key] = value.strip()
    if FIELDS - meta.keys():
        raise ValueError("missing fields: " + ", ".join(sorted(FIELDS - meta.keys())))
    return meta, body

def local_links(path, text, root):
    errors = []
    for target in LINK.findall(text):
        if re.match(r"[a-zA-Z][a-zA-Z0-9+.-]*:", target) or target.startswith("#"):
            continue
        target = unquote(target.split("#", 1)[0].split("?", 1)[0])
        dest = (path.parent / target).resolve()
        if not dest.is_relative_to(root.resolve()) or not dest.exists():
            errors.append("broken/outside local link: " + target)
    return errors

def valid_project_path(root, project):
    path = Path(project)
    return (not path.is_absolute() and len(path.parts) >= 2
            and ".." not in path.parts and path.as_posix() == project
            and (root / path).resolve().is_relative_to(root.resolve()))

def check_contract(root, project, navigation=True):
    if not valid_project_path(root, project):
        return {}, ["invalid/outside inventory project path"]
    path = root / project / "SUCCESS.md"
    if not path.resolve().is_relative_to(root.resolve()):
        return {}, ["invalid/outside SUCCESS path"]
    errors = []
    if not path.is_file():
        return {}, ["missing SUCCESS.md"]
    text = path.read_text(encoding="utf-8")
    try:
        meta, body = parse(text)
    except ValueError as exc:
        return {}, [str(exc)]
    if meta["project"] != project:
        errors.append("project does not match inventory path")
    if not meta["purpose"]:
        errors.append("purpose is empty")
    if meta["kind"] not in KINDS:
        errors.append("invalid kind")
    if meta["mainline"] not in {"complete", "incomplete", "not-applicable"}:
        errors.append("invalid mainline")
    if meta["mainline"] == "not-applicable" and meta["kind"] not in {"reference", "archived"}:
        errors.append("not-applicable requires reference/archived kind")
    try:
        dt.date.fromisoformat(meta["reviewed"])
    except ValueError:
        errors.append("invalid reviewed date")
    if not SHA.fullmatch(meta["source_commit"]):
        errors.append("source_commit must be a full SHA")
    for heading in HEADINGS:
        if not re.search(r"^## " + re.escape(heading) + r"\s*$", body, re.M):
            errors.append("missing heading: " + heading)
    rows = []
    for line in body.splitlines():
        if re.match(r"\|\s*AC-\d+\s*\|", line):
            cells = [v.strip() for v in line.strip().strip("|").split("|")]
            if len(cells) != 4 or cells[2] not in {"passed", "historical", "pending", "failed"}:
                errors.append("AC row must have ID, Given/When/Then, status, evidence")
                continue
            rows.append(cells)
            if not all(word in cells[1] for word in ("Given", "When", "Then")):
                errors.append(cells[0] + ": needs concrete Given/When/Then")
            if not cells[3]:
                errors.append(cells[0] + ": evidence or missing-evidence reason is required")
    if len(rows) < 2:
        errors.append("at least two concrete AC rows are required")
    if len({r[0] for r in rows}) != len(rows):
        errors.append("duplicate AC ID")
    if meta["mainline"] == "complete" and any(r[2] in {"pending", "failed"} for r in rows):
        errors.append("complete mainline has unpassed AC")
    tag = meta["usable_tag"]
    if tag != "none":
        if not re.fullmatch(r"usable/[a-z0-9][a-z0-9_-]*/v\d+\.\d+\.\d+", tag):
            errors.append("invalid usable tag")
        if meta["mainline"] != "complete" or meta["kind"] in {"reference", "archived"}:
            errors.append("usable tag requires completed executable scope")
        q = meta.get("qualification", "")
        qual = (root / q).resolve()
        if not q or Path(q).is_absolute() or not qual.is_relative_to(root.resolve()) or not qual.is_file():
            errors.append("usable tag requires a local qualification record")
        else:
            record = qual.read_text(encoding="utf-8")
            expected = {"RESULT": "PASS", "Project": project, "Tag": tag, "Source": meta["source_commit"]}
            for key, value in expected.items():
                values = re.findall(r"^" + key + r": (.*)$", record, re.M)
                if values != [value]:
                    errors.append("qualification requires exact unique " + key + ": " + value)
            for item in ("Startup", "Core", "Checks"):
                values = re.findall(r"^" + item + r": (.*)$", record, re.M)
                if len(values) != 1 or not re.fullmatch(r".+ — passed", values[0]):
                    errors.append("qualification missing unique passed " + item)
            errors.extend(local_links(qual, record, root))
    errors.extend(local_links(path, text, root))
    if navigation:
        for filename in ("README.md", "AGENTS.md"):
            entry = path.parent / filename
            if not entry.resolve().is_relative_to(root.resolve()) or not entry.is_file() or not re.search(r"\]\((?:\./)?SUCCESS\.md(?:#[^)]*)?\)", entry.read_text(encoding="utf-8")):
                errors.append(filename + " must link SUCCESS.md")
    return meta, errors

def discovered_projects(root, inventory, excluded_roots=()):
    """Track component directories under the inventory's category roots."""
    roots = {p.name for p in root.iterdir() if p.is_dir() and not p.name.startswith(".") and p.name not in excluded_roots}
    found = set()
    for category in roots:
        for path in (root / category).iterdir():
            if not path.is_dir() or path.name.startswith("."):
                continue
            if path.name == "legacy":
                found.update(p.relative_to(root).as_posix() for p in path.iterdir() if p.is_dir() and not p.name.startswith("."))
            else:
                found.add(path.relative_to(root).as_posix())
    return found

def index_text(data, records):
    lines = ["# 項目主線與可用版本", "", "用途、主線、缺口及驗收以各項目的 SUCCESS.md 為準；一般版本 tag 不等於可用驗收。", "",
             "[共用規範](docs/project-success.md)。最後更新日是導入本規範前的盤點基準，核對日期見各 SUCCESS.md；不代表本次重跑全部產品。", "",
             "主線完成可依明示歷史證據保留；可用版本另需資格核對。未完成／待驗收包含尚缺實作或尚缺實測，具體原因見契約，不能一律解讀為無法啟動。", "",
             "| 項目 | Category | 用途 | 主線 | 可用版本 | 最後更新（盤點基準 UTC） |",
             "| --- | --- | --- | --- | --- | --- |"]
    labels = {"complete": "完成", "incomplete": "未完成／待驗收", "not-applicable": "參考／封存"}
    for item in data["projects"]:
        p = item["path"]
        m = records[p]
        raw_date = item.get("last_source_update")
        date = dt.datetime.fromisoformat(raw_date.replace("Z", "+00:00")).astimezone(dt.timezone.utc).date().isoformat() if raw_date else "unknown"
        tag = m["usable_tag"]
        version = "尚無已核准標記" if tag == "none" else f"[{tag}](https://github.com/{data['repository']}/tree/{tag}/{p})"
        purpose = m["purpose"].replace("|", "\\|")
        lines.append(f"| [{p}]({p}/SUCCESS.md) | {p.rsplit('/', 1)[0]} | {purpose} | {labels[m['mainline']]} | {version} | {date} |")
    return "\n".join(lines) + "\n"

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--projects", nargs="+")
    parser.add_argument("--contracts-only", action="store_true")
    parser.add_argument("--write-index", action="store_true")
    args = parser.parse_args(argv)
    root = args.root.resolve()
    data = json.loads((root / "docs/project-success/inventory.json").read_text())
    projects = [p["path"] for p in data["projects"]]
    errors, records = [], {}
    if len(projects) != len(set(projects)):
        errors.append("duplicate inventory project")
    for project in projects:
        if not valid_project_path(root, project):
            errors.append("invalid/outside inventory project path: " + project)
    if errors:
        for error in errors:
            print("ERROR:", error)
        return 1
    exclusions = data.get("excluded_roots", {})
    if not isinstance(exclusions, dict) or any(not isinstance(reason, str) or not reason.strip() or Path(name).name != name for name, reason in exclusions.items()):
        print("ERROR: excluded_roots requires top-level names and explicit reasons")
        return 1
    categories = {Path(project).parts[0] for project in projects}
    if categories & exclusions.keys():
        errors.append("inventory category cannot be excluded")
    if not args.projects:
        unknown_roots = {p.name for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")} - categories - exclusions.keys()
        errors.extend("unclassified category root: " + p for p in sorted(unknown_roots))
        extra = discovered_projects(root, data["projects"], exclusions) - set(projects)
        errors.extend("untracked project: " + p for p in sorted(extra))
    for p in args.projects or projects:
        if p not in projects:
            errors.append("unknown project: " + p)
            continue
        meta, problems = check_contract(root, p, not args.contracts_only)
        records[p] = meta
        errors.extend(p + ": " + e for e in problems)
    if not errors and not args.projects and not args.contracts_only:
        expected = index_text(data, records)
        index = root / "PROJECTS.md"
        if args.write_index:
            index.write_text(expected, encoding="utf-8")
        elif not index.is_file() or index.read_text(encoding="utf-8") != expected:
            errors.append("PROJECTS.md is stale; run with --write-index")
    for error in errors:
        print("ERROR:", error)
    if errors:
        return 1
    print(f"PASS: {len(records)} project success contracts" + (" (contracts only)" if args.contracts_only else " and navigation/index"))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
