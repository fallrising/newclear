"""Persistent local-only CLI for the synthetic knowledge workflow."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from typing import Any

from .extraction import EXTRACTOR_VERSION, ExtractionError, ExtractedChunk, extract_bytes
from .knowledge_index import IndexError, KnowledgeIndex
from .document_batch import ProductionToolchain, run_batch
from .knowledge_store import (
    EXTRACTOR_INPUT_VERSION,
    MAX_SOURCE_BYTES,
    SCHEMA_VERSION,
    IntakeError,
    SourceStore,
    _content_details,
    _ensure_directory,
    _publish_exclusive,
    _read_regular_bytes,
    _reject_symlink_components,
    _safe_name,
    load_taxonomy,
)

_HASH = re.compile(r"^[0-9a-f]{64}$")
_MAX_EVIDENCE = 1_000_000


class CliError(ValueError):
    """A local stage contract or state-safety check failed."""


def _canonical(value: object) -> bytes:
    serialized = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    )
    return f"{serialized}\n".encode()


def _under(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def _state_root(raw: str | None) -> tuple[Path, Path]:
    repo = Path(os.path.abspath(os.getcwd()))
    _reject_symlink_components(repo)
    if not (repo / ".git").is_dir() or (repo / ".git").is_symlink():
        raise CliError("run knowledge from a repository root")
    root = repo / ".ice-maker" / "knowledge" if raw is None else Path(raw)
    if not root.is_absolute():
        root = repo / root
    root = Path(os.path.abspath(os.fspath(root)))
    _reject_symlink_components(root)
    if not _under(root, repo):
        raise CliError("state root must be contained in the current repository")
    if _under(root, repo / "knowledge"):
        raise CliError("runtime state cannot be stored under tracked knowledge paths")
    if _under(root, repo / ".git"):
        raise CliError("runtime state cannot be stored in repository metadata")
    return repo, root


def _json(path: Path, label: str) -> tuple[dict[str, Any], bytes]:
    _reject_symlink_components(path)
    try:
        raw = _read_regular_bytes(path, label=label, maximum=_MAX_EVIDENCE)
        duplicate = False
        def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
            nonlocal duplicate
            result: dict[str, Any] = {}
            for key, value in items:
                if key in result:
                    duplicate = True
                result[key] = value
            return result

        value = json.loads(raw.decode(), object_pairs_hook=pairs)
    except (IntakeError, UnicodeError, json.JSONDecodeError) as exc:
        raise CliError(f"{label} is unreadable or malformed") from exc
    if duplicate or not isinstance(value, dict) or raw != _canonical(value):
        raise CliError(f"{label} is not canonical")
    return value, raw


def _publish(path: Path, value: dict[str, object], label: str) -> None:
    _reject_symlink_components(path)
    _ensure_directory(path.parent)
    content = _canonical(value)
    try:
        _publish_exclusive(path, content)
    except FileExistsError:
        existing, raw = _json(path, label)
        if existing != value or raw != content:
            raise CliError(f"persisted {label} conflicts with this input")
    except (IntakeError, OSError) as exc:
        raise CliError(f"{label} publication failed") from exc


def _manifest(root: Path, identifier: str) -> tuple[dict[str, Any], bytes]:
    if not _HASH.fullmatch(identifier):
        raise CliError("manifest identifier must be a SHA-256")
    manifest, _ = _json(root / "manifests" / f"{identifier}.json", "manifest")
    try:
        source = _read_regular_bytes(
            root / "quarantine" / identifier,
            label="quarantined source",
            maximum=MAX_SOURCE_BYTES,
        )
        mime, digest, findings = _content_details(source)
    except IntakeError as exc:
        raise CliError("quarantined source is invalid") from exc
    required = {
        "byte_count", "data_class", "extractor_input_version", "local_only",
        "mime", "original_name", "provider_eligible", "quarantine_object",
        "rights_decision", "schema_version", "sensitive_findings", "sha256",
    }
    rights = manifest.get("rights_decision")
    data_class = manifest.get("data_class")
    name = manifest.get("original_name")
    if (
        set(manifest) != required
        or digest != identifier
        or rights not in {"confirmed", "unconfirmed", "denied"}
        or data_class not in {"public", "internal", "confidential", "restricted"}
        or not isinstance(name, str)
        or _safe_name(name) != name
    ):
        raise CliError("manifest schema or policy is invalid")
    eligible = rights == "confirmed" and data_class in {"public", "internal"} and not findings
    expected = {
        "byte_count": len(source),
        "data_class": data_class,
        "extractor_input_version": EXTRACTOR_INPUT_VERSION,
        "local_only": not eligible,
        "mime": mime,
        "original_name": name,
        "provider_eligible": eligible,
        "quarantine_object": f"quarantine/{identifier}",
        "rights_decision": rights,
        "schema_version": SCHEMA_VERSION,
        "sensitive_findings": findings,
        "sha256": identifier,
    }
    if manifest != expected:
        raise CliError("manifest does not match immutable source policy")
    return manifest, source

def _chunk_dicts(chunks: tuple[ExtractedChunk, ...]) -> list[dict[str, object]]:
    return [
        {
            "chunk_id": chunk.chunk_id,
            "confidence": chunk.confidence,
            "method": chunk.method,
            "page_number": chunk.page_number,
            "region": chunk.region,
            "source_sha256": chunk.source_sha256,
            "text": chunk.text,
        }
        for chunk in chunks
    ]


def _extract(root: Path, manifest_id: str) -> tuple[dict[str, object], tuple[ExtractedChunk, ...]]:
    _, source = _manifest(root, manifest_id)
    result = extract_bytes(source, cache_dir=root / "extractions")
    if result.source_sha256 != manifest_id:
        raise CliError("extraction source hash does not match manifest")
    body: dict[str, object] = {
        "chunks": _chunk_dicts(result.chunks),
        "extractor_version": EXTRACTOR_VERSION,
        "manifest_id": manifest_id,
        "source_sha256": manifest_id,
        "stage": "extract",
    }
    evidence = {"extraction_id": hashlib.sha256(_canonical(body)).hexdigest(), **body}
    _publish(
        root / "results" / "extract" / f"{evidence['extraction_id']}.json",
        evidence,
        "extract evidence",
    )
    return evidence, result.chunks


def _load_extract(
    root: Path,
    manifest_id: str,
    extraction_id: str,
    taxonomy_path: Path,
) -> tuple[dict[str, Any], tuple[ExtractedChunk, ...]]:
    if not _HASH.fullmatch(extraction_id):
        raise CliError("extraction identifier must be a SHA-256")
    evidence, _ = _json(
        root / "results" / "extract" / f"{extraction_id}.json",
        "extract evidence",
    )
    keys = {"extraction_id", "chunks", "extractor_version", "manifest_id", "source_sha256", "stage"}
    if set(evidence) != keys:
        raise CliError("extract evidence schema is invalid")
    body = {key: evidence[key] for key in keys - {"extraction_id"}}
    if (
        evidence["extraction_id"] != extraction_id
        or evidence.get("manifest_id") != manifest_id
        or evidence.get("source_sha256") != manifest_id
        or evidence.get("stage") != "extract"
        or evidence.get("extractor_version") != EXTRACTOR_VERSION
        or hashlib.sha256(_canonical(body)).hexdigest() != extraction_id
        or not isinstance(evidence["chunks"], list)
    ):
        raise CliError("extract evidence does not match its identifier")
    _manifest(root, manifest_id)
    try:
        chunks = tuple(ExtractedChunk(**item) for item in evidence["chunks"])
        # Owned public index validation checks every chunk provenance/identity;
        # this deliberately does not invoke the extractor.
        with KnowledgeIndex(root / "validation.sqlite3", load_taxonomy(taxonomy_path)) as validator:
            validator.index_chunks(chunks)
    except (TypeError, IndexError, ValueError) as exc:
        raise CliError("extract evidence chunks are invalid") from exc
    return evidence, chunks


def _ingest(args: argparse.Namespace, root: Path) -> dict[str, object]:
    path = SourceStore(root).ingest(args.source, rights=args.rights, data_class=args.data_class)
    manifest, _ = _json(path, "manifest")
    identifier = manifest.get("sha256")
    if not isinstance(identifier, str) or not _HASH.fullmatch(identifier):
        raise CliError("intake did not produce a valid manifest")
    return {
        "duplicate": manifest.get("original_name") != Path(args.source).name,
        "manifest_id": identifier,
        "provider_eligible": manifest["provider_eligible"],
        "sha256": identifier,
        "stage": "ingest",
    }


def _index(args: argparse.Namespace, repo: Path, root: Path) -> dict[str, object]:
    _, chunks = _load_extract(
        root,
        args.manifest,
        args.extraction,
        repo / "knowledge/90-meta/taxonomy.yaml",
    )
    bound = _chunk_dicts(chunks)
    body: dict[str, object] = {
        "chunk_ids": [chunk.chunk_id for chunk in chunks],
        "chunks": bound,
        "extraction_id": args.extraction,
        "inserted": len(chunks),
        "manifest_id": args.manifest,
        "source_sha256": args.manifest,
        "stage": "index",
    }
    index_id = hashlib.sha256(_canonical(body)).hexdigest()
    database = root / "indexes" / index_id / "index.sqlite3"
    taxonomy = load_taxonomy(repo / "knowledge/90-meta/taxonomy.yaml")
    with KnowledgeIndex(database, taxonomy) as index:
        inserted = index.index_chunks(chunks)
        if index.count() != len(chunks):
            raise CliError("index contains rows outside bound extraction evidence")
    if inserted not in {0, len(chunks)}:
        raise CliError("index insertion result is invalid")
    evidence = {"index_id": index_id, **body}
    _publish(root / "results" / "index" / f"{index_id}.json", evidence, "index evidence")
    return evidence

def _load_index(
    root: Path,
    manifest_id: str,
    index_id: str,
    taxonomy_path: Path,
) -> tuple[dict[str, Any], set[str]]:
    if not _HASH.fullmatch(index_id):
        raise CliError("index identifier must be a SHA-256")
    evidence, _ = _json(
        root / "results" / "index" / f"{index_id}.json",
        "index evidence",
    )
    keys = {
        "index_id", "inserted", "chunk_ids", "chunks", "extraction_id",
        "manifest_id", "source_sha256", "stage",
    }
    if set(evidence) != keys:
        raise CliError("index evidence schema is invalid")
    body = {key: evidence[key] for key in keys - {"index_id"}}
    if (
        evidence.get("index_id") != index_id
        or evidence.get("manifest_id") != manifest_id
        or evidence.get("source_sha256") != manifest_id
        or evidence.get("stage") != "index"
        or hashlib.sha256(_canonical(body)).hexdigest() != index_id
    ):
        raise CliError("index evidence does not match its identifier")
    _, chunks = _load_extract(
        root,
        manifest_id,
        evidence["extraction_id"],
        taxonomy_path,
    )
    if (
        evidence["chunk_ids"] != [chunk.chunk_id for chunk in chunks]
        or evidence["chunks"] != _chunk_dicts(chunks)
    ):
        raise CliError("index evidence is not bound to extract evidence")
    return evidence, {chunk.chunk_id for chunk in chunks}


def _propose(args: argparse.Namespace, repo: Path, root: Path) -> dict[str, object]:
    manifest, _ = _manifest(root, args.manifest)
    if manifest["provider_eligible"] is not True:
        raise CliError(
            "source is not provider eligible; rights, class, or sensitive findings block proposal"
        )
    taxonomy_path = repo / "knowledge/90-meta/taxonomy.yaml"
    _, allowed = _load_index(root, args.manifest, args.index, taxonomy_path)
    database = root / "indexes" / args.index / "index.sqlite3"
    with KnowledgeIndex(database, load_taxonomy(taxonomy_path)) as index:
        if index.count() != len(allowed):
            raise CliError("index contains rows outside bound evidence")
        proposal = index.propose(
            args.query,
            args.destination,
            conclusions=args.conclusion,
            limit=args.limit,
        )
    citations = [dict(citation) for citation in proposal.citations]
    if not citations or any(
        citation.get("chunk_id") not in allowed
        or citation.get("source_sha256") != args.manifest
        for citation in citations
    ):
        raise CliError("proposal retrieval returned a citation outside index evidence")
    output: dict[str, object] = {
        "citations": citations,
        "conclusion_citations": [dict(binding) for binding in proposal.conclusion_citations],
        "conclusions": list(proposal.conclusions),
        "destination": proposal.destination,
        "index_id": args.index,
        "manifest_id": args.manifest,
        "query": proposal.query,
        "related_comparisons": [dict(item) for item in proposal.related_comparisons],
        "status": proposal.status,
    }
    output["proposal_id"] = hashlib.sha256(_canonical(output)).hexdigest()
    _publish(
        root / "results" / "proposals" / f"{output['proposal_id']}.json",
        output,
        "proposal evidence",
    )
    return output


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="knowledge")
    parser.add_argument(
        "--state-root",
        help="test-only local state directory contained in this repository",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    ingest = commands.add_parser("ingest")
    ingest.add_argument("source")
    ingest.add_argument(
        "--rights",
        choices=("confirmed", "unconfirmed", "denied"),
        default="unconfirmed",
    )
    ingest.add_argument(
        "--data-class",
        choices=("public", "internal", "confidential", "restricted"),
        default="restricted",
    )

    extract = commands.add_parser("extract")
    extract.add_argument("--manifest", required=True)

    index = commands.add_parser("index")
    index.add_argument("--manifest", required=True)
    index.add_argument("--extraction", required=True)

    propose = commands.add_parser("propose")
    propose.add_argument("--manifest", required=True)
    propose.add_argument("--index", required=True)
    propose.add_argument("--query", required=True)
    propose.add_argument("--destination", required=True)
    propose.add_argument("--conclusion", action="append", required=True)
    propose.add_argument("--limit", type=int, default=20)

    batch = commands.add_parser("batch")
    batch.add_argument("--manifest", required=True)
    batch.add_argument("--input-root", required=True)
    batch.add_argument("--config")
    batch.add_argument("--pdfinfo-executable", required=True)
    batch.add_argument("--pdftotext-executable", required=True)
    batch.add_argument("--pdftoppm-executable", required=True)
    batch.add_argument("--tesseract-executable", required=True)
    batch.add_argument("--poppler-version", required=True)
    batch.add_argument("--tesseract-version", required=True)
    batch.add_argument("--installed-language", action="append", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        args = _parser().parse_args(argv)
        repo, root = _state_root(args.state_root)
        if args.command == "ingest":
            result = _ingest(args, root)
        elif args.command == "extract":
            result = _extract(root, args.manifest)[0]
        elif args.command == "index":
            result = _index(args, repo, root)
        elif args.command == "batch":
            toolchain = ProductionToolchain(
                pdfinfo=args.pdfinfo_executable,
                pdftotext=args.pdftotext_executable,
                pdftoppm=args.pdftoppm_executable,
                tesseract=args.tesseract_executable,
                poppler_version=args.poppler_version,
                tesseract_version=args.tesseract_version,
                languages=tuple(sorted(args.installed_language)),
            )
            result = run_batch(
                args.manifest,
                args.input_root,
                config_path=args.config or (repo / "config/document-ingestion.json"),
                state_root=root,
                toolchain=toolchain,
            )
        else:
            result = _propose(args, repo, root)
        sys.stdout.buffer.write(_canonical(result))
        if args.command == "batch":
            return 0 if result["counts"]["rejected"] == 0 and result["counts"]["failed"] == 0 else 2
        return 0
    except (CliError, IntakeError, ExtractionError, IndexError, OSError, ValueError) as exc:
        print(f"knowledge: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
