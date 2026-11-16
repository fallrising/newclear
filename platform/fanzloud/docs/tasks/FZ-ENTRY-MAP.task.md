---
id: FZ-ENTRY-MAP
title: Source-bound Fanzloud / AP / Office entry equivalence
status: in_progress
milestone: portfolio documentation
primary_module: documentation
contract_units: []
depends_on: []
risk: low
---

# Goal and ownership

Owner directly requested the proposed first portfolio slice.
[Issue #1047](https://github.com/fallrising/newclear/issues/1047) is the local work entry;
Codex primary agent owns this document delivery. Planning context:
[desk PR #422](https://github.com/fallrising/desk/pull/422), whose separate prompt-review
requirement is not closed here. Original product contracts remain unchanged.

Start: 2026-11-16T17:09:10Z. Estimate: 30–45 active minutes plus CI; check progress
every 20 active minutes. CI wait is bounded to 20 minutes per delivery PR, then
retain exact head/state and recovery entry. At most two evidence-based diagnosis/fix
attempts for the same failure. Model usage/cost unknown; no new external CLI
consultation or product/provider execution.

# Scope and inputs

Baseline `fead565acb877453861b6895471326096b923f0b`, compared with planning snapshot
`2aa21f10b53ecaeb079279b6531bbb47a103e937`. Relevant new evidence: Office T27;
Fanzloud and AP bytes are unchanged between these refs.

Write the [entry map](../plans/portfolio-entry-equivalence.md), this task,
its [acceptance](../acceptance/FZ-ENTRY-MAP.acceptance.md), task board and necessary
README/SUCCESS navigation/scope additions. The last two are required by component
rules and included in issue #1047. AP, Office, code and normative SDDs are read-only.
This document comparison creates no production Contract Unit, runtime, protocol,
provider, dependency, authority, live window, deployment, retirement or usable tag.

# Acceptance

| ID | Required evidence |
| --- | --- |
| E01 | Six journeys: create, identity, session, cancellation, recovery and results; each has fixed sources, evidence level, retained capability, gap and original return entry. |
| E02 | AP lifecycle writer remains unique on AP routes; retain Office terminal/session/local operations; no unknown resend or invented common identity. |
| E03 | FN07 owner operation, original Cloud AC04/full AC05 and Office MVP/AC11 gaps remain; T27 synthetic projection differs from original bytes/hash and general secret protection. |
| E04 | Optional read-only navigation/reference proposal adds no writer or global prerequisite; no UI/runtime adoption claimed. |
| E05 | Documentation/source/link and staged whitespace checks, fresh-context independent acceptance, required CI, normal merge/readback and board closure. |

# Verification and stop conditions

Run scoped project-success contracts, local link/fixed-ref checks, changed-file
allowlist and staged whitespace. Obtain one bounded fresh-context document-driven
review; follow up only on actual corrections. Required hosted Fanzloud/repository
CI remain gates. Unchanged native/live journeys are not replayed locally for prose.

Stop affected work for SDD changes, adjacent code, live windows, new credentials/spend
or entry cutover. Rollback: normal revert of documentation additions; no runtime
state is migrated. Keep board in_progress until merge; final board-only PR records
its actual merge time under the repository contract.
