# PP1c D01–D03 proposal evidence — T-0351

Scope: complete a reviewable documentation proposal for PR333. No PP1c product implementation, backup/restore execution, release, deployment, offsite claim, existing runtime/volume cleanup, dependency or permission expansion. PP1b source merged by PR334 is the prerequisite, not new PP1c evidence. Original PARTIAL reviews stay historical.

## Required checks

| Requirement | Exact command / evidence | Observed result |
| --- | --- | --- |
| Repository success contract | `python3 scripts/check_project_success.py` | PASS:52 contracts/navigation/index |
| Candidate card structure, relative links/anchors, phase alignment, existing parent bytes, product scope | `python3 apps/cms-scaffold/.team/pp1c-seal-20261101/check_docs.py` | PASS:378 assertions;44 unique cards,23C/5L/5H/6T/4R/1E,subwaves9/12/9/14 |
| Task contract | `python3 /home/ckc/test/codex/agents/codex-team-superpowers/scripts/teamctl.py validate-task apps/cms-scaffold/.team/tasks/T-114.md` | PASS |
| Whitespace | `git diff --check MERGE_HEAD -- apps/cms-scaffold` | PASS |
| Referenced source provenance | [SOURCE-HASHES.json](SOURCE-HASHES.json); each of10 files compared byte-for-byte with MERGE_HEAD before digest | PASS, main cb6771c7017e2477460f74e0259a659bd97df940 |
| Physical prerequisites | [TOOL-PROBES.json](TOOL-PROBES.json), five independently created synthetic no-network helper containers, all exit0 and removed by exact fullID | PASS for the observed capabilities only |
| Secret boundary | manual review plus common credential-pattern scan over new docs/evidence | PASS: no real passwords/cookies/keys, no runtime secret directories accessed; scan is not a general proof of absence |
| Independent five-card review | [T114 report](../reports/T-114.md) | PASS for final scoped implementability; exact reviewed doc hashes inT114, initial PARTIAL/skipped history retained |
| Final exact-head CMS / project-success CI | PR333 head after publication | PENDING |
| Review report contract | `python3 /home/ckc/test/codex/agents/codex-team-superpowers/scripts/teamctl.py validate-report apps/cms-scaffold/.team/reports/T-114.md` | PASS; not a product completion report |
| Owner new protocol / four-subwave decision | [decision section](../../docs/v2/contracts/PP1c-local-adapters.md#6-封板決策單一提案) | PENDING; DRAFT retained |

No product tests or real backup/restore drill were run locally in this docs-only scope. Required existing product CI will run unchanged on the PR head. Neither a probe nor CI on unchanged product code proves future PP1c offline commands exist. Required implementation/real-PG/full-restore/browser evidence remains future work.

## Probe method and limits

All `docker` invocations used explicit `--host unix:///var/run/docker.sock`, `create --pull=never`, unique new probe name, `--network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges`, tmpfs `/tmp`, and exact immutable image ID. The root checked fullID/image before start and stopped state after exit, then removed only that exact probe ID. First three probes used the default logger with synthetic nonsecret output only; later two explicitly used `--log-driver=none`. Future raw dump/media helpers require none in the proposed contract.

- Java25 image: compiled synthetic ToolProbe loads the jar's PostgreSQL JDBC driver, encodes/decodes a2×1 PNG, reads owner0600 synthetic input and writes owner0700 output as1000:1000. It does not connect to any DB, inspect real credentials or execute the future ops entrypoints.
- Node/browser image plus the already-approved readonly host Node binary: `/opt/pp1-node` synthetic fs read/write/stat/file+directory fsync as1000:1000; observed Node24.18.0.
- PG16 image: absolute `/usr/local/bin/pg_dump --version` and `/usr/local/bin/pg_restore --version`, observed16.15 as1000:1000. No dump/restore occurred.
- Same API image with inherited user: `/usr/bin/id` returned uid0/gid0. This is an actual observation, not an inference from empty Config.User; every future matched build/profile still needs the preflight.
- Same browser image as1000:1000: `/chromium/chrome --version` returned153.0.8010.12 and `/nss-tools/certutil -N --empty-password -d sql:/tmp/profile/.pki/nssdb` exited0 withcert9.db present. No network/browser journey or host trust modification occurred.

The source/model review established separate login/session-touch writes, independent audit time, bytea cookiehash decoding, PostgreSQL microsecond handling, quiescent inventory checkpoints, and raw-before-revoke ordering. Pure syntactic checks do not independently prove those source semantics; T114 reviews them.

## Delivery and accounting

Current milestone stays DRAFT until the concrete new protocol is approved. Same source registry/v1 bytes/Java Operation/six-field Result and parent media/session/RTO policy are preserved. PR updates use normal merge history, never force push. One add/add historical PLAN conflict retained both records. Other main changes are merge ancestry, not authored PP1c scope.

One new bounded native reviewer was launched for this docs turn; no recursive delegation. Complete outer/nested/provider request/token/retry/cost and active/wait totals are unknown/null because no full mechanical session export is available; estimates and worker budgets are not measured provider counts. No hard tool-call cap. Estimated60–100active minutes,20minute checkpoints; per-probe30s and CI15min per observation round. Initial failure plus at most2reasoned corrections for the same review finding.

Root evidence-gate decision: accept the final bounded design review for a concrete owner decision. Do not accept a whole-milestone DONE claim: protocol approval, exact-head CI/readback and implementation remain separate. The two review corrections (complete browser vector and reconstructible auth proof) were independently reread; no unresolved scoped material finding remains. Reviewed annex c3b700ae40dca760995d4c63589df7bb8eed72820cc294465a3ce0ed991cb0de and wave50ba18e39727407e4a03797e6fc677306df9cbe1c190a5ca2b39c91ba406a512 match actual bytes.
