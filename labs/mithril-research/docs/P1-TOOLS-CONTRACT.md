# P1b tooling contract

This is an offline-developed partial-P1 slice. It adds private bundle generation,
a fixed one-shot SSH helper for observe/stop/remove, a guarded down/reconcile
controller and destructive-cleanup preview. No up, upload, cluster initialization,
remote smoke, install, image publication, arbitrary remote commands or purge
application is supported. No real SSH/runtime operation is executed as delivery
verification. Full P1, MR-004, P2/P3 remain incomplete.

## Binding and shared builder API

The corrections D1-D5 in [.team/reports/T-004](../.team/reports/T-004.md) are binding
acceptance requirements. They are design/review evidence, not runtime approval.
Keep labctl.py's existing fixture plans/API and evidence lane unchanged.

New scripts/bundle.py exposes:
- build_manifest(plan, expected_plan_digest, runtime_spec) -> strict nonsecret manifest
- validate_manifest(manifest, expected_bundle_digest) -> semantically rederived manifest
- build_bundle(plan, expected_plan_digest, runtime_spec, credentials) -> rendered bundle
- write_bundle(bundle, output_path) -> sanitized summary; exclusively new private output

The manifest is nonsecret but still private: it contains inventory identities,
addresses and paths and must never be copied to public reports.

Manifest exact keys: schema_version=1, lane="offline-bundle", source_plan (full
validated P1a plan), runtime_spec, bundle_sha256. Digest is canonical JSON of the
other four fields, computed before rendering. validate_manifest reconstructs the
entire manifest and rejects extras/altered semantics. All rendered labels are
derived from run_id, source plan digest, bundle digest and service role.
The source plan must be executable under its *local declared-input* contract;
that does not establish remote readiness or authorization.

runtime_spec exact keys: schema_version=1, template_revision="p1b-v1",
runtime_uid, runtime_gid (strict positive non-root numeric IDs), secret_revision
(opaque nonsecret reference), mithril_image, mithril_image_provenance.
mithril_image is an immutable image@sha256:<digest> or "UNRESOLVED".
mithril_image_provenance is exactly {research_commit, binary_sha256, platform,
evidence_reference}, matching the fixed source/binary/platform in source_plan,
or "UNRESOLVED". References are declarations, not authenticated verification.
Both image and provenance must resolve together; unknown means draft. A draft
must not emit a runnable H4 Compose service image; provide a clearly nonrunnable
H4 draft document and report draft classification. Do not invent artifact pins.

Label keys: io.mithril-research.run, io.mithril-research.plan,
io.mithril-research.bundle, io.mithril-research.role. Values are exact derived
run_id/source-plan SHA256/bundle SHA256/role (M1-M3,R1-R3,A).
Remote layout under each host's data_root: config/<role>/..., data/<role> for
Redis, with per-node nodes.conf and AOF; Compose files live in the private output
for review. Never write remote paths locally. Cleanup candidates are only
Redis data/<role>, never the run root or config/evidence/state.

credentials exact keys: schema_version=1, backend_proxy, backend_replication,
backend_operator, proxy_app, proxy_admin. Five distinct bounded safe ASCII
single-token password values. Usernames are fixed to those key names. Values
enter only via bounded private no-follow files in CLI; reject injection,
whitespace/control bytes and ambiguous config syntax. No secret content/hash
in CLI summaries, errors or nonsecret manifest. The final Mithril config itself
contains secrets because pinned upstream has no include/secret-file directive.

Bundle output must expose four host documents (H4 is draft when image unresolved),
six Redis configs/ACLs and one private Mithril config. Default users disabled;
proxy app allowlist PING/SET/GET/TTL/DEL under run_id:*; candidate backend proxy
supports required topology/READONLY plus app commands, replication uses its own
account, operator separate. Candidate ACL effectiveness remains untested runtime.
Use numeric nonroot user, explicit entrypoint/argv, exact private binds, host
network, fixed limits, no ports/privileged/root/socket mounts, read-only config,
retained data paths and bounded logs. All output dirs 0700/files 0600; reject
existing paths, traversal/links and source/remote-intent destinations before writes.
CLI output is aggregate sanitized status only. An offline bundle is never live-ready.

## Transport, down and cleanup

Transport consumes the nonsecret manifest and exact ownership manifest. Its
API and schemas are strictly validated in ssh_executor.py and documented in
P1-TOOLS.md at integration. Only fixed observe/stop/remove operations exist.
A literal trusted Python helper is passed through a safely quoted constant
remote command; request JSON is stdin, with no untrusted remote shell expansion.
Strict host checks, BatchMode, no forwarding/TTY/multiplexing, bounded concurrent
stream reads/deadline, same-session machine identity checks and explicit host-local
Docker socket are mandatory. Machine identity is SHA256 of the exact bounded
/etc/machine-id bytes (including its newline); malformed/missing identity refuses.
An explicit private SSH config and known-hosts file identify the existing approved
mapping; transport configuration is input, not permission to contact a host.
CLI must require explicit execute-approved intent plus separate admission record
for mutation. The current delivery invokes transport only via injected mock runner.

Durable private owned state/journal/lock bind run/source-plan/bundle, exact host
and full container IDs. Intents persist before effects; uncertain outcomes fence
mutations. Reconcile observes only; no blind retry. Unknown/error/invalid inspect
is never absent. Stop-before-remove, no forced remove/volume flags; data and all
records retained. Down requires separately supplied exact admission with approval
reference, target host/IDs/actions/digests and current binding; no automatic approval
generator. An operator record is not authenticated authority and cannot supersede
actual session authorization. Approval for down cannot authorize purge.

An unchanged pre-effect observation cannot prove remote cancellation. Pending
stop/running and remove/stopped remain uncertain and fence all further mutations,
even under a new admission. Remote journals support only uncertain/completed;
unsupported abandoned records and unresolved historical approval references are
refused. Existing labctl local-fixture semantics are separate and unchanged.

Purge preview has its own schema/digest, exact data candidates and unmet identity,
filesystem ownership/link/mount/reference/process-use/approval requirements. No
apply function or delete transport operation exists. Mock observations cannot make
live paths eligible. Independently confirmed exact preview approval would be
necessary but insufficient until those fresh live checks exist. Public summaries
never disclose raw identities, aliases, addresses, paths, credentials or receipts.
