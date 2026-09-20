"""Immutable, deterministic cross-note evidence checks (local-only)."""

from __future__ import annotations

from dataclasses import dataclass
import json
import re
from typing import Iterable


class GraphError(ValueError):
    """A malformed, unsafe, or unbounded knowledge graph value."""


_MAX_NOTES = 1000
_MAX_TERMS = 32
_MAX_TEXT = 4096
_MAX_RECORDS = 10_000
_SHA = re.compile(r"^[0-9a-f]{64}$")
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
_SECRET = re.compile(r"(?i)(?:api[_-]?key|token|password|secret)\s*[:=]")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_TAXONOMY = {
    "domains": frozenset(("operations", "software", "systems")),
    "concepts": frozenset(("consistency", "idempotency", "privacy", "provenance")),
    "relations": frozenset(("contrasts_with", "depends_on", "derived_from", "example_of", "implements")),
}


def _text(value: object, label: str, maximum: int = _MAX_TEXT) -> str:
    if (not isinstance(value, str) or not value.strip() or len(value) > maximum
            or _CONTROL.search(value) or _SECRET.search(value)):
        raise GraphError(label)
    return value


def _id(value: object, label: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise GraphError(label)
    return value


def _bounded(value: Iterable[object], maximum: int, label: str) -> tuple[object, ...]:
    if isinstance(value, (str, bytes)):
        raise GraphError(label)
    try:
        it = iter(value)
    except TypeError as exc:
        raise GraphError(label) from exc
    result = []
    for _ in range(maximum + 1):
        try:
            result.append(next(it))
        except StopIteration:
            return tuple(result)
    raise GraphError(label)


def _frozen_tuple(value: object, maximum: int, label: str) -> tuple[object, ...]:
    if type(value) is not tuple:
        raise GraphError(label)
    if len(value) > maximum:
        raise GraphError(label)
    return value


@dataclass(frozen=True, slots=True)
class Citation:
    source_sha256: str
    chunk_id: str

    def __post_init__(self) -> None:
        if not isinstance(self.source_sha256, str) or not _SHA.fullmatch(self.source_sha256):
            raise GraphError("citation source identity is malformed")
        if not isinstance(self.chunk_id, str) or not _SHA.fullmatch(self.chunk_id):
            raise GraphError("citation chunk identity is malformed")


@dataclass(frozen=True, slots=True)
class Conclusion:
    text: str
    status: str
    citation_ids: tuple[str, ...]
    reason: str = ""

    def __post_init__(self) -> None:
        _text(self.text, "conclusion is malformed")
        if not isinstance(self.status, str) or self.status not in {"grounded", "hypothesis"}:
            raise GraphError("unknown conclusion status")
        ids = _frozen_tuple(self.citation_ids, 32, "conclusion citations must be a bounded tuple")
        if any(not isinstance(x, str) or not _SHA.fullmatch(x) for x in ids) or len(set(ids)) != len(ids):
            raise GraphError("conclusion citations are malformed")
        object.__setattr__(self, "citation_ids", tuple(ids))
        if self.status == "grounded" and not self.citation_ids:
            raise GraphError("grounded conclusion requires citations")
        if self.status == "hypothesis":
            _text(self.reason, "hypothesis reason is required", 512)
            if self.citation_ids:
                raise GraphError("hypothesis cannot fabricate citations")
        elif self.reason:
            raise GraphError("grounded conclusion cannot have a hypothesis reason")


@dataclass(frozen=True, slots=True)
class Note:
    note_id: str
    text: str
    domain: str
    concepts: tuple[str, ...]
    relations: tuple[str, ...]
    conclusions: tuple[Conclusion, ...]
    related_note_ids: tuple[str, ...] = ()
    citations: tuple[Citation, ...] = ()

    def __post_init__(self) -> None:
        _id(self.note_id, "note identity is malformed")
        _text(self.text, "note text is malformed")
        if not isinstance(self.domain, str) or self.domain not in _TAXONOMY["domains"]:
            raise GraphError("unknown domain")
        concepts = _frozen_tuple(self.concepts, _MAX_TERMS, "concepts must be a bounded tuple")
        relations = _frozen_tuple(self.relations, _MAX_TERMS, "relations must be a bounded tuple")
        related = _frozen_tuple(self.related_note_ids, _MAX_TERMS, "related notes must be a bounded tuple")
        if (any(not isinstance(x, str) or x not in _TAXONOMY["concepts"] for x in concepts)
                or len(set(concepts)) != len(concepts)):
            raise GraphError("unknown or duplicate concept")
        if (any(not isinstance(x, str) or x not in _TAXONOMY["relations"] for x in relations)
                or len(set(relations)) != len(relations)):
            raise GraphError("unknown or duplicate relation")
        conclusions = _frozen_tuple(self.conclusions, 32, "conclusions must be a bounded tuple")
        citations = _frozen_tuple(self.citations, 64, "citations must be a bounded tuple")
        if any(type(x) is not Conclusion for x in conclusions):
            raise GraphError("conclusions are malformed")
        if (any(type(x) is not Citation for x in citations)
                or len({x.chunk_id for x in citations}) != len(citations)):
            raise GraphError("citations are malformed")
        if any(not isinstance(x, str) or not _ID.fullmatch(x) for x in related) or len(set(related)) != len(related):
            raise GraphError("related note identities are malformed")
        citation_ids = {c.chunk_id for c in citations}
        if any(x.status == "grounded" and any(cid not in citation_ids for cid in x.citation_ids)
               for x in conclusions):
            raise GraphError("citation drift")
        object.__setattr__(self, "concepts", tuple(concepts)); object.__setattr__(self, "relations", tuple(relations)); object.__setattr__(self, "related_note_ids", tuple(related)); object.__setattr__(self, "conclusions", tuple(conclusions)); object.__setattr__(self, "citations", tuple(citations))

    @property
    def terms(self) -> tuple[str, ...]:
        return tuple(sorted(set(re.findall(r"[a-z0-9_]{3,64}", self.text.lower()))))


@dataclass(frozen=True, slots=True)
class Comparison:
    note_ids: tuple[str, str]
    evidence: tuple[str, ...]

    def __post_init__(self) -> None:
        if type(self.note_ids) is not tuple or len(self.note_ids) != 2:
            raise GraphError("comparison note identities are malformed")
        for note_id in self.note_ids:
            _id(note_id, "comparison note identity is malformed")
        evidence = _frozen_tuple(self.evidence, _MAX_TERMS * 4, "comparison evidence must be bounded")
        if any(not isinstance(item, str) for item in evidence) or tuple(sorted(set(evidence))) != evidence:
            raise GraphError("comparison evidence is malformed")


@dataclass(frozen=True, slots=True)
class IntegrityRecord:
    kind: str
    note_ids: tuple[str, ...]
    citation_ids: tuple[str, ...]
    evidence: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.kind not in {"duplicate", "contradiction", "orphan"}:
            raise GraphError("unknown integrity record kind")
        note_ids = _frozen_tuple(self.note_ids, 2, "integrity note identities must be bounded")
        citation_ids = _frozen_tuple(self.citation_ids, 64, "integrity citations must be bounded")
        evidence = _frozen_tuple(self.evidence, 16, "integrity evidence must be bounded")
        if any(not isinstance(item, str) or not _ID.fullmatch(item) for item in note_ids):
            raise GraphError("integrity note identities are malformed")
        if any(not isinstance(item, str) or not _SHA.fullmatch(item) for item in citation_ids):
            raise GraphError("integrity citations are malformed")
        if any(not isinstance(item, str) for item in evidence):
            raise GraphError("integrity evidence is malformed")
        if len(set(note_ids)) != len(note_ids) or tuple(sorted(set(citation_ids))) != citation_ids:
            raise GraphError("integrity record is not canonical")


@dataclass(frozen=True, slots=True)
class IntegrityReport:
    records: tuple[IntegrityRecord, ...]

    def __post_init__(self) -> None:
        records = _frozen_tuple(self.records, _MAX_RECORDS, "integrity records must be bounded")
        if any(type(record) is not IntegrityRecord for record in records):
            raise GraphError("integrity records are malformed")
        object.__setattr__(self, "records", records)

    def as_dict(self) -> dict[str, object]:
        return {"records": [{"kind": r.kind, "note_ids": list(r.note_ids), "citation_ids": list(r.citation_ids), "evidence": list(r.evidence)} for r in self.records]}

    def canonical_json(self) -> str:
        return json.dumps(self.as_dict(), sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def retrieve_notes(notes: Iterable[Note], query: str, *, limit: int = 20) -> tuple[Note, ...]:
    items = _bounded(notes, _MAX_NOTES, "notes must be bounded")
    if any(not isinstance(n, Note) for n in items) or len({n.note_id for n in items}) != len(items) or not isinstance(limit, int) or not 1 <= limit <= _MAX_NOTES:
        raise GraphError("malformed retrieval input")
    terms = set(re.findall(r"[a-z0-9_]{3,64}", _text(query, "query is malformed", 512).lower()))
    scored = sorted(((len(terms & set(n.terms)), n.note_id, n) for n in items), key=lambda x: (-x[0], x[1]))
    return tuple(n for score, _, n in scored if score > 0)[:limit]


def compare_notes(left: Note, right: Note) -> Comparison:
    if not isinstance(left, Note) or not isinstance(right, Note) or left.note_id == right.note_id:
        raise GraphError("comparison requires two distinct notes")
    evidence = {f"term:{x}" for x in set(left.terms) & set(right.terms)}
    if left.domain == right.domain: evidence.add(f"domain:{left.domain}")
    evidence.update(f"concept:{x}" for x in set(left.concepts) & set(right.concepts))
    evidence.update(f"relation:{x}" for x in set(left.relations) & set(right.relations))
    evidence.update(f"citation:{x.source_sha256}:{x.chunk_id}" for x in left.citations + right.citations)
    return Comparison(tuple(sorted((left.note_id, right.note_id))), tuple(sorted(evidence)))


def _normalized_claim(text: str) -> tuple[str, bool]:
    normalized = " ".join(text.casefold().split())
    if normalized.startswith("not "):
        return normalized[4:], True
    return normalized, False


def integrity_report(notes: Iterable[Note]) -> IntegrityReport:
    items = _bounded(notes, _MAX_NOTES, "notes must be bounded")
    if any(not isinstance(n, Note) for n in items) or len({n.note_id for n in items}) != len(items):
        raise GraphError("duplicate note identity or malformed note")
    ordered = tuple(sorted(items, key=lambda n: n.note_id))
    records: list[IntegrityRecord] = []

    def add(record: IntegrityRecord) -> None:
        if len(records) >= _MAX_RECORDS:
            raise GraphError("integrity report is too large")
        records.append(record)

    for i, a in enumerate(ordered):
        for b in ordered[i + 1:]:
            same_text = a.text.casefold().strip() == b.text.casefold().strip()
            same_conclusion = (
                a.conclusions and b.conclusions
                and a.conclusions[0].status == b.conclusions[0].status == "grounded"
                and _normalized_claim(a.conclusions[0].text)
                == _normalized_claim(b.conclusions[0].text)
            )
            if same_text or same_conclusion:
                citations = tuple(sorted({cid for n in (a, b) for x in n.conclusions for cid in x.citation_ids}))
                reason = "normalized-text" if same_text else "same-grounded-conclusion"
                add(IntegrityRecord("duplicate", (a.note_id, b.note_id), citations, (reason,)))
            if a.conclusions and b.conclusions and a.conclusions[0].status == b.conclusions[0].status == "grounded":
                left_claim, left_not = _normalized_claim(a.conclusions[0].text)
                right_claim, right_not = _normalized_claim(b.conclusions[0].text)
                opposed = left_claim == right_claim and left_not != right_not
                opposed = opposed or {left_claim, right_claim} in ({"safe", "unsafe"}, {"true", "false"})
            else:
                opposed = False
            if opposed:
                citations = tuple(sorted(set(a.conclusions[0].citation_ids + b.conclusions[0].citation_ids)))
                add(IntegrityRecord("contradiction", (a.note_id, b.note_id), citations, ("opposed-grounded-conclusions",)))
    known = {n.note_id for n in ordered}
    for n in ordered:
        for target in sorted(set(n.related_note_ids) - known):
            add(IntegrityRecord("orphan", (n.note_id, target), tuple(sorted(c.chunk_id for c in n.citations)), ("dangling-related-note",)))
    order = {"duplicate": 0, "contradiction": 1, "orphan": 2}
    records.sort(key=lambda r: (order[r.kind], r.note_ids, r.citation_ids, r.evidence))
    return IntegrityReport(tuple(records))


scan_integrity = integrity_report

# Friendly names for callers that treat the report as a value object.
canonical_json = IntegrityReport.canonical_json
