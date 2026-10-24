# ClarkQ original R2 M1–M3 report

Candidate implementation and scoped verification passed. Independent review, required current CI and publication remain parent-owned gates. This is not full R3, a new usable qualification or owner acceptance of broader production/cluster behavior. [Machine-readable index](result.json), [approved design](../../DESIGN.md), [runner](../../RUNNER.md).

## Changes and evidence

| AC | Actual evidence | Result |
| --- | --- | --- |
| M1 isolated fixture | New random key; empty owned state; clean five-variable child environment; only127.0.0.1:8080/RF1; publicUI200 separate from missing/wrong API401; authenticated seed/readback14queues | passed |
| M2 baseline and correction | baseline-001 mobile643px vs390; all3 refresh focus lost; serious contrast2 + scrollable-region2 each. Actual inline-script/contrast/region test1PASS3FAIL→4PASS. HTML-only wrapping, named scroll regions, button contrast/outline, Actions header and guarded focus restoration | passed |
| M2 shared capture | Unchanged tool dry-run and actual final-001 three unique dark keys; allHTTP200/nooverflow. Immutable manifest/PNG/UI/binary/seed/tool hashes checked before reuse | geometry passed; original desktop health FAIL retained |
| M2 final long data | final-002 desktop1440/tablet834/mobile390 exactpagewidth; table mobile316px; all3 focus preserved; all3 axe violations0/incomplete0 | passed |
| M3 real operations |14 screenshot-backed Tab/visible-focus/Enter steps: missing/wrong key; Save/Refresh; enqueue depth1; Use; Peek same depth; Consume same message→0; empty204; Clear cancel2/confirm0; invalidname400; controllednetworkfailure/recovery; actual5s table replacement/focus/depth | passed |
| Cleanup | All baseline5/final6 stages passed; Go exit0/no forcedkill/processgroup absent/listener absent; each root outer container removed | passed |

Final runtime uses Chromium153.0.8010.12, canonical dark1440×900/834×1112/390×844, external Playwright1.63/axe4.13 tooling. No dependency, backend/auth/API/queue/config/CI/sharedcapture change. Production change is only `internal/ui/index.html`. Existing single-node usable status and dormant scope are retained.

## Attempts and failures

- [baseline-001](evidence/runtime-baseline-001.json), [outer](evidence/outer-baseline-001.json): exit0/22.463s measures defects; it did not pass layout/focus/axe acceptance.
- [final-001](evidence/runtime-final-001.json), [shared manifest](evidence/shared-final-001.json), [outer](evidence/outer-final-001.json): exit1/4.363s REVIEW_SHARED_HEALTH. Three valid geometry PNGs; desktop anonymousconsole404, tablet/mobilehealth0. Original failure unchanged.
- [final-002](evidence/runtime-final-002.json), [outer](evidence/outer-final-002.json): exit0/36.669s. Reuses only prior3geometry keys with exact source/binary/fixture/hash equality; one fresh desktophealth probe,3strict longdata views and14journeys. No full sharedmatrix rerun claimed.

The fresh no-interception desktop probe observes `/favicon.ico` GET404 with actual `other` initiator, same CDP request/response, both normal and ExtraInfo headers without key/cookie/authorization, one matching console error and linked CDP network log. Source has no favicon route/declaration. This is an existing presentation finding, not fixed and not zerohealth. The old anonymous404 is retained; new evidence supports the specific classification. Baseline interception versus shared no-interception is a possible explanation for differing observations, not proven causal attribution. Unknown routes/status/errors remain failing.

Journey health separately retains6×401,1×400,1 controlledGET metrics ERR_FAILED and8correlatedconsole errors; exact source/status/phase/request identity checked. No pageerrors or external requests observed. No key/header/body/DOM dump published.

## Native and focused checks

- [Native baseline](evidence/native-baseline.json), [actual test log](evidence/native-test.log): `go test ./...` exit0/18.254s, **8 tested packages and6 packages without tests**; original build0.769s. Earlier informal nine-package summary was incorrect. Backend source unchanged; these are parent-run checks, not a repeated worker run.
- [Final embedded build](evidence/native-final-build.json): `CGO_ENABLED=0 go build -o <build>/clarkq ./cmd/clarkq` exit0/0.869s, UIc99ad491… and binary7a4c942d… match final runtime. Full current CI pending.
- [Initial guards](evidence/guards-initial.log):4PASS; [lifecycle](evidence/lifecycle-green.log):7PASS/86.057865ms including SIGTERM/SIGINT, late-acquire ownership and independently bounded failed/stalled close. [Earlier lifecycle RED](evidence/lifecycle-red.log) was missing helper exports before implementation, not a product behavioral failure.
- [UI RED](evidence/ui-red.log)1PASS3FAIL → [UI GREEN](evidence/ui-green.log)4PASS/61.995591ms. No-focus-stealing negative case retained.
- [Journey classification](evidence/journey-health-green.log)4PASS/74.258333ms; [desktop proof/privacy](evidence/desktop-health-green.log)3PASS/130.203916ms; [immutable reuse](evidence/reuse-check.log)positive3keys + changedbinary rejection passed. These separate commands are not claimed as one aggregated test run.
- Changed MJS syntax checks passed. No new framework/install/native/browser launch by worker.

## Artifact and publication boundaries

[Result index](result.json) pins13runtime source hashes and23ignored PNGs:3originalbaseline +3shared +3final longdata +14journey. Current source hashes match final002. PNGs/rawstate/storage/key/service logs stay private; public safe receipts/logs only. [Publication provenance](evidence/publication-provenance.json) records original/published SHA256 and exact private worktree/build path substitution where needed; original bytes remain local. No original runtime failure rewritten. Metadata verification changed only after runtime.

Final mobile PNG was visually inspected: long name wraps inside queue panel, buttons remain present, JSON/log scroll locally. Axe finalincomplete0 does not assert universal manual contrast or accessibility completion. Initial mobilecontrast incomplete1 remains in the original receipt. Pending/duplicate-submit product behavior was not changed; broader R3, realTLS/OIDC,cluster,production/load and newtag/deploy not claimed. Aggregate calls/provider usage/time/cost remainunknown/null.

Publication checkpoint: R29 independent review ACCEPT original R2 M1–M3, no P1/P2. Initial staged whitespace check rejected two whitespace-only lines in the public UI RED log; public copy normalized with updated hashes/provenance, original private failure log retained. No source/runtime evidence changed. Root project-success validator passed42contracts/index after accepted-main integration. Attempted extra generate_project_success_index.py check was unavailable (file absent); the existing validator already covers navigation/index. Current CI/normalmerge/readback remain pending.
