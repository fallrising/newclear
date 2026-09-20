"""Offline export of one approved analysis into an immutable native study bundle."""
from __future__ import annotations

import ctypes
from dataclasses import dataclass
import datetime as _datetime
import errno
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import stat
import unicodedata
from types import MappingProxyType
from typing import Any, Mapping


class StudyExportError(ValueError):
    """The request, evidence, policy, or local publication boundary is invalid."""


@dataclass(frozen=True, slots=True)
class StudyBundle:
    bundle_id: str
    bundle_name: str
    manifest_sha256: str
    artifact_count: int

    def __post_init__(self) -> None:
        if (
            not _SHA.fullmatch(self.bundle_id)
            or self.bundle_name != self.bundle_id
            or not _SHA.fullmatch(self.manifest_sha256)
            or type(self.artifact_count) is not int
            or not 1 <= self.artifact_count <= 10
        ):
            raise StudyExportError("invalid study bundle evidence")


_SHA = re.compile(r"^[0-9a-f]{64}$")
_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_SOURCE_ID = re.compile(r"^[A-Z][A-Z0-9-]{1,63}$")
_REGION = re.compile(
    r"^(?:text:(?:0|[1-9][0-9]{0,6}),0,[1-9][0-9]{0,6}|"
    r"pixels:(?:0|[1-9][0-9]{0,5}),(?:0|[1-9][0-9]{0,5}),"
    r"[1-9][0-9]{0,5},[1-9][0-9]{0,5})$"
)
_VERSION = "study-publication.v1"
_TARGET_VERSION = "doc-analysis-study.v1"
_SENSITIVITY = ("Public", "Internal", "Restricted", "Prohibited")
_EVIDENCE = ("Confirmed", "Strong inference", "Open")
_QA = ("Accepted", "Narrowed", "Rejected", "No result", "Unresolved")
_METHODS = ("pdf-text", "ocr", "ocr-pbm")
_SECRET = re.compile(r"(?i)(?:api[_-]?key|token|password|secret)\s*[:=]")
_MARKUP = re.compile(r"(?:https?://|ssh://|file://|git@|[\[\]<>`!])", re.I)
_PRIVATE = re.compile(
    r"(?:\b(?:10|127)\.(?:\d{1,3}\.){2}\d{1,3}\b|"
    r"\b192\.168\.(?:\d{1,3}\.)\d{1,3}\b|"
    r"\b172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3}\b|"
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b)"
)
_ABSOLUTE_PATH = re.compile(r"(?:^|\\s)/(?:[^\\s|]+)")
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_DIRECTORY = getattr(os, "O_DIRECTORY", 0)
_RENAME_NOREPLACE = 1
_MAX_INPUT_BYTES = 8 * 1024 * 1024
_REQUEST_FIELDS = {
    "analysis_ids", "config_digest", "decision_ids", "evidence_cutoff",
    "evidence_ledger_sha256", "owner", "qa_ids", "research_question",
    "sensitivity", "slug", "source_batch_digest", "source_ids",
    "supersedes", "title", "tool_digest",
}


def _canonical(value: object) -> bytes:
    try:
        text = json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
            allow_nan=False,
        )
        return (text + "\n").encode("ascii")
    except (TypeError, ValueError, UnicodeError) as exc:
        raise StudyExportError("value is not canonical JSON") from exc


def _digest(value: object) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _fail(condition: bool, message: str) -> None:
    if condition:
        raise StudyExportError(message)


def _safe_text(value: object, maximum: int, label: str) -> str:
    _fail(not isinstance(value, str) or not value.strip(), "invalid " + label)
    normalized = unicodedata.normalize("NFKC", value)
    try:
        size = len(value.encode("utf-8"))
    except UnicodeError as exc:
        raise StudyExportError("invalid " + label) from exc
    _fail(normalized != value or len(value) > maximum or size > maximum * 4,
          "invalid " + label)
    _fail(bool(
        _SECRET.search(value) or _MARKUP.search(value) or _PRIVATE.search(value)
        or _ABSOLUTE_PATH.search(value)
    ), "unsafe " + label)
    for character in value:
        code = ord(character)
        category = unicodedata.category(character)
        _fail(
            not character.isprintable()
            or category in {"Cc", "Cf", "Cs"}
            or (code & 0xFFFF) in {0xFFFE, 0xFFFF},
            "unsafe " + label,
        )
    return value


def _snapshot(value: object, label: str) -> Any:
    try:
        return json.loads(_canonical(value).decode("ascii"))
    except (json.JSONDecodeError, UnicodeError, StudyExportError) as exc:
        raise StudyExportError("invalid " + label) from exc


def _strict_json(raw: bytes, label: str) -> Any:
    duplicate = False
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        nonlocal duplicate
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                duplicate = True
            result[key] = value
        return result
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise StudyExportError("invalid " + label) from exc
    if duplicate or _canonical(value) != raw:
        raise StudyExportError("non-canonical " + label)
    return value


def _absolute_path(value: os.PathLike[str] | str, label: str) -> Path:
    try:
        raw = os.fspath(value)
    except TypeError as exc:
        raise StudyExportError("unsafe " + label) from exc
    if (
        not isinstance(raw, str) or not raw or "\x00" in raw or "\\" in raw
        or not os.path.isabs(raw) or raw != Path(raw).as_posix()
        or ".." in Path(raw).parts or Path(raw) == Path(Path(raw).anchor)
    ):
        raise StudyExportError("unsafe " + label)
    return Path(raw)


def _open_directory(path: Path, *, create: bool, label: str) -> int:
    if not _NOFOLLOW or not _DIRECTORY:
        raise StudyExportError("required no-follow filesystem controls unavailable")
    try:
        descriptor = os.open(path.anchor, os.O_RDONLY | _DIRECTORY | _NOFOLLOW)
        for component in path.parts[1:]:
            try:
                next_descriptor = os.open(
                    component, os.O_RDONLY | _DIRECTORY | _NOFOLLOW,
                    dir_fd=descriptor,
                )
            except FileNotFoundError:
                if not create:
                    raise
                try:
                    os.mkdir(component, 0o700, dir_fd=descriptor)
                except FileExistsError:
                    pass
                next_descriptor = os.open(
                    component, os.O_RDONLY | _DIRECTORY | _NOFOLLOW,
                    dir_fd=descriptor,
                )
            os.close(descriptor)
            descriptor = next_descriptor
        return descriptor
    except OSError as exc:
        try:
            os.close(descriptor)
        except (OSError, UnboundLocalError):
            pass
        raise StudyExportError("unsafe " + label) from exc


def _same_directory(path: Path, descriptor: int) -> bool:
    try:
        current = _open_directory(path, create=False, label="state root")
    except StudyExportError:
        return False
    try:
        expected, actual = os.fstat(descriptor), os.fstat(current)
        return (expected.st_dev, expected.st_ino) == (actual.st_dev, actual.st_ino)
    finally:
        os.close(current)


def _read_regular(path: Path, maximum: int, label: str) -> bytes:
    parent = _absolute_path(path.parent, label + " parent")
    parent_fd = _open_directory(parent, create=False, label=label + " parent")
    try:
        try:
            descriptor = os.open(path.name, os.O_RDONLY | _NOFOLLOW, dir_fd=parent_fd)
        except OSError as exc:
            raise StudyExportError("unreadable " + label) from exc
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < before.st_size <= maximum:
                raise StudyExportError("invalid " + label)
            content = bytearray()
            while len(content) < before.st_size:
                chunk = os.read(descriptor, min(65_536, before.st_size - len(content)))
                if not chunk:
                    raise StudyExportError("changed " + label)
                content.extend(chunk)
            after = os.fstat(descriptor)
            fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
            if os.read(descriptor, 1) or any(getattr(before, key) != getattr(after, key) for key in fields):
                raise StudyExportError("changed " + label)
            return bytes(content)
        finally:
            os.close(descriptor)
    finally:
        os.close(parent_fd)


def load_json_file(path: os.PathLike[str] | str, *, maximum: int = _MAX_INPUT_BYTES) -> Any:
    source = _absolute_path(path, "JSON input")
    return _strict_json(_read_regular(source, maximum, "JSON input"), "JSON input")


def load_publication_config(path: os.PathLike[str] | str | None = None) -> Mapping[str, Any]:
    source = (
        _absolute_path(path, "publication config")
        if path is not None
        else Path(__file__).resolve().parents[2] / "config" / "study-publication.json"
    )
    value = _strict_json(_read_regular(source, 128 * 1024, "publication config"), "publication config")
    fields = {
        "artifact_max_bytes", "claim_max_chars", "config_version",
        "max_artifacts", "max_sources", "reference_max_chars",
        "report_max_bytes", "sensitivity_publication", "slug_max_chars",
        "target_contract_version", "title_max_chars",
    }
    _fail(not isinstance(value, dict) or set(value) != fields, "invalid publication config")
    _fail(value["config_version"] != _VERSION or value["target_contract_version"] != _TARGET_VERSION,
          "unsupported publication config")
    ceilings = {
        "artifact_max_bytes": 32_768, "claim_max_chars": 4_000,
        "max_artifacts": 100, "max_sources": 100,
        "reference_max_chars": 512, "report_max_bytes": 262_144,
        "slug_max_chars": 80, "title_max_chars": 160,
    }
    for key, ceiling in ceilings.items():
        _fail(type(value[key]) is not int or not 1 <= value[key] <= ceiling,
              "publication config exceeds code maximum")
    expected_policy = {
        "Internal": ["approved-analysis", "metadata"],
        "Prohibited": [],
        "Public": ["approved-analysis", "metadata"],
        "Restricted": ["aggregate", "redacted"],
    }
    _fail(value["sensitivity_publication"] != expected_policy, "invalid sensitivity policy")
    return MappingProxyType(value)


def _selected(value: object, maximum: int, label: str, *, allow_empty: bool = False) -> tuple[str, ...]:
    if not isinstance(value, list) or len(value) > maximum or (not value and not allow_empty):
        raise StudyExportError("invalid " + label)
    result = tuple(value)
    if any(not isinstance(item, str) for item in result) or tuple(sorted(set(result))) != result:
        raise StudyExportError("invalid " + label)
    return result


def _record(ledger: object, identifier: str, kind: str) -> dict[str, Any]:
    _fail(not isinstance(ledger, dict) or not _SHA.fullmatch(identifier), "missing " + kind)
    item = ledger.get(identifier)
    _fail(not isinstance(item, dict) or set(item) != {"body", "id", "kind"}, "invalid " + kind)
    _fail(item["id"] != identifier or item["kind"] != kind or not isinstance(item["body"], dict),
          "invalid " + kind)
    _fail(_digest({"body": item["body"], "kind": kind}) != identifier, "forged " + kind)
    return item["body"]


def _validate_date(value: object) -> str:
    _fail(not isinstance(value, str), "invalid evidence cutoff")
    try:
        parsed = _datetime.date.fromisoformat(value)
    except ValueError as exc:
        raise StudyExportError("invalid evidence cutoff") from exc
    _fail(parsed.isoformat() != value, "invalid evidence cutoff")
    return value


def _validate(
    request_input: Mapping[str, object], evidence_input: Mapping[str, object], config: Mapping[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    request = _snapshot(request_input, "export request")
    evidence = _snapshot(evidence_input, "evidence ledger")
    _fail(not isinstance(request, dict) or set(request) != _REQUEST_FIELDS, "invalid export request")
    _fail(not isinstance(evidence, dict) or set(evidence) != {"analyses", "chunks", "decisions", "qa", "sources"},
          "invalid evidence ledger")
    _fail(request["evidence_ledger_sha256"] != _digest(evidence), "evidence ledger binding mismatch")
    slug = request["slug"]
    _fail(not isinstance(slug, str) or not _SLUG.fullmatch(slug)
          or len(slug) > config["slug_max_chars"], "invalid slug")
    title = _safe_text(request["title"], config["title_max_chars"], "title")
    question = _safe_text(request["research_question"], config["claim_max_chars"], "research question")
    owner = _safe_text(request["owner"], config["reference_max_chars"], "owner")
    cutoff = _validate_date(request["evidence_cutoff"])
    sensitivity = request["sensitivity"]
    _fail(sensitivity not in _SENSITIVITY or sensitivity == "Prohibited", "study cannot be exported")
    supersedes = _selected(request["supersedes"], 20, "supersession", allow_empty=True)
    _fail(any(not _SLUG.fullmatch(item) or item == slug for item in supersedes), "invalid supersession")
    source_records = _selected(request["source_ids"], config["max_sources"], "source selection")
    analyses = _selected(request["analysis_ids"], config["max_artifacts"], "analysis selection")
    qas = _selected(request["qa_ids"], config["max_artifacts"], "QA selection")
    decisions = _selected(request["decision_ids"], config["max_artifacts"], "decision selection")
    for field in ("source_batch_digest", "config_digest", "tool_digest"):
        _fail(not isinstance(request[field], str) or not _SHA.fullmatch(request[field]), "invalid evidence binding")

    sources: list[dict[str, Any]] = []
    chunks_by_id: dict[str, dict[str, Any]] = {}
    chunk_record_ids: set[str] = set()
    stable_source_ids: set[str] = set()
    for record_id in source_records:
        body = _record(evidence["sources"], record_id, "source")
        fields = {
            "chunk_evidence_ids", "config_digest", "content_sha256",
            "extraction_sha256", "provenance", "publication", "redistribution",
            "rights", "sensitivity", "source_batch_digest", "source_id",
            "tool_digest",
        }
        _fail(set(body) != fields or not _SOURCE_ID.fullmatch(str(body.get("source_id", ""))),
              "invalid source evidence")
        _fail(body["source_id"] in stable_source_ids, "duplicate stable source ID")
        stable_source_ids.add(body["source_id"])
        for field in ("content_sha256", "extraction_sha256", "source_batch_digest", "config_digest", "tool_digest"):
            _fail(not isinstance(body[field], str) or not _SHA.fullmatch(body[field]), "invalid source digest")
        _fail(any(body[field] != request[field] for field in ("source_batch_digest", "config_digest", "tool_digest")),
              "source selection drift")
        _fail(body["rights"] != "confirmed" or body["sensitivity"] != sensitivity,
              "source policy not approved")
        _safe_text(body["provenance"], config["reference_max_chars"], "source provenance")
        _safe_text(body["redistribution"], config["reference_max_chars"], "redistribution")
        _fail(body["publication"] not in config["sensitivity_publication"][sensitivity],
              "source publication is not approved")
        selected_chunks = _selected(body["chunk_evidence_ids"], config["max_artifacts"], "chunk evidence")
        for chunk_record_id in selected_chunks:
            _fail(chunk_record_id in chunk_record_ids, "duplicate chunk evidence")
            chunk_record_ids.add(chunk_record_id)
            chunk = _record(evidence["chunks"], chunk_record_id, "chunk")
            chunk_fields = {
                "chunk_id", "confidence", "config_digest", "extraction_sha256",
                "method", "page_number", "region", "source_batch_digest",
                "source_sha256", "text_sha256", "tool_digest",
            }
            _fail(set(chunk) != chunk_fields, "invalid chunk evidence")
            for field in ("chunk_id", "source_sha256", "text_sha256", "extraction_sha256",
                          "source_batch_digest", "config_digest", "tool_digest"):
                _fail(not isinstance(chunk[field], str) or not _SHA.fullmatch(chunk[field]),
                      "invalid chunk digest")
            _fail(chunk["source_sha256"] != body["content_sha256"]
                  or chunk["extraction_sha256"] != body["extraction_sha256"], "chunk source drift")
            _fail(any(chunk[field] != request[field] for field in ("source_batch_digest", "config_digest", "tool_digest")),
                  "chunk binding drift")
            _fail(type(chunk["page_number"]) is not int or not 1 <= chunk["page_number"] <= 1000
                  or chunk["method"] not in _METHODS or not isinstance(chunk["region"], str)
                  or not _REGION.fullmatch(chunk["region"]), "invalid chunk provenance")
            _fail(type(chunk["confidence"]) not in (int, float)
                  or not math.isfinite(chunk["confidence"]) or not 0 <= chunk["confidence"] <= 1,
                  "invalid chunk confidence")
            _fail(chunk["chunk_id"] in chunks_by_id, "duplicate chunk ID")
            chunks_by_id[chunk["chunk_id"]] = chunk
        sources.append(body)

    claims: list[dict[str, Any]] = []
    cited_sources: set[str] = set()
    cited_chunks: set[str] = set()
    for analysis_id in analyses:
        body = _record(evidence["analyses"], analysis_id, "analysis")
        _fail(set(body) != {"claims", "publication", "study_slug"} or body["study_slug"] != slug
              or body["publication"] not in config["sensitivity_publication"][sensitivity],
              "invalid analysis evidence")
        _fail(not isinstance(body["claims"], list) or not body["claims"]
              or len(body["claims"]) > config["max_artifacts"], "invalid claims")
        for claim in body["claims"]:
            fields = {"chunk_ids", "claim", "evidence", "finding", "missing_proof", "source_ids"}
            _fail(not isinstance(claim, dict) or set(claim) != fields
                  or claim["evidence"] not in _EVIDENCE, "invalid claim")
            claim_sources = _selected(claim["source_ids"], config["max_sources"], "claim sources")
            claim_chunks = _selected(claim["chunk_ids"], config["max_artifacts"], "claim chunks")
            _fail(not set(claim_sources) <= stable_source_ids or not set(claim_chunks) <= set(chunks_by_id),
                  "dangling citation")
            for field in ("claim", "finding", "missing_proof"):
                _safe_text(claim[field], config["claim_max_chars"], field)
            cited_sources.update(claim_sources)
            cited_chunks.update(claim_chunks)
            claims.append(claim)
    _fail(cited_sources != stable_source_ids or cited_chunks != set(chunks_by_id),
          "selected evidence is not fully cited")

    qa_rows: list[dict[str, Any]] = []
    reviewed_analyses: set[str] = set()
    for qa_id in qas:
        body = _record(evidence["qa"], qa_id, "qa")
        _fail(set(body) != {"analysis_ids", "disposition", "finding", "reviewer", "study_slug"}
              or body["study_slug"] != slug or body["disposition"] not in _QA
              or body["disposition"] not in {"Accepted", "Narrowed"},
              "invalid QA evidence")
        qa_analyses = _selected(body["analysis_ids"], config["max_artifacts"], "QA analyses")
        _fail(not set(qa_analyses) <= set(analyses), "QA cites unselected analysis")
        _safe_text(body["reviewer"], config["reference_max_chars"], "reviewer")
        _safe_text(body["finding"], config["claim_max_chars"], "QA finding")
        reviewed_analyses.update(qa_analyses)
        qa_rows.append(body)
    _fail(reviewed_analyses != set(analyses), "selected analysis is not fully reviewed")

    approved: set[str] = set()
    publication_approvals = 0
    for decision_id in decisions:
        body = _record(evidence["decisions"], decision_id, "decision")
        _fail(set(body) != {"approver", "artifact_id", "decision", "scope", "study_slug"}
              or body["study_slug"] != slug or body["decision"] != "Approved"
              or body["scope"] not in {"artifact", "publication"}, "invalid approval")
        _safe_text(body["approver"], config["reference_max_chars"], "approver")
        if body["scope"] == "publication":
            _fail(body["artifact_id"] != "publication:" + slug, "invalid publication approval")
            publication_approvals += 1
        else:
            _fail(body["artifact_id"] in approved, "duplicate artifact approval")
            approved.add(body["artifact_id"])
    required_approvals = set(source_records) | chunk_record_ids | set(analyses) | set(qas)
    _fail(publication_approvals != 1 or required_approvals != approved,
          "invalid human approval set")
    data = {
        "claims": claims, "cutoff": cutoff, "owner": owner, "qa": qa_rows,
        "question": question, "sensitivity": sensitivity, "slug": slug,
        "sources": sources, "supersedes": supersedes, "title": title,
    }
    ids = {
        "analysis_ids": analyses, "chunk_evidence_ids": tuple(sorted(chunk_record_ids)),
        "chunk_ids": tuple(sorted(chunks_by_id)), "decision_ids": decisions,
        "qa_ids": qas, "source_ids": tuple(sorted(stable_source_ids)),
        "source_record_ids": source_records,
    }
    return data, ids


def _cell(value: object) -> str:
    return str(value).replace("|", "\\|")


def _render(data: Mapping[str, Any]) -> dict[str, bytes]:
    slug, cutoff = data["slug"], data["cutoff"]
    supersedes = ", ".join(data["supersedes"]) or "—"
    readme = f"""# {data['title']}

| Field | Value |
| --- | --- |
| Slug | `{slug}` |
| Status | Complete |
| Last updated | {cutoff} |
| Source types | Document |
| Evidence cutoff | {cutoff} |
| Source availability | local |
| Sensitivity | {data['sensitivity']} |
| Owner | {data['owner']} |
| Supersedes | {supersedes} |
| Superseded by | — |

{data['question']} The publication boundary contains approved analysis and metadata only; raw and extracted source content remains outside Git.

## Start here

- [Progress](progress.md)
- [Source inventory](sources.md)
- [Analysis overview](analysis/overview.md)
- [QA record](analysis/qa-review.md)

## Scope

This bundle contains one reviewed document-analysis study selected by immutable source and chunk evidence.

## Evidence boundary

Claims retain source and chunk identifiers; private raw files, OCR text, and local paths are excluded.

## Completion criteria

All selected evidence is cited, QA-reviewed, and explicitly approved for publication.
"""
    sources = [
        "# Source inventory and publication decisions", "", "## Sources", "",
        "| ID | Type | Stable reference | Provenance and date | Integrity/extraction | Sensitivity | Redistribution | Publication status |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in data["sources"]:
        sources.append(
            f"| `{row['source_id']}` | Document | SHA-256 `{row['content_sha256']}` | "
            f"{_cell(row['provenance'])}; {cutoff} | Extraction `{row['extraction_sha256']}` | "
            f"{row['sensitivity']} | {_cell(row['redistribution'])} | {row['publication']} |"
        )
    sources.extend([
        "", "## Declared sensitive-data classes", "",
        "- Credentials, keys, and tokens", "- Personal and domain-confidential data",
        "- Licensed or copyrighted source content", "", "## Publication approvals", "",
        "| Artifact class | Decision | Approver | Date | Decision reference | Conditions |",
        "| --- | --- | --- | --- | --- | --- |",
        f"| Analysis Markdown | Approved | {data['owner']} | {cutoff} | Immutable bundle manifest | Approved analysis only |",
        "| Raw sources | Not approved | — | — | — | Keep outside Git |",
        "| Extracted content | Not approved | — | — | — | Keep outside Git |",
        "", "## Open source questions", "", "- None recorded in the approved export selection.",
    ])
    overview = [
        "# Analysis overview", "", "## Research question", "", data["question"], "",
        "## Evidence map", "",
        "| Claim | Evidence level | Source IDs | Chunk IDs | Finding | Missing proof |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for claim in data["claims"]:
        overview.append(
            "| " + " | ".join((
                _cell(claim["claim"]), claim["evidence"],
                ", ".join("`" + item + "`" for item in claim["source_ids"]),
                ", ".join("`" + item + "`" for item in claim["chunk_ids"]),
                _cell(claim["finding"]), _cell(claim["missing_proof"]),
            )) + " |"
        )
    overview.extend([
        "", "## Findings", "", "The evidence map contains the complete approved findings.",
        "", "## Risks and improvements", "", "No unapproved source content is reproduced.",
        "", "## Limitations", "", "Conclusions are bounded by the declared evidence cutoff and selected citations.",
    ])
    qa = [
        "# QA review", "", "## Review log", "",
        "| Date | Reviewer | Scope and method | Result |", "| --- | --- | --- | --- |",
    ]
    for row in data["qa"]:
        qa.append(f"| {cutoff} | {_cell(row['reviewer'])} | Selected analysis and citations | {row['disposition']} |")
    qa.extend([
        "", "## Findings and dispositions", "",
        "| Finding | Evidence checked | Disposition | Change |", "| --- | --- | --- | --- |",
    ])
    for row in data["qa"]:
        qa.append(f"| {_cell(row['finding'])} | Selected immutable analysis IDs | {row['disposition']} | Approved export |")
    progress = f"""# Study progress

## Current status

- Status: Complete
- Active step: None
- Last updated: {cutoff}

## Completed

- Selected evidence, QA, and publication decisions validated.
- Native study bundle rendered.

## In progress

- None.

## Blocked

- None.

## Validation record

| Date | Command or review | Result |
| --- | --- | --- |
| {cutoff} | Target repository validation | Pending isolated publisher run |

## Remaining work

- Preview the bundle in an isolated target checkout.

## Resume point

Run the isolated local publisher; GitHub publication remains a separate explicit action.
"""
    registry = (
        f"| [{data['title']}](studies/{slug}/README.md) | Complete | Document | "
        f"{data['sensitivity']} | {cutoff} |\n"
    )
    text = {
        "registry-row.md": registry,
        f"studies/{slug}/README.md": readme,
        f"studies/{slug}/analysis/overview.md": "\n".join(overview) + "\n",
        f"studies/{slug}/analysis/qa-review.md": "\n".join(qa) + "\n",
        f"studies/{slug}/progress.md": progress,
        f"studies/{slug}/sources.md": "\n".join(sources) + "\n",
    }
    return {path: content.encode("utf-8") for path, content in text.items()}


def _mkdir_at(parent_fd: int, name: str) -> int:
    os.mkdir(name, 0o700, dir_fd=parent_fd)
    return os.open(name, os.O_RDONLY | _DIRECTORY | _NOFOLLOW, dir_fd=parent_fd)


def _write_at(parent_fd: int, name: str, content: bytes) -> None:
    descriptor = os.open(
        name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | _NOFOLLOW, 0o600,
        dir_fd=parent_fd,
    )
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        try:
            os.unlink(name, dir_fd=parent_fd)
        except OSError:
            pass
        raise


def _rename_noreplace(root_fd: int, source: str, destination: str) -> None:
    try:
        function = ctypes.CDLL(None, use_errno=True).renameat2
    except (AttributeError, OSError) as exc:
        raise OSError(errno.ENOSYS, "atomic no-replace unavailable") from exc
    function.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    function.restype = ctypes.c_int
    if function(root_fd, source.encode("ascii"), root_fd, destination.encode("ascii"), _RENAME_NOREPLACE):
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def _remove_stage(root_fd: int, stage: str, slug: str) -> None:
    try:
        stage_fd = os.open(stage, os.O_RDONLY | _DIRECTORY | _NOFOLLOW, dir_fd=root_fd)
    except OSError:
        return
    try:
        studies_fd = study_fd = analysis_fd = None
        try:
            studies_fd = os.open(
                "studies", os.O_RDONLY | _DIRECTORY | _NOFOLLOW, dir_fd=stage_fd,
            )
            study_fd = os.open(
                slug, os.O_RDONLY | _DIRECTORY | _NOFOLLOW, dir_fd=studies_fd,
            )
            analysis_fd = os.open(
                "analysis", os.O_RDONLY | _DIRECTORY | _NOFOLLOW, dir_fd=study_fd,
            )
            for name in ("overview.md", "qa-review.md"):
                try:
                    os.unlink(name, dir_fd=analysis_fd)
                except FileNotFoundError:
                    pass
        except OSError:
            pass
        finally:
            if analysis_fd is not None:
                os.close(analysis_fd)
            if study_fd is not None:
                try:
                    os.rmdir("analysis", dir_fd=study_fd)
                except OSError:
                    pass
                for name in ("README.md", "progress.md", "sources.md"):
                    try:
                        os.unlink(name, dir_fd=study_fd)
                    except FileNotFoundError:
                        pass
                os.close(study_fd)
            if studies_fd is not None:
                try:
                    os.rmdir(slug, dir_fd=studies_fd)
                except OSError:
                    pass
                os.close(studies_fd)
            try:
                os.rmdir("studies", dir_fd=stage_fd)
            except OSError:
                pass
        for name in ("registry-row.md", "manifest.json"):
            try: os.unlink(name, dir_fd=stage_fd)
            except FileNotFoundError: pass
    finally:
        os.close(stage_fd)
    try: os.rmdir(stage, dir_fd=root_fd)
    except OSError: pass


def _read_beneath(root_fd: int, relative: str, maximum: int) -> bytes:
    parts = relative.split("/")
    directory = os.dup(root_fd)
    try:
        for component in parts[:-1]:
            next_fd = os.open(component, os.O_RDONLY | _DIRECTORY | _NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = next_fd
        descriptor = os.open(parts[-1], os.O_RDONLY | _NOFOLLOW, dir_fd=directory)
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < before.st_size <= maximum:
                raise StudyExportError("bundle artifact is invalid")
            content = bytearray()
            while len(content) < before.st_size:
                part = os.read(descriptor, min(65_536, before.st_size - len(content)))
                if not part: raise StudyExportError("bundle artifact changed")
                content.extend(part)
            after = os.fstat(descriptor)
            fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
            if os.read(descriptor, 1) or any(getattr(before, field) != getattr(after, field) for field in fields):
                raise StudyExportError("bundle artifact changed")
            return bytes(content)
        finally:
            os.close(descriptor)
    except StudyExportError:
        raise
    except OSError as exc:
        raise StudyExportError("bundle artifact is invalid") from exc
    finally:
        os.close(directory)


def _validate_existing(root_fd: int, bundle_name: str, manifest: bytes,
                       artifacts: Mapping[str, bytes]) -> None:
    try:
        bundle_fd = os.open(bundle_name, os.O_RDONLY | _DIRECTORY | _NOFOLLOW, dir_fd=root_fd)
    except OSError as exc:
        raise StudyExportError("bundle collision") from exc
    studies_fd = study_fd = analysis_fd = None
    try:
        try:
            studies_fd = os.open(
                "studies", os.O_RDONLY | _DIRECTORY | _NOFOLLOW, dir_fd=bundle_fd,
            )
            study_names = os.listdir(studies_fd)
            if len(study_names) != 1:
                raise StudyExportError("bundle collision")
            study_fd = os.open(
                study_names[0], os.O_RDONLY | _DIRECTORY | _NOFOLLOW, dir_fd=studies_fd,
            )
            analysis_fd = os.open(
                "analysis", os.O_RDONLY | _DIRECTORY | _NOFOLLOW, dir_fd=study_fd,
            )
            if (
                set(os.listdir(bundle_fd)) != {"manifest.json", "registry-row.md", "studies"}
                or set(os.listdir(study_fd))
                != {"README.md", "analysis", "progress.md", "sources.md"}
                or set(os.listdir(analysis_fd)) != {"overview.md", "qa-review.md"}
            ):
                raise StudyExportError("bundle collision")
        except OSError as exc:
            raise StudyExportError("bundle collision") from exc
        if _read_beneath(bundle_fd, "manifest.json", len(manifest)) != manifest:
            raise StudyExportError("bundle collision")
        for path, content in artifacts.items():
            if _read_beneath(bundle_fd, path, len(content)) != content:
                raise StudyExportError("bundle collision")
    finally:
        for descriptor in (analysis_fd, study_fd, studies_fd):
            if descriptor is not None:
                os.close(descriptor)
        os.close(bundle_fd)


def _publish(root: Path, root_fd: int, bundle_name: str, slug: str,
             manifest: bytes, artifacts: Mapping[str, bytes]) -> None:
    try:
        os.stat(bundle_name, dir_fd=root_fd, follow_symlinks=False)
    except FileNotFoundError:
        pass
    except OSError as exc:
        raise StudyExportError("bundle collision") from exc
    else:
        _validate_existing(root_fd, bundle_name, manifest, artifacts)
        return
    stage = ".study-" + secrets.token_hex(16)
    try:
        stage_fd = _mkdir_at(root_fd, stage)
        try:
            studies_fd = _mkdir_at(stage_fd, "studies")
            study_fd = _mkdir_at(studies_fd, slug)
            analysis_fd = _mkdir_at(study_fd, "analysis")
            try:
                _write_at(stage_fd, "registry-row.md", artifacts["registry-row.md"])
                _write_at(study_fd, "README.md", artifacts[f"studies/{slug}/README.md"])
                _write_at(study_fd, "progress.md", artifacts[f"studies/{slug}/progress.md"])
                _write_at(study_fd, "sources.md", artifacts[f"studies/{slug}/sources.md"])
                _write_at(analysis_fd, "overview.md", artifacts[f"studies/{slug}/analysis/overview.md"])
                _write_at(analysis_fd, "qa-review.md", artifacts[f"studies/{slug}/analysis/qa-review.md"])
                _write_at(stage_fd, "manifest.json", manifest)
                os.fsync(analysis_fd); os.fsync(study_fd); os.fsync(studies_fd); os.fsync(stage_fd)
            finally:
                os.close(analysis_fd); os.close(study_fd); os.close(studies_fd)
        finally:
            os.close(stage_fd)
        _rename_noreplace(root_fd, stage, bundle_name)
        stage = ""
        os.fsync(root_fd)
        if not _same_directory(root, root_fd):
            raise StudyExportError("state root changed")
    except FileExistsError:
        _validate_existing(root_fd, bundle_name, manifest, artifacts)
    except StudyExportError:
        raise
    except OSError as exc:
        if exc.errno == errno.EEXIST:
            _validate_existing(root_fd, bundle_name, manifest, artifacts)
        else:
            raise StudyExportError("bundle publication failed") from exc
    finally:
        if stage:
            _remove_stage(root_fd, stage, slug)


def export_study(
    request: Mapping[str, object], evidence: Mapping[str, object],
    state_root: os.PathLike[str] | str, *,
    config_path: os.PathLike[str] | str | None = None,
) -> StudyBundle:
    config = load_publication_config(config_path)
    data, ids = _validate(request, evidence, config)
    artifacts = _render(data)
    if (
        len(artifacts) > config["max_artifacts"]
        or any(len(content) > config["artifact_max_bytes"] for content in artifacts.values())
        or sum(map(len, artifacts.values())) > config["report_max_bytes"]
    ):
        raise StudyExportError("rendered output exceeds bound")
    manifest_body = {
        "analysis_ids": list(ids["analysis_ids"]),
        "artifacts": [
            {"path": path, "sha256": hashlib.sha256(content).hexdigest()}
            for path, content in sorted(artifacts.items())
        ],
        "chunk_evidence_ids": list(ids["chunk_evidence_ids"]),
        "chunk_ids": list(ids["chunk_ids"]),
        "config_digest": request["config_digest"],
        "decision_ids": list(ids["decision_ids"]),
        "evidence_cutoff": request["evidence_cutoff"],
        "evidence_ledger_sha256": request["evidence_ledger_sha256"],
        "qa_ids": list(ids["qa_ids"]),
        "source_batch_digest": request["source_batch_digest"],
        "source_ids": list(ids["source_ids"]),
        "source_record_ids": list(ids["source_record_ids"]),
        "target_contract_version": config["target_contract_version"],
        "tool_digest": request["tool_digest"],
    }
    bundle_id = _digest(manifest_body)
    manifest = {"aggregate_digest": bundle_id, **manifest_body}
    manifest_bytes = _canonical(manifest)
    root = _absolute_path(state_root, "state root")
    root_fd = _open_directory(root, create=True, label="state root")
    try:
        _publish(root, root_fd, bundle_id, data["slug"], manifest_bytes, artifacts)
    finally:
        os.close(root_fd)
    return StudyBundle(bundle_id, bundle_id, hashlib.sha256(manifest_bytes).hexdigest(), len(artifacts))
