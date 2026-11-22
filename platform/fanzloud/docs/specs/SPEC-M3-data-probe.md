---
id: SPEC-M3-DATA-PROBE
status: verified
contract_units: [CU-M3-U01, CU-M3-U02, CU-M3-U04]
---

# Offline original-data candidate verifier

Supports existing FN04/FN07 recovery investigation; it does not implement or change
AP reconciliation, restore, run admission or owner acceptance. Scope, exact byte/file
limits and test skeletons are in the normative
[DATA02 offline snapshot contract](../acceptance/M3-owner-data-recovery.md#offline-snapshot-verifier-contract-before-code).

Interface: `python3 acceptance/owner-data-recovery/verify_snapshot.py ARCHIVE --sha256 DIGEST`.
Uncompressed regular-file tar only. Open with O_NOFOLLOW; require the explicit lowercase
64-character SHA256 before parsing. No extraction, subprocess, network or writes.
Check the same input descriptor size/mtime/ctime before/after parsing; report input_changed
on an observed change. This is not protection against a malicious writer able to change
and restore bytes during a read; use a protected, quiescent operator-owned snapshot.
Return exit0 plus bounded candidate_only/no_matching_identity summary, or exit2 plus
fixed rejected/reason JSON. Exit0 never means database recovered, safe to start or ready.
No input path, raw member content, provider/account details or exception text in output.

Security: reject path/link/special/duplicate/size/count violations; validate every member,
even when it is not a relation. Candidate markers are the two already published U07 run
UUID texts, scanned only in numeric base relation files, with chunk overlap. Atomicity:
read-only observation, no store or external side effect. Retry: no automatic retries.
Recovery: retain original snapshots; a missing marker is inconclusive (TOAST/compression,
binary UUID/dead tuple/physical layout); a positive is also only a candidate. Compatibility:
Python standard library, no product dependency/API/schema change. Error strings are fixed
and do not expose filesystem or tar exceptions. Resource limits are stated in DATA02.

Extended PAX/GNU-name/sparse headers are unsupported and must be rejected before
stdlib metadata/payload processing; they cannot bypass member count/size bounds.
The accepted private BusyBox snapshot needs none of these extensions.

Tar iteration stops at the first zero header. Require at least1024 bytes after the last
validated member's padded end and verify every remaining byte is zero; reject hidden
appended members/nonzero junk or a single zero block followed by content.
