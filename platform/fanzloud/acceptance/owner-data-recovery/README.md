# Owner-data recovery diagnostics

[Snapshot contract](../../docs/specs/SPEC-M3-data-probe.md) and
[isolated-copy contract](../../docs/specs/SPEC-M3-copy-validation.md) are normative.
These helpers do not start the original installation or establish FN07 acceptance.

The stdlib verifier only nominates a physical candidate:

```sh
python3 verify_snapshot.py ARCHIVE --sha256 DIGEST
python3 -m unittest discover -s . -v
```

`copy_validation.py` defaults to preparation only. It creates a new private packet;
there is no resume/overwrite path. A failed or ambiguous run requires inspection,
not an automatic retry. Inputs are explicit protected/quiescent files. SQLite must
have no nonempty WAL. Keep the packet socket path at most85bytes, and use a private
operator-owned location. No input path or raw data belongs in a public receipt.

```sh
python3 copy_validation.py --archive ARCHIVE --sha256 DIGEST \
  --sqlite SQLITE --packet NEW_PRIVATE_PACKET
```

After the concrete private-copy execution decision is authorized, the same invocation
may add `--execute --database DBNAME --user EXISTING_DB_ROLE` using the existing AP
Python environment. It prepares a fresh packet then launches the fixed local image;
`--execute` records the operator invocation, not evidence of owner approval by itself.
No password is needed: only the disposable0700 socket uses local trust. The existing
original roles/credentials/config files remain untouched. The Docker endpoint is the
explicit local Unix socket, with pull-never and no remote context. Requirements: Linux
amd64, nonroot user, Docker, PostgreSQL18.6 image at the spec's digest and existing AP
Python dependencies. AP schema/quiescence validation is reused from this checkout.

A successful result is `logical_candidate_verified`, with original_runtime_ready and
fn07_accepted both false. `not_ready` preserves failed checks; `outcome_unknown` means
cleanup was not confirmed and forbids automatic retry. Private intent/created/started/
inspection/outcome and bounded server diagnostics are stored in the packet. A missing
optional log is reported, not interpreted as a successful database check. Stage/source
files remain for diagnosis; only the exact stopped owned container is removed. Its
bounded runtime tmpfs disappears, and no original volume is mounted or removed.

The synthetic integration harness accepts no database/source arguments and only builds
fresh fixture data under `/tmp`. It uses published run IDs with artificial payloads,
patches expected archive hashes only inside the test, and never reads the private
candidate. This is a deliberate manual Docker test, separate from stdlib CI:

```sh
COPY_SMOKE_RECEIPT=/private/new-receipt.json AP_PYTHON smoke_copy.py
```

Replace `AP_PYTHON` with the existing AP environment's Python executable. The receipt
path must not exist. Allow about three minutes for setup and the real120-second
independent deadline. Fixture construction alone writes its new synthetic seed and
runs migrations; the production copy probe never does either. No live providers or
workers are involved. Retain failures and cleanup evidence; do not present this smoke
as a private-data restore or original-service compatibility result.
