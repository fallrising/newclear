# Offline private deployment bundle

`tools/prepare_deployment.py` uses Python 3.11 standard library only. It prepares files locally; it does not contact Cloudflare, install a toolchain, provision a database, deploy, attach a hostname or enable scheduling. Remaining live gates and current target evidence are tracked in [deployment.md](deployment.md); this offline tool does not determine plan eligibility or costs.

From the repository source directory:

```sh
python3 platform/cloud-lab/tools/prepare_deployment.py \
  --profile /private/operator/profile.json --output /private/operator/new-bundle
```

The profile must be an owner-owned regular file with exactly mode `0600`, one hard link and no symlink ancestors. The output must not exist; its existing parent must be owner-owned and not writable by group/others. All path components must be real directories; `..`, symlinks, missing parents and existing output are rejected. The created directory and subdirectories use `0700`; every file uses `0600`, regardless of umask. Failures preserve existing files. A write failure may leave an incomplete new private directory for inspection; it must not be reused or treated as a complete bundle. Successful creation prints only a fixed message. Errors never print profile values, paths or exception tracebacks.

The generator rejects profile/output paths below any ancestor `.git` file or directory before generating credentials. Keep the profile and entire bundle outside Git, public evidence and disposable build/cache directories. They contain credentials, operator scope and target configuration. Tests use only synthetic fixtures in launcher-managed temporary storage.

## Exact profile schema

Required fields are shown below; all values are synthetic. No additional fields are accepted, except the optional paired `cloudflare_access_client_id` and `cloudflare_access_client_secret`. Duplicate keys, invalid UTF-8 (including escaped unpaired surrogates), floats, non-finite numbers and profiles above 32768 bytes are rejected.

```json
{
  "schema_version": "cloudlab.deployment.v1",
  "account_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "zone_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "database_id": "12345678-1234-4234-8234-123456789abc",
  "domain": "lab.example.invalid",
  "worker_name": "cloud-lab-qualification",
  "access_issuer": "https://synthetic.cloudflareaccess.com",
  "access_audience": "synthetic-access-audience",
  "human_subject": "synthetic-verified-subject",
  "workspace_id": "synthetic-workspace",
  "resource_id": "synthetic-node",
  "resource_generation": 1,
  "not_before": "2026-10-27T00:00:00Z",
  "expires_at": "2026-10-28T00:00:00Z"
}
```

Account/zone IDs must be 32 lowercase hexadecimal characters; the database ID must be a canonical lowercase UUID. `domain` is a lowercase ASCII hostname with at least two labels, no trailing dot, scheme, path, port or IP literal. Worker name is exactly `cloud-lab` or `cloud-lab-qualification`. Access issuer is exactly an HTTPS team hostname below `cloudflareaccess.com`. Workspace/resource IDs use 1–128 ASCII letters, numbers, underscores or hyphens; generation is a positive integer at most 2147483647. Access audience and human subject are 1–1024 printable ASCII characters without whitespace. Times are canonical UTC seconds; the interval must be positive and at most 24 hours. Preparation does not assert that the interval covers the current time. Optional Access service credentials must both be present, each 1–1024 printable ASCII characters without whitespace.

## Contents and configuration contract

- `apps/control/worker/*.mjs`, `apps/control/public/*`, `apps/control/migrations/0001.sql`, `recipes/node-health.json` and `adapters/node-health/runner.py` copy the explicitly listed current source files byte for byte, without modifying runtime code.
- `wrangler.json` points to those copies and includes the selected account/database, origin and a generated deployment audience. It disables workers.dev and preview URLs, runs the Worker before assets, and contains no routes or Cron triggers. Zone selection remains an explicit review gate; no zone mutation is inferred from the profile.
- `worker-secrets.json` is a Wrangler secret-import object with string values `MACHINE_KEYS` and `ACCESS_CONFIG`, each containing serialized JSON. Only runner/bot have machine keys. The verified Access JWT subject maps to a distinct human principal/grant; it is never a machine identity or public variable.
- `runner.json` and `bot.json` each contain `base_url`, `audience`, `credential_id`, `generation`, `secret_hex`, `journal_path`, `workspace_id`, `resource_ref` and `recipe_ref`. They are accepted by the runner's `Config.from_dict`. Their independent 32-byte HMAC keys bind distinct principals/grants. Optional paired Access credentials appear in these two private configs only; they remain separate from HMAC. Bot tools can use their own parser and ignore `journal_path`; they must not invoke the runner with bot permissions. Runner journal state is durable and relative to its config directory, never temporary cache.
- `grant-seed.sql` inserts four distinct principals/grants (human, bot, runner, scheduler), pins the exact workspace/resource generation/recipe digest and time window, and bounds timeout/output to 10 seconds/16384 bytes. Human/bot can submit/read/cancel-request/read artifacts; runner can only claim/report/reconcile; scheduler can only submit/read node health. There are no wildcards. `health-minute` is inserted disabled. The SQL contains no explicit transaction control, for D1 import compatibility. Use a qualified D1 managed import/batch transaction for the complete seed, never individual statement execution; qualify atomic rollback before provisioning. Inserts deliberately fail on replay and must only target an approved new isolated database after the copied migration.
- `manifest.json` records the Git baseline source revision, SHA-256 of every other file, and the recipe reference computed from actual copied recipe bytes. It excludes itself explicitly. Working source bytes are authoritative through the hashes; a Git revision alone does not prove a clean source tree. Hashes provide integrity comparison, not a signature or deployment acceptance.
- `plan.md` orders target/budget approval, toolchain/D1 qualification, Access policy, secret/seed review, deployment and ingress approval, runner state, fault qualification and separate scheduling approval. Remote actions are manual gates, never generator behavior.

The Python API is `prepare_deployment(profile_path, output_path, *, source_root=None)`, returning the manifest. `source_root` defaults to the Cloud Lab component directory and is intended for controlled verification. `PreparationError` carries a fixed safe diagnostic. Importing the module performs no I/O or network calls.

## Verification

```sh
python3 /path/to/agent-workspace/workspace.py run cloud-lab T-bundle-tests -- \
  python3 -m unittest discover -s platform/cloud-lab/tests -p test_prepare_deployment.py -v
```

Tests verify strict failures before output, safe filesystem boundaries and exclusivity, exact source bytes and hashes, secret isolation, runner-compatible configuration, and grant SQL execution with SQLite foreign keys. The launcher may live inside a checkout; tests hide only `.git` metadata above each synthetic fixture root, while retaining descriptor traversal and rejecting nested synthetic `.git` files/directories/symlinks. Production has no such exception. They do not establish real D1/Access/Workers behavior, target ownership, ingress protection, selected-runner health or live recovery.
