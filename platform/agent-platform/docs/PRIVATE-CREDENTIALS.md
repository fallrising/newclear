# Private credential files for the mock tool Worker

Status: implementation and acceptance pending. This slice hardens the existing normal Worker `secret_file` integration; it does not introduce live providers, a credential service, automatic document distribution or production activation.

## Boundary and compatibility

The operator supplies an absolute configuration path through `TOOL_BROKER_MOCK_CONFIG`. Its existing JSON schema and immutable service/credential revision semantics remain unchanged. Only the trusted Worker reads the config and resolves its `secret_file`; neither path nor credential is accepted from a task or guest. The adapter remains loopback mock-only. Approval permits bounded operations, never shell/file access to a secret.

Previously the loader checked a path and later reopened it. A replacement could change what was read; ancestor symlinks and hardlinks were not rejected. The new private reader must validate and read the same descriptors, including the config itself. Relative paths, dot/traversal components, repeated separators and trailing slashes are rejected rather than normalized. Both final files require a private immediate parent directory. This intentionally tightens formerly accepted layouts; move operator-managed synthetic fixtures into a private directory, not weaken permissions checks.

## Descriptor contract

- Walk from `/` using directory-relative descriptors, `O_DIRECTORY`, `O_NOFOLLOW` and `O_CLOEXEC`. Every ancestor must be root- or effective-UID-owned and not group/other writable. Root-owned sticky temporary directories are allowed as ancestors only; the immediate parent must be effective-UID-owned and mode 0700 (or stricter owner-only searchable mode).
- Final files must be regular, effective-UID-owned, one link, owner-readable, no execute/special/group/other bits. Open without following links and nonblocking so a FIFO cannot hang before type validation. No ambient HOME/CWD resolution or proxy fallback.
- Reject POSIX access/default ACLs on walked directories and files. Inspect by descriptor; unexpected xattr inspection errors fail closed. A filesystem that explicitly reports xattrs unsupported has no POSIX xattr ACL to inspect. This is a Linux POSIX ACL contract, not a claim about arbitrary network filesystems or host privilege.
- Bound actual bytes read to limit plus one: 65,536 for JSON and 4,096 for credential text. Reject oversize or changed metadata across the read, including size, mode, ownership, link count and timestamps. Decode strict UTF-8; retain existing surrounding-whitespace handling for the credential.
- Close every descriptor on success or failure. Expose only fixed `tool_mock_config_invalid` (or existing missing-config code); no secret, path, raw OS error or config values in public errors. Existing schema validation still rejects duplicates and unexpected fields.

A same-UID or root adversary can access broker memory and alter owned files; descriptor checks are not that isolation boundary. The untrusted agent remains inside the existing deny-all guest, without host secrets mounts, privileged sockets or broker process access. Do not run an untrusted host coding agent with the broker's UID and claim mode 0600 protects the secret. The privileged operator must not rewrite a revision in place during use. No hot reload or general-purpose rotation service is added; existing SQL service-digest/revision checks reject incompatible reuse and existing revocation/unknown-result rules remain authoritative.

## Verification plan

1. Demonstrate an accepted unsafe link/layout against the old loader. Add focused deterministic tests for valid config/secret, lexical paths, final/ancestor symlinks, hardlinks, nonregular files/FIFO, ownership, modes, ACL inspection, oversize and metadata replacement races, fixed errors and descriptor cleanup.
2. Run existing SQL/HTTP Worker and broker suites, including no-dispatch invalid configuration, revision conflict and guest payload filtering. These are local mocks, not KVM evidence.
3. Run the normal Worker real-KVM harness on newly owned test resources with synthetic credentials: normal approval → events polling through SDK finished → verified result; disabled; cancel-in-flight; unknown tool outcome; partial stop proof. Confirm native resource release and stop every task-owned service/process. Independently probe only synthetic files, never production secret paths.
4. Record source hashes, exact checks and limits; independent review and repository CI precede merge. Public evidence contains counts, fixed codes and hashes of source files only, never credential values/digests or private paths.

## Operator layout

A system-service deployment may keep private policy under `/etc/agent-credentials/private/` and versioned values under `/var/lib/agent-credentials/secrets/<opaque-id>/<revision>`, with private broker-owned parent directories. These are conventions, not paths created by this change. The current connector/Worker mock setup continues to use disposable private directories; no existing host key is discovered or migrated. See [normal Worker setup](WORKER-TOOLS.md) and [KVM acceptance](WORKER-TOOLS-KVM.md).
