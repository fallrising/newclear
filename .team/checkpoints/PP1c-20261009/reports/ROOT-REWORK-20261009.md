# Root independent PP1c review — 2026-10-09
Status: REWORK. DRAFT only; no DOC_READY / product authorization.
Frozen inputs: PP1c.md a215a8382e7e72f3cbfb4fdc258629a5d24de001a1af79131fe20f9588a258bc; PP1-recovery.md 1ec69daefc753f0d514f8b0783f5466e60e98b91098ba84fc3808f9bbd644170. Root read all child sections and parent changed contract; T-004 independent reviewer is completing corroboration.

Required corrections before document publication:
1. Restore parent original precise media algorithm and session revoke SQL/AUTH/atomic receipt invariants. Do not weaken them by replacing with vague cross-references. Original approved baseline is git HEAD parent document.
2. Parent/child error mapping differs (media/restore/adapter); nominate single local authority, leave PP1d future-only codes separate.
3. Seal request/ready/permit/result schemas, paths, framing and revoke readOnly-to-write lifecycle. Current prose says fixed but does not define them.
4. Complete typed LeaseV2 nested schemas, enums/null/phase rules, journal BEGIN/END records, hash preimages. UUID blanket rule is invalid for runId/containerID/backupID. Avoid self-hash/circular proof.
5. Define exact executable Node CLI verbs/flags/completion policy/incidentStartedAt. Internal exports alone are not a command contract.
6. Align Java records and canonical inventory schema: assets/variants, constraints/index metadata, schema/rows hashes are missing from current record types despite manifest expectations.
7. R04 test file incorrectly under src/main; fix exact test path. Replace shorthand paths with explicit closed whitelist references.
8. C17 called evidence-only but owns unimplemented recovery.spec.ts elsewhere. Assign actual browser fixture/config suite changes to bounded cards, exact secret transport and deltas.
9. Fix subwave dependencies/counts: H03 once in B before C08, A7/B8/C8/D10 before any new splits. T03 defines receipt verification, C16 executes actual health before invoking it; avoid dependency cycle.
10. Assign maintenance-guard.mjs/.test.mjs v2 CLI/version dispatch and previous-v2 terminal loading. Current old loader only supports v1; Java still points at it. Freeze exact helper verbs/projection/arguments.
11. Canonical byte requirement only for NEW v2/bundle/offline documents; preserve v1 JSON.stringify LF insertion-order bytes and six-field result.
12. Explicit approved G06 one-shot Java child SPRING_DATASOURCE_PASSWORD env exception (parent clears immediately); offline helpers prohibit secret-value env. Do not silently change accepted account transport.
13. Parent instanceId mapping must match deterministic formatting of local 32hex runId. Parent old R04/R05/R06 selection references must map PP1d future only.
14. Reassess <=400 handwritten lines including security tests; split broad L02/H02/inventory cards rather than remove assertions. All cards exact scope/inputs/native checks/observable acceptance; remove generic Red failure note from Green cards.

Root adopted architecture remains one registry/versioned lease, source+one subordinate RESTORE-only target, no adopted old volume, exact full-ID helper identity, pinned JDBC readiness+permit versus bounded PG tool observation, KEEP_STOPPED restore proof, new consuming recovery lease full bytes and full raw source recheck including sessions/audit, no startup-writer exceptions, no child host ports/forwarder, local proof never offsite.
Capacity hold: ~224MiB filesystem available at15:08UTC. Both PP1b owned test runs stopped, volumes retained; new runs/builds blocked until >=5GiB free. This does not block bounded document review/correction. Required checks not replaced with mocks.
