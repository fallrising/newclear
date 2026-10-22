# Private reading build and Git export

These commands use Node 24.18.0 and Git. They do not deploy, contact a model provider, or configure live credentials. The examples run from `products/kith` with an operator-owned private content checkout.

## Build one immutable bundle

```sh
node reading/build.ts --repo /path/to/content-repo --commit FULL_40_CHARACTER_COMMIT --registry articles.json --output web/dist/_reading/current.json
```

Registry paths are relative to the content repository root, not the registry directory. The committed synthetic registry in this repository is `products/kith/content/articles.json`. Each article has an explicit ID; retain it when renaming its source path. Git blobs are read from the exact supplied commit without checkout, hooks, filters or content execution. IDs, titles, UTF-8, paths, article links and the complete bundle are bounded and validated before publication. A sibling temporary file is flushed and atomically renamed, so a failed build retains the preceding complete bundle.

Run the content build after the web build, which clears `web/dist`. Only the Worker may retrieve the private asset internally after authenticating the operator. The asset is not a public JSON feed. The deployment boundary and automatic browser refresh are defined in [the phase 2 contract](../docs/plans/reading-capture-phase2.md).

## Run one export pass

```sh
node reading/export.ts --repo /path/to/private-export-checkout --branch main --url https://your-kith.example --token-file /private/path/export-token
```

The token file must be a regular file owned by the current user with mode `0600` or stricter, containing only the dedicated export token and an optional final newline. Create and revoke this credential through Kith's operator controls. Do not put its value in command arguments, Git URLs, shell history or source control. The CLI logs only commit IDs, counts and overwrite events containing record kind/ID. HTTP is accepted only for loopback fixtures; external endpoints require HTTPS. Redirects are rejected.

Prepare a dedicated checkout on the exact configured branch, with one `origin` fetch/push destination and no unrelated changes or unpushed commits. The remote branch must already exist. Existing operator Git credentials authorize transport; the Kith token is sent only to the two export APIs. Keep the checkout private because Git history and the journal contain captured text. Git configuration and the same Unix user remain trusted; this is not a sandbox for a hostile repository owner.

The exporter requires Linux. A Linux abstract Unix-domain socket, keyed by the canonical common Git directory, serializes the entire pass across worktrees in the same network namespace. Do not run exporters for the same checkout in separate containers/network namespaces, whose socket namespaces are independent. The kernel releases the lock when the process dies, including `SIGKILL`; no stale-lock file is deleted or stolen. Other platforms fail closed. This uses [Node's documented abstract socket behavior](https://nodejs.org/download/release/v24.1.0/docs/api/net.html#ipc-support).

For filter safety, the exporter rejects `.gitattributes` files, including ignored/untracked or nested files, and nonempty Git `info/attributes`. Global/system attributes, Git hooks, fsmonitor and commit signing are disabled. It stages exact bytes without clean filters. Use a checkout without these attribute files; rejection preserves existing work.

Each invocation fetches at most 100 pages of 100 records per kind, including previously exported records. Exact comparisons reconcile manual Git edits with D1 authority. An overwrite emits an event containing the kind and ID. Identical snapshots do not create another commit. Limits or failures produce a nonzero exit and retain pending work; schedule another invocation only after addressing the reported operational condition. The command does not run a background daemon.

## Interruption and conflict recovery

Before writing, the exporter persists a private journal under the common Git directory at `kith-reading-export/journal.json`. The next invocation recovers that snapshot before reading new pages. Recovery checks the actual remote ref and file bytes before ACK. A lost ACK response can be replayed; stale note revisions cannot ACK newer edits. Neither a local file nor a successful local commit alone establishes remote persistence.

After an interruption, run the same command with the same checkout, branch, endpoint and remote. Preserve the journal. A changed binding, unrelated dirty file, unexpected local commit, symlink or diverged branch causes a refusal rather than an automatic reset, force push or discard.

For a push conflict, inspect the local pending snapshot commit and the remote history. Resolve the histories in a separate checkout while preserving the snapshot commit and its exact exported files, then push the resolved merge normally. Rerun the exporter: it can confirm that the remote includes that snapshot, ACK it and advance the dedicated checkout. If the desired resolution changes those snapshot files, stop and reconcile with the D1 authority before proceeding; do not delete the journal to bypass confirmation. There is deliberately no automatic conflict resolution or journal-discard command.

## Local evidence

```sh
node --test reading/reading.test.ts
```

Repository development jobs must invoke that command through the shared workspace launcher. Tests create synthetic bare Git remotes under `AGENT_BUILD_DIR`, use synthetic HTTP responses, kill only their own child processes, and never contact a live provider. The broader D1/browser evidence belongs to the parent milestone verification. This local suite does not demonstrate live repository access or publication.
