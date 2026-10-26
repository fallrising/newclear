# Download expiry availability

Issue379 bounded correction after PR658, baseline d81a7d91415d4e4733a58c61fa9b72f32412b1e0.
Source ResultArchive download still only refetches after410, unlike export expiry.
Failed refresh hides cached identity; stale available data leaves invalid controls.

## DUX-01

Exact download HTTP410 with JSON error artifact_expired marks only the originating
immutable run/artifact/hash unavailable immediately through the existing expiry path.
Retain result/diff/hash/size and hide download/new-export controls while metadata is
pending, failed or stale. Prefix invalidation stays scoped to the source run, including
state-version variants; late A responses must not expire selected B. Do not fabricate
server pruned_at or persist a new authority/tombstone. Explicit metadata retry remains.

## DUX-02

Other410 codes, malformed/non-object error bodies,409,5xx and network errors do not
imply expiry. Download401 refreshes session consistently; no fake expiry. Successful
200 downloads preserve bytes, fixed filename, object URL cleanup and selected source
path. No automatic download/export retry or POST, no backend/API/export transport change.
Existing download mock410 must reflect actual backend artifact_expired, preserving
its assertions and prior failing evidence.

## Verification

Root obtains actual rendered-App RED on unchanged product before PhaseB. New focused
tests cover pending/failed/stale refresh, late source-run response and error boundaries.
Existing affected archive and PR658 expiry regressions only; strictTS/scopedformat.
Rebuild changed frontend assets; update one existing archive-retention Chromium test
using a guard-safe synthetic historical first-INSERT fixture (no immutable-trigger
bypass or timestamp rewrite), to inject metadata-network failure after actual SQL
GC/download410, then explicit retry
against real API. Clearly label browser network fault as injected. No duplicate BGC,
old Python/native/OC/longsuite replay. Independent review, source/protection gate,
43 project contracts/6indexes, required CI and normal merge.
Fullsameversionfake/liveAT09/12/13/VMrecovery/deployment/M4 remain open.

Prereview T109 found legacy archive-prune disables the immutable trigger. This slice
replaces only this browser scenario entry with a new owned test helper that reuses
existing historical seed and verifies exact preview/apply IDs plus unchanged
run/event/authority facts. Original legacy helper and its evidence remain unchanged.
