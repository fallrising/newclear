---
id: ADR-0006
title: Preserve canonical extended-year UTC event timestamps
authority: compatibility repair for accepted T020 and ADR-0005 timestamp range
status: accepted
date: 2026-10-04
---

# Context

The T030C public projection-extrema oracle exposed an existing event-codec roundtrip defect.
T030A writes `DateTime<Utc>` with Chrono `to_rfc3339_opts(SecondsFormat::Nanos, true)`.
For years outside 0000..9999 that encoder emits signed extended years. The existing decoder
uses only `DateTime::parse_from_rfc3339`, which rejects those values. The append transaction reads inserted rows through that decoder before committing, so a legal
extended-year input fails readback with `CorruptStore(Timestamp)` and rolls back. Canonical
extended text supplied in a fixture is likewise unreadable through replay/snapshot provenance;
this is not evidence that normal append committed corrupt history.

T020 admits the full Chrono UTC range. ADR-0005 and SPEC-T030D S02 explicitly preserve that
range, including valid leap seconds. SPEC-T030B's phrase "valid RFC3339" is too narrow for the
accepted writer's own output; accepting only four-digit years would silently narrow accepted
input and keep the reader inconsistent with the writer format. Historical A/B/D acceptance did
not include this complete extrema append/replay/save/load roundtrip. Those reports stay unchanged.

# Decision

Repair event decoding without changing stored representation, SQLite schema, event/cache versions,
public signatures, dependencies, timestamp input types or resource limits:

1. Keep the existing strict RFC3339 parser first. Every previously accepted RFC3339 value remains
   accepted with the same UTC conversion, including valid offsets and fractional precision.
2. Only if that parser rejects, allow a fallback parser capable of Chrono's signed extended-year
   UTC representation. Accept its result **only when re-encoding with the existing writer's exact
   `to_rfc3339_opts(SecondsFormat::Nanos, true)` equals the original stored text byte for byte**.
   A permissive parser alone is never the acceptance predicate.
3. Preserve exact seconds/nanoseconds, including leap-second representations and MIN_UTC/MAX_UTC.
   Whitespace, alternate separators, noncanonical precision, offsets, extra signs/zeroes, invalid
   dates, overrange values and trailing material rejected by the first parser must also be
   rejected unless they are exactly the existing canonical encoder output.
4. Preserve the SQL type/UTF-8/1..=64-byte gates before copying/parsing replayed timestamps.
   Failure remains the existing bounded `CorruptStore { stage: Timestamp }`; no raw data or new
   error variant, repair write, history rewrite or automatic cache cleanup is introduced.

The accepted writer already defines these canonical values. This is a compatible reader repair,
not a general relaxed timestamp-input API or a schema migration. Noncanonical extended text that
was never valid writer output remains corrupt. Ordinary valid RFC3339 forms continue on branch1.

# Required Evidence and Review Gate

Before the codec edit, independently review this decision and specification projection, then
run a compiling failing regression `canonical_extended_timestamp_roundtrip_preserves_legacy_rfc3339`.
The existing failing C extrema test remains part of RED evidence and must pass without weakening.
The focused regression must cover:

- MIN_UTC/MAX_UTC, signed negative and positive extended years, year-boundary values and valid
  leap-second nanos through public append, load_after, snapshot save and snapshot load; reopen
  and compare exact timestamp fields with input.
- Previously accepted RFC3339 offset/fractional forms, preserving conversion semantics.
- Extended-year whitespace/separator/precision/offset/extra-material and invalid-date/range forms
  rejected with Timestamp, plus retained oversize/type/UTF-8 gates and no mutation on failure.
- Existing A/B/D/C and parent suites, workspace gates, and independent runtime review.

Implementation may use the already pinned Chrono parser; no dependency change is needed.
The new regression must first fail specifically on the canonical extended-year roundtrip rather
than on a build/setup error. Source and report must describe synthetic faults versus actual I/O
separately and preserve earlier failures as repaired evidence.

# Consequences

Valid extended-year inputs can complete append readback and commit; canonical writer-format
extended timestamps can roundtrip through replay and snapshot provenance.
Existing valid RFC3339 compatibility remains; newly tolerated text is limited by exact encoder
equality. This does not optimize snapshot replay or change any event sequence/projection trust
boundary. The fallback runs only after an existing bounded timestamp parse failure.

# Acceptance

Accepted for design by a fresh independent GPT-6 Astra review of the decision, B/C projections,
failure evidence and pinned Chrono 0.4.45 parser/encoder source. The strict-first branch and exact
canonical fallback preserve prior compatibility without admitting generic relaxed input.
Implementation requires the named compiling RED regression before codec changes. Runtime
acceptance remains T030C and T030 composition after complete gates.

## Subsequent Runtime Evidence

The named regression compiled and failed at canonical MIN_UTC append readback before the codec
repair, asserting rollback, then passed the full roundtrip and rejection matrix. Independent
GPT-6 Sol runtime review accepted the strict-first/exact-canonical implementation, the 99-test
store suite, 295-test workspace and complete regression gates in
[T030C acceptance](../acceptance/T030C.acceptance.md) and
[T030 composition](../acceptance/T030.acceptance.md). Historical acceptance is preserved.
