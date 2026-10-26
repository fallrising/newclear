# Python node health runner

This `cloudlab.m1` executor uses Python 3.11+ standard library only. Its fixed non-root collector observes one-minute load via `os.getloadavg()`, CPU count via `os.cpu_count()`, and free blocks on `/` via `os.statvfs('/')`. `healthy` means this sample passes the fixed thresholds below; it does not establish service health. There is no shell, arbitrary file reader, probe target, service management, inbound listener or third-party dependency.

Run under a dedicated non-root OS user, with an operator-owned persistent directory and a private configuration file (`chmod 600 runner.json`):

```sh
python3 platform/cloud-lab/adapters/node-health/runner.py --config /private/cloud-lab/runner.json --once
```

Omit `--once` for outbound polling. Each cycle makes one claim and at most one report, with at least five seconds between cycles and a five-second network timeout. HTTPS uses Python's default certificate verification. Redirects and ambient HTTP proxies are disabled. `--allow-loopback-http` permits only numeric loopback addresses for explicit local tests; other HTTP URLs are rejected.

Configuration fields (all required; this is a synthetic example):

```json
{
  "base_url": "https://lab.example",
  "audience": "cloud-lab",
  "credential_id": "runner-1",
  "generation": 1,
  "secret_hex": "REPLACE_WITH_PRIVATE_HEX_SECRET_OF_AT_LEAST_32_BYTES",
  "journal_path": "journal.sqlite",
  "workspace_id": "lab",
  "resource_ref": {"resource_id": "node-1", "generation": 1},
  "recipe_ref": {
    "recipe_id": "node-health",
    "version": "1.0.0",
    "digest": "sha256:REPLACE_WITH_APPROVED_RECIPE_DIGEST"
  }
}
```

Optionally add both `cloudflare_access_client_id` and `cloudflare_access_client_secret` to the private configuration for an Access service token. Either provide both nonempty header-safe ASCII values or omit both. They are emitted as `CF-Access-Client-Id` / `CF-Access-Client-Secret` HTTP headers separately from the HMAC body/signature context. They are never stored in the execution journal or printed in CLI diagnostics. Access and Lab HMAC credentials serve separate checks.

Provision a separate random secret per principal through the operator's private credential channel; use the same raw bytes (hex encoded here), audience, credential ID and generation as the server. Never commit the resulting configuration or send it to logs. Pin the exact approved workspace/resource/recipe object from bootstrap. The example placeholders intentionally fail validation. A relative journal path resolves beside the configuration file. Ensure the journal's parent directory exists and is private to the runner user.

A collected artifact contains required `metrics` with integer `load_1m_milli` (floor of load × 1000), positive `cpu_count`, and `disk_free_percent` (floor of available blocks × 100 / total blocks). `status` is `healthy` exactly when load is at most CPU count × 2000 and free disk is at least 10%; otherwise it is `unhealthy`. `checks.collector` is `ok` for either observed result, and `sample_age_seconds` is zero. Unsupported OS operations, missing observations or collector errors produce `unknown`, without invented metrics. Freshness parameters accept integers from 1 to 60 seconds.

Dispatch must begin before its dispatch deadline with at least the configured timeout remaining before the execution deadline; the runner rechecks this after the started commit. Finish timestamps must be ordered and fit both the execution deadline and timeout. Reconcile-only can return prior evidence after the command deadlines.

SQLite commits a `started` marker with the immutable command digest and external reference before collection, then commits result bytes before reporting. A lost report can be retried without collecting again. A restart encountering `started`, or a reconcile-only command without evidence, reports `unknown`. Reconcile-only never collects. Completed evidence survives subsequent attempts, including new fences. No automatic journal pruning occurs; retain the database and any SQLite journal/WAL files as durable state when backing up or restoring. Deleting the journal loses deduplication evidence and requires operator reconciliation before restarting.

The importable API is `Config.from_dict(value, allow_loopback_http=False)`, `Journal(path)`, `HttpClient(config)`, and `Runner(config, journal, client=None, collector=None, clock=None).run_once()`. Collector/client injection is a test seam; CLI configuration cannot select them. CLI diagnostics omit secrets, request bodies and control-plane URLs. This implementation and its local tests do not establish Cloudflare/Access/D1 live acceptance.
