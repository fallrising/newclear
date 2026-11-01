# P1f local durable bootstrap intent contract

Root-frozen revision p1f-v1.1, 2026-10-17. D1–D7 of [independent design T-017](../.team/reports/T-017.md) are normative for the exact API, schemas, persistence protocol, CLI and adversarial acceptance matrix. Root accepts those design sections with the explicit lock durability clarification below. Python 3.11 standard library only.

## Bounded behavior

Add only scripts/bootstrap_journal.py and tests/test_bootstrap_journal.py. Every existing implementation, test, P1 contract and both locks remain byte-identical. Three APIs initialize_journal, journal_status and record_intent consume the original independently digested pristine bootstrap plan. Any one original phase/action may be reserved; this asserts neither phase order nor admission. Already-converged zero-action proposals refuse.

The only transition is no-intent to one permanently uncertain exact action. No dispatcher, collector, callback, approval, clock, resolution, complete, abandon, reset, adopt, retry or phase advance interface exists. Every subsequent record request refuses, including an identical action. No-intent describes only this validated local journal, never remote absence or safe retry. Timeout, lost reply, restart and late effects do not clear uncertainty.

## Persistence and identity

D3 defines exact immutable metadata, intent and detached result schemas. Metadata binds the complete validated ownership and independently retained six-node map, original bootstrap digest/origin and actual root/lock device+inode. Intent binds that journal and one exact plan-derived action. Flags always deny execution, live readiness, dispatch and resolution.

D4 requires private canonical string paths outside source and without either ancestry overlap with host data roots; no-follow traversal, owned0700 root/parent and owned0600 single-link regular files. Metadata/intent cap65536 bytes including canonical JSON terminal LF; CLI plan cap1MiB. Raw lexical aliases are rejected before normalization. Unknown, partial, malformed, noncanonical or unsupported state never becomes absent.

D5 defines exclusive nonexistent-root initialization and permanent zero-length lock. Root R1, independently agreed by Astra, additionally requires fsync of the newly created lock descriptor after validation/acquisition and before metadata staging. Its failure retains the partial root and lock, with no metadata/adoption/effect. Existing status/record lock acquisition does not add an fsync. Every operation uses nonblocking exclusive flock and repeated root/lock/file/namespace identity checks. Only .lock+journal.json, optionally plus intent.json, form valid state. Fixed .initialize.pending or .intent.pending files always refuse later access. Creation uses exclusive pending write, file fsync, staging-directory fsync, identity checks, atomic rename, final-directory fsync and validated reread; initialization also fsyncs parent. Nothing cleans up pending/final/root/lock on error. Failed return may already have committed an uncertain intent.

## Private CLI and evidence

D4 specifies only init/status/record-intent, private plan/independent digest/state-root arguments and phase-id/action-index selection. Summary output contains no IDs, digests, targets or paths; errors and help are fixed sanitized JSON. No credential or execute option exists. D6 requires actual Red–Green, local process/race/crash/failure-window and late-effect tests, independent probes, unchanged regression suite, Python3.11/3.13 and existing synthetic demo. Test effects live outside production APIs and only follow successful durable record return.

## Limits and future requirements

Root replacement or rename during an operation is checked against held descriptors. A historically moved original directory reopened at its new canonical path retains the same inode binding and uncertainty; no persisted pathname or global registry is claimed.

This is same-retained-root cooperative fencing. Another root, same-UID rollback/removal, external actors and physical power-loss durability are outside its guarantees. Fsync/rename/flock support is a prerequisite; process tests are not power-cut evidence. No automatic repair/recovery is implemented. A new root grants no replay authority.

Authenticated fresh pre/post collection and per-effect identity checks, separately approved exact effects, complete startup/phase-aware executor and authenticated uncertainty resolution, runtime/image/config/storage/network/ACL provenance, replication health/lag, persistence and proxy smoke remain unmet. Down retains data; purge requires separate exact conditions and approval. No live SSH/runtime/network effect is authorized here. Full P1 incomplete, MR-004 BLOCKED_ENV, formal counts4 DONE/1 BLOCKED_ENV/4 TODO.
