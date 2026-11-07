# PP1c owner checkpoint — 2026-10-09

**DRAFT / REWORK. No DOC_READY; no PP1c implementation.** Owner requested a stopping point before VPS maintenance. Preserve this draft branch separately from the PP1b implementation branch; both start at e3d0c3fbea02fa47cdd99a6b43914c1a8ad4fd1c.

Read reports/ROOT-REWORK-20261009.md and reports/T-004.md before resuming. T004 review stopped at owner request; unfinished weak-implementer walks are visible, not accepted. Parent recovery contract and child PP1c draft have unresolved media/session-revoke policy loss, schema/CLI/hash/lease compatibility gaps, and task ownership/dependency errors. Do not merge these specification changes or implement PP1c until corrected, independently reviewed, required CI passed and docs normally merged. Existing parent policy at base commit must be preserved in correction.

No product changes were made in this branch. Root-approved architecture direction is a single maintenance registry, strict v1/v2 compatibility, one subordinate RESTORE-only target, full source/DB/media comparison, restore-session revocation transaction, and protected local proof; local evidence never proves offsite or formal readiness. The exact executable interfaces remain incomplete.

The required later work remains DB+media consistent backup/actual isolated restore, recovery-admin integration, upgrade/failure matching recovery, schedules/protected offsite copy/notifications/rotation, and final local/formal-environment acceptance. Do not expand this into all v2 feature cards.

The separate PP1b checkpoint carries code and remaining account runtime/browser checks. Preserve all local coordination/evidence/private runtime roots and Docker volumes in a protected off-VPS snapshot before deleting the VPS. No verified off-VPS snapshot was produced by this task. Existing W5/BW6/BW1a histories remain untouched. Provider/tool counts unknown/null.
