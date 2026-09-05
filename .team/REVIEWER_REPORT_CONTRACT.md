# Reviewer report compatibility contract

Status: Candidate v1; requires independent review and orchestrator acceptance.

Captured: 2026-09-05

## Purpose and authority

This contract defines a forward-only report shape for independent reviewers while preserving the
bytes and visible decisions of the existing HAI Taskboard evidence chain. It does not accept a task,
reinterpret a review decision, change `.team/PLAN.md`, or change the validator. Only the
orchestrator may record acceptance in the execution-status authority.

The existing task/report contract in `docs/specs/initial-plugin.md` remains authoritative. This
file narrows that worker-oriented report contract into a reviewer-compatible authoring profile that
the current validator can check without a separate reviewer mode.

## Validator identity and observed behavior

The compatibility baseline is:

- Package/cache identity: `codex-team-superpowers/0.1.0+codex.20260904040057`.
- Source: `/home/ckc/.codex/plugins/cache/fallrising-private/codex-team-superpowers/0.1.0+codex.20260904040057/scripts/teamctl.py`.
- Source SHA-256: `a8c49a0e6181614c173b36fbbf0e35931f5edbbce4604b6d7e69d70b10017185`.
- Runtime used for this inventory: `Python 3.11.2`.
- Help invocation: `python3 <source> --help`; it exposes `validate-task`, `validate-report`, `task`,
  and `report`, each with one path argument. The executable has no self-reported semantic-version
  option, so package/cache identity plus the source digest is the version identity.

For reports, this exact source requires the first non-empty line to be one of `STATUS: DONE`,
`STATUS: PARTIAL`, or `STATUS: BLOCKED`; requires exactly one non-empty `Summary`, `Verification`,
`Documentation`, and `Risks and Follow-ups` section in that order; and applies
`^- (.+) — (passed|failed|skipped)$` to every stripped non-empty line beginning with `-` in the
Verification section. A `DONE` report needs at least one passing entry and may contain no failed or
skipped entry. The validator checks report syntax and status consistency only; it does not decide
whether a review's visible PASS/FAIL is correct or whether the orchestrator accepts it.

## Immutable legacy compatibility manifest

The following inventory covers every report that existed before T-012. `Validator PASS` means only
that the bytes match the current worker-report grammar. `Validator FAIL` has the exact current error
`Verification must contain entries formatted '- <evidence> — passed|failed|skipped'`. `Visible
outcome` is read from the report status and Summary; a worker `DONE` means the worker completed its
envelope, not that its own work was accepted.

| Report | Status | Visible outcome | SHA-256 | Current validator |
| --- | --- | --- | --- | --- |
| `T-001.md` | `DONE` | Worker completed repository-boundary review; not self-acceptance | `27250c73595a515e9985131c1e258e4a22d67a8eb451e2638ad73c2ed338d6db` | PASS |
| `T-002.md` | `DONE` | Worker completed domain-contract review; not self-acceptance | `b81518b846164f7b55c7ec1185bd558f87168801d66d4c527639a9e889d6e58c` | PASS |
| `T-003.md` | `DONE` | Worker completed UI-contract review; not self-acceptance | `37dc8011c3fc56c9b9b56d44a059309dc1775f146f9fed8f612833b8b42a0da9` | PASS |
| `T-004.md` | `DONE` | Worker completed SQLite selection spike; not self-acceptance | `c0cc1978642d671e0692e735b4981faf86df1da9986f279e01711522389d58ea` | PASS |
| `T-005.md` | `DONE` | Worker completed transport-contract review; not self-acceptance | `621751635806dd8e20384c08ab9319388aa692afacbee1b3c0b60a2cb09f4190` | PASS |
| `T-006.md` | `DONE` | Worker completed reproducibility/CI review; not self-acceptance | `e16118fc2b2d5f60442f3e23dea434a1cd5a9478e958bcb5a9c1e4ba3ce8ff93` | PASS |
| `T-007.md` | `PARTIAL` | Independent G0 decision `FAIL` | `bf37ccce909eb9a305a861a74f680a31f3f5f9c0162583fb219e8267fb982212` | FAIL |
| `T-008.md` | `PARTIAL` | Independent G0 re-review decision `FAIL` | `9f661687f996621c14e0b359ef9b0041e05a279567c8aea67924446ebbc18e08` | FAIL |
| `T-009.md` | `PARTIAL` | Independent final G0 re-review decision `FAIL` | `a8edf24cdabc0347fc0ed3756507d0e3e470833c953d900b1a6ce71ecdeb6d94` | PASS |
| `T-011.md` | `DONE` | Independent G0 decision `PASS` | `25f52053643dfb2ad9c12bf3dff6475eb8588e09a9c7a5d13bd53141841522f7` | FAIL |
| `T-020.md` | `DONE` | Worker completed domain-kernel implementation; not self-acceptance | `e7c7b18240127ecc7baa6a9d45c560d7e6c9ff6a450eca11fa3afbbe8795d3d1` | PASS |
| `T-021.md` | `PARTIAL` | Independent domain-kernel decision `FAIL` | `bee03e005d89ed3e32087f1f8761475325ab1c4b708129d567762733ac9425fd` | PASS |
| `T-022.md` | `DONE` | Worker completed Done-authority repair; not self-acceptance | `d69bdb8ed28f1729b3806a81df7b8275b5927d512cd0f3167aab1bce0d047f85` | FAIL |
| `T-023.md` | `PARTIAL` | Independent domain-kernel re-review decision `FAIL` | `bec1c433d5539af86ad4bacebf8342484ca81030f1baa63f162c8eef101d5440` | FAIL |
| `T-024.md` | `DONE` | Independent domain-kernel decision `PASS` | `309a209287a54454e1b713f56cc34e531654c333c92954cf19fa26f94e351967` | FAIL |
| `T-030.md` | `DONE` | Worker completed static web-shell implementation; not self-acceptance | `2829e300bea58a18163140deeb336877ccf8570d04608d03cbec3c647d5c4791` | PASS |
| `T-031.md` | `PARTIAL` | Independent web-shell decision `FAIL` | `42726f6b423b04e0e0f52b0c4bfd8a7752c5916493ee686586ae77f329dfa466` | FAIL |
| `T-032.md` | `DONE` | Worker completed web-bootstrap repair; not self-acceptance | `e21aaee9621172339242b053f8d98cc544f14c9f5a2826bda1a0425bdf8231fe` | PASS |
| `T-033.md` | `DONE` | Independent web-shell decision `PASS` | `fb0cb6c2f5216feaa1a0a5debbaa2c6e4f926395332ebcc4017993db10383cd7` | FAIL |

These hashes and report bytes are immutable historical evidence. In particular:

1. A syntax incompatibility MUST be recorded as compatibility/process metadata; it MUST NOT turn a
   visible `PASS` into `FAIL`, turn `FAIL` into `PASS`, or change a worker's completion claim.
2. Existing reports MUST NOT be reformatted, wrapped, normalized, or edited to satisfy a newer or
   older validator. Accepted hash references MUST continue to name the original bytes.
3. Historical failed and skipped checks MUST remain visible. A later passing review supplements the
   earlier result; it does not erase or relabel it.
4. The orchestrator MUST use the task graph, visible review decision, report hash, candidate identity,
   and executed evidence together. Validator compatibility alone is never acceptance evidence.

## Forward-only reviewer report profile

Every reviewer report created after this contract is accepted MUST follow the initial plugin report
contract and these additional rules:

1. The task envelope grants report-only durable scope. A reviewer MAY use explicitly authorized
   read-only probes or isolated temporary paths, but MUST NOT fix the candidate during the review.
2. The Summary states an unconditional visible decision such as `PASS` or `FAIL`. A
   `PASS_WITH_EXPLICIT_FOLLOWUPS` is permitted only when every required check passed and each
   follow-up is explicitly outside the bounded acceptance gate.
3. Every Verification item occupies one physical source line and ends exactly in ` — passed`,
   ` — failed`, or ` — skipped`. The item itself names the command or artifact, exact exit/result,
   and enough identity to audit the claim.
4. No Verification bullet may wrap onto continuation lines, and no nested bullet or other stripped
   line beginning with `-` may appear in that section. Details belong on the same line, in prose or
   code blocks under another section, or in a separately hashed immutable artifact.
5. `STATUS: DONE` is allowed only with at least one passed item and no failed/skipped item. Any
   required failure or NotRun check is retained as `failed` or `skipped`, and the report uses
   `STATUS: PARTIAL` or `STATUS: BLOCKED` as appropriate.
6. The reviewer runs the exact source-identified `teamctl.py validate-report <report-path>` before
   handoff and records its command, exit, and output as one physical Verification line. If a later
   edit changes the bytes, the reviewer reruns validation.
7. The reviewer records an exact report-only scope audit. It does not claim acceptance. Only the
   orchestrator may inspect the diff/evidence, accept or reject the work, and update `.team/PLAN.md`.
8. After handoff, acceptance references the report SHA-256. Any correction is a new report or an
   explicitly versioned superseding artifact; the accepted bytes are never silently replaced.

A minimal passing reviewer shape is:

```markdown
STATUS: DONE

## Summary

Independent decision: PASS.

## Verification

- `exact command` exited 0 with `exact bounded output` — passed

## Documentation

Added only the authorized review report.

## Risks and Follow-ups

No required check remains failed or skipped; later-gate work is outside this review.
```

A failed or NotRun required gate remains explicit, for example:

```markdown
STATUS: PARTIAL

## Summary

Independent decision: FAIL.

## Verification

- Candidate invariant probe exited 1 with `authority bypass` — failed
- Required browser gate was unavailable and was not executed — skipped

## Documentation

Added only the authorized review report.

## Risks and Follow-ups

The orchestrator must route a bounded repair and a fresh independent review.
```

## Future validator migration

A future validator may add an explicit reviewer mode, multiline evidence attachments, or structured
machine output, but migration is additive:

1. Freeze this legacy manifest at its committed Git identity. Do not rewrite any listed report.
2. Identify the new validator by immutable source digest, package/version identity, runtime, command,
   and validation timestamp.
3. Add a new immutable compatibility result under
   `.team/reviewer-report-compatibility/<validator-source-sha256>.md`. Each row binds the report path,
   original report SHA-256, visible outcome, validator mode, verdict, and exact diagnostic.
4. If the new mode accepts a legacy multiline report, record the new PASS beside the original
   current-validator FAIL. Neither result changes the report's visible decision or acceptance state.
5. New reports use the contract/version current at their creation. Accepted report hashes stay
   resolvable, and migration tooling MUST fail closed on an unlisted byte change or hash mismatch.

This overlay model preserves evidence lineage while allowing a better reviewer-aware validator to
be introduced without bidirectional normalization or history rewriting.
