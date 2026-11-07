# Reviewed owner readback launcher source snapshot

T-0442 / existing M3-U / FN07 preparation. Owner requested saving code and progress
before restarting their computer. This directory preserves the already reviewed
private launcher, proxy, allowlist and their regression tests. It adds no production
API, dependency, scheduler, VM manager, deployment or acceptance condition.

These are **source-only `.in` templates**. They are not an installed launcher.
The original executable copies and private configuration remain in the protected
operator workspace and selected backup. The only changes from those copies are
three literal path substitutions, recorded in `manifest.json`:

- `@PRIVATE_WORKSPACE@`: the trusted operator workspace root.
- `@RECONCILE_BACKUP@`: the retained original binary/AP-runtime evidence directory.
- `@NODE_EXECUTABLE@`: the existing pinned Node executable.

No private binding values, login, TLS key, database credentials, raw logs or state
are included. Restoring the exact three bindings and removing the `.in` suffix
recovers the original bytes; compare against each `original_sha256` before use.
Do not substitute a new store, change source pins, reset an intent, or execute
an old harness to test whether it works. This snapshot grants no live window.

Original scope: one read-only 600-second owner window, ingress closes at480s,
last120s cleanup. Only exact session login/logout and allowlisted existing-result
GETs pass. No task/review/rework/cancel/reconcile admission or worker/CLI/VM start.
Independent guardian owns bounded shutdown; original SQLite/AP execution records
are compared, while auth sessions and observed history may change.

The recorded pre-live acceptance is `ACCEPT_READONLY_GATE_PRELIVE`: nine supervisor
regressions, two policy cases and trusted-TLS fake-upstream denial/cutoff fixture
passed after three initial lifecycle findings were corrected. The same source
hashes remain in the protected review/backup; this archival change has not rerun
those fixtures and does not create new runtime or owner-operation evidence.

Archival verification checks all six reviewed source hashes, byte-for-byte inverse
substitution, Python AST/JavaScript syntax and every template digest. Existing
[owner acceptance and limits](../../docs/acceptance/M3-owner-operation.md) remain
authoritative. Owner login/readback and full FN07 submit/progress/handoff are pending.

At the2026-11-06 save checkpoint the original certificate expired on2026-11-02.
After reboot, reconcile current sources, exact original state, owner readiness and
TLS validity before arranging any new bounded window. Do not renew credentials
or start services as part of restoring this snapshot.
