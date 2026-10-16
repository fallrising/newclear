# P1b: private configurations and bounded SSH tools

P1b is developed and verified offline. It adds a four-host configuration bundle,
fixed SSH observation/container down, observation-only reconciliation and purge
preview. These tools require the existing strict plan and independent input
bindings. They do not provide upload, up, cluster initialization, live smoke,
installation, image publication or data deletion. Full P1 and MR-004 remain
incomplete; the formal status is in [STATUS](STATUS.md).

Use [P1-LOCAL](P1-LOCAL.md) for the original synthetic lifecycle. Its result lane
stays local-fixture. New mock transport evidence is labelled mock-ssh and real
transport results ssh; neither a bundle digest nor a mock result grants remote
authorization. Actual SSH/runtime acceptance is UNEXECUTED in this delivery.

## Private bundle

scripts/bundle.py consumes a validated plan, an independently retained plan
digest, a runtime specification and a private credential file. The separate
bundle manifest binds the exact source plan, runtime declaration and template
revision; its digest excludes credential content. The manifest still contains
private machine metadata. Keep the entire generated bundle and all input files
outside the source checkout, in private 0700 directories with 0600 files.

[Runtime specification example](../examples/runtime-spec.example.json) leaves
the Mithril runtime image and provenance unresolved. The existing runtime lock's
Rust builder is not a runtime image. A source-built binary alone also does not
identify a runtime image. Unknown image/provenance renders a nonrunnable H4
draft, never a guessed digest or implicit latest image. A resolved declaration
must bind the fixed source commit, binary SHA256, platform and verification
reference. The CLI validates those declarations; it cannot authenticate them.

The output has one host document for H1-H4, six Redis config/ACL pairs and one
Mithril config. H1=M1+R3, H2=M2+R1, H3=M3+R2, H4=A. Host networking uses exact
private bind/announce addresses, nonroot UID/GID, fixed entrypoints, read-only
configuration mounts, bounded memory/logs and separate retained data directories.
The tool does not create remote directories, copy files or chown existing data.
File ownership/readability inside the eventual runtime image remains a live gate.

Credential JSON has exactly schema_version=1 and backend_proxy,
backend_replication, backend_operator, proxy_app, proxy_admin. Each value is a
distinct bounded safe ASCII token. Supply them through a private input file;
never put a password in a command argument, environment dump or public log.
The fixed Mithril parser has no include/secret-file setting, so its rendered
config contains its backend password and named-user ACL rules and is itself
secret-bearing. Default users are disabled. The initial app profile allows
PING/SET/GET/TTL/DEL on this run's key prefix only; backend and operator accounts
are separate. These are candidate ACL configurations, not a claim that runtime
authorization has passed. The bundle summary prints counts/classifications only.

## Transport and cleanup boundaries

The transport uses a literal trusted Python helper command and bounded JSON
stdin, avoiding request values in SSH's remote command string. An explicit reduced
private SSH mapping and known-hosts file remain operator inputs. Mapping directives
are restricted to Host, HostName, User, Port, IdentityFile, CertificateFile,
IdentitiesOnly, HostKeyAlias, HostKeyAlgorithms, PubkeyAcceptedAlgorithms,
RequiredRSASize and PreferredAuthentications. Include, Match and executable hooks
are refused. Mapping file paths must use literal ASCII letters/digits, slash,
underscore, dot or hyphen, without traversal or OpenSSH token expansion. BatchMode,
strict host-key checking, disabled forwarding/TTY/multiplexing and explicit
host-local Docker socket prevent accidental broadening of the command path.
It neither installs prerequisites nor escalates with sudo.

Every operation binds a unique operation ID, run, plan, bundle, anonymous host
role, expected machine identity and full immutable container ID. The identity
hash is SHA256 over the exact bounded /etc/machine-id file bytes, including the
newline. Missing/malformed identity or drift refuses effects in that same
helper session. Machine identity is distinct from SSH host-key verification.

Down requires a separate private exact admission record and explicit
execute-approved intent. Its reference records independently granted approval;
this file does not authenticate an owner or confer authority. Actual session
approval must already cover those hosts, IDs and actions. This delivery has no
such runtime execution authorization and uses mock transport only.

Before each effect the controller durably journals the operation; the helper
rechecks ownership labels and exact identity. It stops before removal, never
forces removal or deletes volumes. Timeout, lost reply, malformed output or
ambiguous inspection leaves uncertainty and fences later mutations. Killing
local SSH does not prove remote cancellation. Reconcile only observes exact
IDs; it never replays the mutation. Local locks coordinate cooperating callers,
not other Docker users or separate controllers with different state directories.
For a pending stop, observing running still leaves uncertainty; for a pending
remove, observing stopped still leaves uncertainty. A new admission cannot clear
that fence. The opposite observation does not prove the original remote attempt
has terminated. Only the matching terminal stopped/absent observation resolves
that intent; unsupported abandoned remote journal records are refused. There is
no force-reset or cancellation-proof interface in this slice.

Down retains data, nodes.conf, credentials, configs, manifests, journal and
evidence. Purge preview lists only the derived Redis data directories for the
supplied owned Redis targets (at most six), with an
independent preview digest and explicit unmet conditions. Eligible live paths
remain empty: host/filesystem ownership, references, process use, links/mounts
and separate exact purge approval all require fresh independent evidence.
There is no purge apply/delete function. A down admission cannot authorize it.

## Interfaces

The following are command forms for separately authorized future use, not a live
run record. Keep inputs and outputs private; `FILE` and `DIR` are placeholders.
Run from `labs/mithril-research` through the common workspace launcher.

```text
python3 scripts/bundle.py --plan FILE --expected-plan-digest SHA256 --runtime-spec FILE --credentials FILE --output NEW_ABSOLUTE_PRIVATE_DIR
python3 scripts/ssh_executor.py purge-preview --manifest FILE --expected-bundle-digest SHA256 --ownership FILE
python3 scripts/ssh_executor.py observe --manifest FILE --expected-bundle-digest SHA256 --ownership FILE --state-root DIR --transport-config FILE --execute-approved
python3 scripts/ssh_executor.py down --manifest FILE --expected-bundle-digest SHA256 --ownership FILE --state-root DIR --transport-config FILE --admission FILE --execute-approved
python3 scripts/ssh_executor.py reconcile --manifest FILE --expected-bundle-digest SHA256 --ownership FILE --state-root DIR --transport-config FILE --execute-approved
```

Bundle success exits 0; refusal exits 2. It creates an exclusively new directory
under an existing owned 0700 parent: `manifest.json`, `H1/compose.json` through
`H4/compose.json`, `H#/config/<role>/redis.conf`, adjacent `users.acl`, and
`H4/config/A/mithril.conf`. Partial output on failure is retained for inspection.
Credentials are distinct `[A-Za-z0-9_-]{1,256}` tokens; their file is at most
64 KiB, owned by the current UID, mode 0600, with one link and a 0700 parent.
No symlink components are accepted. Password rotation alone intentionally leaves
the bundle digest unchanged: change the opaque `secret_revision` when recording
a new credential revision. The declaration does not verify secret installation.

Ownership JSON has exactly `schema_version: 1`, `run_id`, `plan_sha256`,
`bundle_sha256` and `targets`. Each target has exactly `host` (H1-H4), `role`
(A, M1-M3 or R1-R3) and `container_id` (full 64 lowercase hexadecimal characters).
One to seven targets are allowed, each role and ID unique and on its fixed host;
partial prior runs can therefore be inspected. Names, shortened IDs and broad
label selection are never accepted as object identity.

Transport JSON has exactly `schema_version: 1`, `ssh_config`, `known_hosts`
(absolute private regular-file paths) and `deadline_seconds` (integer 1..60).
All executor JSON files are bounded, owned, mode 0600 and read without following
links. The state directory is exclusively bound to the exact ownership record,
origin lane and local filesystem identity. Reuse the same state root for the
run; inventing another directory is not a distributed lock or safe retry policy.

Down admission JSON has exactly `schema_version: 1`, `purpose: "down"`,
`admission_id` (32 lowercase hexadecimal characters), `approval_reference`,
`ownership` (the exact ownership record), `actions: ["stop", "remove"]` and
`clients_stopped: true`. It asserts prior approval and client quiescence; the
tool cannot independently verify either. Retain the journal and resolve every
uncertain intent through observation before considering further effects.

The Python APIs are `Transport(config)`, `control(manifest, expected_bundle_digest,
ownership, state_root, action, transport, admission=..., execute_approved=...)`,
`purge_preview(manifest, expected_bundle_digest, ownership)` and
`validate_purge_approval(preview, expected_preview_digest, approval)`.
The private test-only `_runner` injection labels results `mock-ssh`; the CLI
cannot select a custom runner or remote command. Purge CLI output is an aggregate
summary; inspect the full private preview through the Python API. Its approval
validator records only a necessary independent assertion, and never makes any
path eligible or performs deletion. See the exact schemas in
[`ssh_executor.py`](../scripts/ssh_executor.py) and the
[binding contract](P1-TOOLS-CONTRACT.md).

Purge approval has exactly `schema_version: 1`, `purpose: "purge-preview"`,
`approval_reference` (resolved nonempty reference) and `preview_sha256`. Its
validator checks the independent digest and approval record shape only; it does
not reconstruct preview semantics or check live eligibility. Any future apply
implementation must add those validations and all fresh live gates.

## Verification and remaining gates

Run the offline contracts with make check and the original lifecycle with make
demo through the common workspace launcher. Exact commands/results, negative
cases and evidence limits are recorded in [VALIDATION](VALIDATION.md). Tests use
real local subprocess mocks, never real SSH/Docker services. Compose parsing,
when recorded, validates generated structure only and starts no services.

Still required: a verified Mithril runtime image and execution environment;
fresh H1-H4 mapping/admission/resource/recovery checks; approved bootstrap/up
and cluster orchestration; real Redis/Mithril ACL, network, health and retained
data acceptance; safely implemented separately approved purge and P2/P3 results.
The source pin remains 9959fe2e5cd466614dc20ef7b710befaaf1d746a.
