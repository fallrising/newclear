# Mini-SDD: Fake executor and security boundary

Status: Accepted at G0 for P0-A
Parent: `../SDD.md` clauses HAI-BOUNDARY, HAI-EXEC and HAI-SEC

## Adapter contract

`ExecutorAdapterV1` exposes capability declaration, dispatch, execution lookup, cancellation request
and observation polling. Every request binds adapter ID/version, Run ID, immutable input digest,
workspace/artifact scope, lease epoch and restore generation. Every response is schema-validated and
treated as untrusted observation until the application accepts it.

P0-A registers one deterministic `fake/v1` profile with capabilities selected from
`start_ack`, `heartbeat`, `lookup`, `cancel_ack` and `durable_checkpoint`. A scenario must explicitly
declare which capabilities it simulates. Asking for an unsupported operation returns
`capability_unsupported` without changing authoritative state.

## Fake scenario envelope

A test scenario is immutable input data containing an ordered list of observations triggered by a
fake clock or explicit test tick: dispatch received, start acknowledged/lost, heartbeat, checkpoint,
terminal result, late result, lookup outcome, cancel acknowledgement or unknown. Scenario data cannot
contain executable code, paths outside the staging root or network locations.

Fake output is written only to a per-Run staging directory. The application seals validated bytes
into the digest-addressed artifact store before creating a Candidate/Evidence reference. Fake never
invokes a host shell, Git mutation, network, provider credential, merge, deployment or release.

## Permission matrix

| Action | Human operator | Fake worker | Verifier |
| --- | --- | --- | --- |
| Create/edit/transition WorkItem | allowed | denied | denied |
| Dispatch/cancel/reconcile Run | allowed | observations only | denied |
| Publish Candidate/artifact observation | fixture/admin command | current leased Run only | report only |
| Publish Evidence/Review | fixture/admin command | producer evidence disallowed where independent | allowed for assigned recipe |
| Approve/complete/reopen | human-only | denied | denied |
| Change accepted graph/policy | human-only | proposal only | denied |

Knowing a human principal ID never grants its authority. Authorization happens before reading a
sensitive body or resolving cross-project IDs. Approval is exact-subject, expiring and single-use
where policy requires it.

## Untrusted data and denial boundary

Repository content, Markdown/HTML, logs, artifact bytes and adapter text are rendered as data. Active
content is sanitized; paths are rooted and symlink-safe; size/type/digest limits apply before
publication. Logs redact tokens, cookies, authorization and secret-like fields. Same-origin/session
checks protect commands and sensitive reads.

P0-A has no real credential store and cannot prove real OS/provider isolation. Tests for credential,
shell, network and external mutation are denial tests for the Fake boundary only and MUST be labelled
as such. Real isolation/terms/cancellation require G2.

## Named tests

- `TestFakeAdapter_CapabilitiesFailClosed`
- `TestFakeAdapter_ScriptedStartHeartbeatCheckpointAndUnknown`
- `TestFakeAdapter_HasNoShellNetworkOrExternalWriteCapability`
- `TestAdapterObservation_RejectsStaleEpochOrRestoreGeneration`
- `TestAuthorization_PrecedesSensitiveBodyAndProjectLookup`
- `TestApproval_SubjectChangeExpiryAndSingleUse`
- `TestArtifact_PathSymlinkActiveContentAndDigestDenial`
- `TestLogsAndContextPack_RedactSecretCanary`
