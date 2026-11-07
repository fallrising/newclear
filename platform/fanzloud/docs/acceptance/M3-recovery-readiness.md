# M3 recovery readiness — 2026-11-02

Result: **original installation still locked; bounded proposal prepared**.
This record accepts no new runtime capability. Scope is owner-requested source and
retained-state investigation, operational documentation, and a reviewable next step.
Source inspected: `a502addb2a81cb0f2bd516c00478b9236eaf2a4b`.
Current desk claim [PR389](https://github.com/fallrising/desk/pull/389) merged
`b83bc8255b68d6793baa8374320918e7e802a50c`; no competing open claim PR was observed.

## Evidence and gap

The existing chain is Web → Rust private gateway/durable intent → AP command/Worker
→ Connector/Cocoon isolated workspace → formal subscription CLI → AP immutable
archive → Web diff/checks/download → other-vendor candidate-only reviewer.
AP remains the sole execution and lease authority. Accepted M1/M2 and readonly
review are retained; no rerun was performed during this investigation.

| Observation | Evidence and practical meaning |
| --- | --- |
| Original SQLite still has one confirmed and one unknown intent | Read-only immutable SQLite open; no WAL/journal sidecar; unknown receipt/run reference null. Before/after SHA256 `d174f62669a1c45ca2d12c23605d7e84219f0ca3c426b946e441ef65ed3177d7` equal. No SQL write or store reinitialization. |
| Historical AP audit identifies a completed command for each key | Preserved audit at2026-11-01T14:53:53.780379Z. Unknown key maps to run `acd1054a-080c-4104-9f70-e06e5b73f60b`, cancelled/not_allocated. This audit is historical evidence, not a current authenticated product query or completed recovery. |
| AP has exact command identity but no public lookup | `src/agent_platform/store.py::Store.command` commits operator/route/key/payload_hash/result in one transaction; `api.py` exposes create and run reads, no command-key GET. Repeating POST invokes command admission and is disallowed as investigation. |
| Fanzloud cannot clear unknown through supported Web operation | `isolated/persistence.rs` authenticates and stores intent/receipt; `SubmissionStore::confirm` can validate and atomically bind a receipt, but no route obtains trustworthy recovery evidence. Listing reads saved intents; refresh can persist AP observations, but neither confirms an unknown intent nor resends work. |
| No full event transcript claim | Durable observations are bounded snapshots; they are distinct from the complete AP event stream. Arbitrary inference continuation is outside FN04. |
| Credential scope bounded without disclosure | Only named private configs were parsed; output contained booleans, permissions and equality results. Two references share retained DB/password; endpoint snapshot differs. Read-only Docker inspection: stopped, restart=no, loopback bindings, old password present in seed environment. No password printed or changed. |

Latest accepted actual review source remains `865ed05edc732d3fa61313b9303ce3f9a907c665`;
delivered closure `1ee9018daab6d97bef3526dda3f00462ad564c4d` via PR952/954.
Review run `56b60303-2a9d-40da-b369-57d0f1a0684c` accepted the retained Claude
candidate; exact1896-byte archive survived Rust/AP restart. First-round accept means
rework/second-round evidence is native-only. The separate fresh acceptance store
never repaired the original installation. Historical SIGTERM CI timeout and passing
focused/failed-job retry remain retained with unproven cause; no rerun here.

## Checks and limits

Documentation checks and independent review are recorded in the delivery PR and
private handoff. There is no production/test/schema/dependency change; local runtime
suites are not replayed for prose edits. Required hosted checks still gate merge.
No new browser/DB service, worker, coding invocation, VM, resource change or credential
mutation occurred. No current live API/DB query was made. Remote runtime cleanup is
the retained previous proof, not a new host audit; no remote host was contacted.

The [bounded recovery proposal](../specs/PROPOSAL-M3-recovery.md) fixes U01–07,
maintenance rollback, execution windows and stops. All U01–07 are **NOT_RUN**.
Public operator guidance is corrected to reflect accepted M2/M3 capabilities while
keeping the original-store lock, stopped services and lack of standing URL visible.
T-0442/T-0447/T-0449 remain in_progress; no full M3/FN07/platform acceptance or tag.

Independent native review: **ACCEPT_READINESS**, after correcting the wording that
run Refresh can persist observations. Reviewer inspected exact source/documents and
sanitized ledger drafts; private-state observations are attributed parent evidence.
Local `python3 scripts/check_project_success.py` passed53 contracts; edited recovery
links and `git diff --check` passed. Required hosted CI and delivery remain pending
at this document snapshot. No runtime acceptance test was claimed.
