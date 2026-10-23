# Private operator inventory

Runtime identities come from an explicit private JSON array. No environment variable
or compiled alias list selects hosts. Keep the file and rendered plans in ignored
`private/`; never commit real aliases, addresses, credentials or host keys.

A neutral example (replace these documentation values privately):

```json
[
  {"alias": "lab-host-01", "node": "worker-1", "role": "core", "ip": "192.0.2.1"},
  {"alias": "lab-host-02", "node": "worker-2", "role": "worker", "ip": "192.0.2.2"},
  {"alias": "lab-host-03", "node": "worker-3", "role": "worker", "ip": "192.0.2.3"},
  {"alias": "lab-host-04", "node": "worker-4", "role": "worker", "ip": "192.0.2.4"}
]
```

Exactly four rows in this logical order are required. Aliases must be unique,
1–128 characters, start with an ASCII letter or digit, and contain only ASCII
letters, digits, `.`, `_` or `-`. IPv4 endpoints must be canonical and distinct.
Logical node IDs and roles remain fixed; changing an alias does not rename an ERU
node. Missing, duplicate, unsafe or mismatched configuration stops before host
operations. Existing rendered deployment-plan fields may coexist with these fields.

`labctl` and project-based helpers capture `private/deployment-plan.json` from the
selected project. Initial deployment requires an explicit source inventory file
inside that project's `private/` directory:

```sh
# Local plan rendering only; existing trusted preflight and key inputs are required.
python3 scripts/deploy-lab.py --inventory private/operator-inventory.json
```

The existing `--apply` flag still requests remote changes and requires the existing
operator authorization. This task did not run it. Rendering writes
`private/deployment-plan.json`; a same-version smoke reapply passes that explicit
path and rejects an inventory change since the smoke run captured it.

Offline worker planners now require the project whose private inventory is bound
to the plan, in addition to their existing input/target/plan-ID arguments:

```sh
python3 scripts/worker_drain.py --project /path/to/project --help
python3 scripts/worker_loss.py --project /path/to/project --help
```

These `--help` examples perform no host operations. The planners remain review-only.
Python callers pass the already captured inventory explicitly to planners,
executors, payload builders and canary placement helpers.

Keep existing SSH principals, SSH configuration, verified public-key manifests
and trusted key-directory conventions. Key manifests must use the configured
aliases, and copied-source transports check the exact four-host keyset against
the bound plan. This change does not enroll hosts or relax host-key verification.
Preflight/trust filenames retain the existing optional `ckc-` prefix normalization.
The SSH destination remains the exact configured alias; only local evidence/trust
filenames remove that prefix for compatibility with existing controller material.
Aliases whose normalized evidence filenames collide are rejected. The preflight
producer and deploy/controller-preflight consumers share this filename function.

```sh
python3 scripts/preflight.py --inventory private/operator-inventory.json --output-dir private/preflight
```

`check-binaries.py` also requires `--inventory` and accepts only configured
`--host` values; its version-check execution still requires operator authority.

Preflight performs read-only host collection and needs the usual operator authority;
it was exercised only through a mocked collector in this task. `--host` may select
only distinct aliases from that inventory.

After any inventory change, recapture current evidence and generate/review a new
plan. Do not edit aliases in signed/hash-bound plans or journals: inventory, source,
cluster generation, exact targets and destructive authorization checks still apply.
All validation for this maintenance task used synthetic fixtures; live acceptance
and the component's pending mainline gates are unchanged.
