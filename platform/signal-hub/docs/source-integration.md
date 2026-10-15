# Three-source integration preparation

These synthetic captures prepare source admission. They do not enroll a producer, start a deployment, contact a notification account or establish seven-day operation. The [M6 design](m6-design.md) owns acceptance; [runtime](runtime.md) and existing contracts own API behavior.

| Configured name | Source prefix | Allowed types | Example payload |
| --- | --- | --- | --- |
| release | `urn:example:release:` | `release.deploy.*` | [release.json](../examples/sources/release.json) |
| inspection | `urn:example:inspection:` | `inspection.check.*` | [inspection.json](../examples/sources/inspection.json) |
| alertmanager | `urn:signalhub:alertmanager:example:` | `alertmanager.alert.*` | [firing](../examples/sources/alertmanager-firing.json), [resolved](../examples/sources/alertmanager-resolved.json) |

[config.json](../examples/sources/config.json) uses separate synthetic absolute credential references. Never put credential bytes in captures or this public repository. Private reviewed substitutions must retain independent producer credentials and intended URI/type scopes. Owner and readonly credentials cannot ingest. URI prefixes are lexical authorization scopes; choose delimiters deliberately. The checker does not open credential references and cannot establish file permissions, actual bearer validity or duplicate credential contents.

## Save first, retry the saved envelope

A release creates an envelope for each pipeline run, attempt and outcome. `release.deploy.started`, `release.deploy.succeeded` and `release.deploy.failed` are separate outcomes with separate IDs. An inspection emits one result for each completed scheduled run, using `inspection.check.passed` or `inspection.check.failed`. Persist the immutable envelope before sending it. Keep original ID, event time and all content on retries; do not regenerate a timestamp or append changing progress to a saved outcome.

| Observed result | Producer handling |
| --- | --- |
| 202 with seq | Persist receipt and original seq after acceptance. |
| Single-event 200 | Require `duplicate: true` and original seq; no new timeline row was created. |
| Adapter 200 | Examine every `results[index]`: accepted202 or duplicate200, positive seq, and no error. Request200 alone is insufficient. |
| Transport failure/timeout, transient429/503 | Retain payload and retry with bounded backoff. A timeout can happen after commit; identical retry resolves ambiguity. |
| 400/401/403/413/409 | Stop and investigate shape, credential/scope, size or immutable-content conflict. Preserve evidence. Do not mint IDs to hide409. |

Valid batches commit members independently. A valid sibling can be accepted while another member fails400,403,409 or503. There is no batch rollback or promise that Alertmanager retries rejected members inside request200.

## Alertmanager compatibility gate

Receiver `example:primary` maps to `urn:signalhub:alertmanager:example:primary`. Identity remains `<fingerprint>:<startsAt>:<status>`. Firing uses startsAt as event time; resolved uses endsAt and a distinct status ID. Full labels, annotations, groupKey and generatorURL are retained. Changing them while identity remains equal causes409. Changes to firing endsAt alone are ignored by the current mapping; resolved endsAt changes event time and can conflict. Optional common/group envelope fields do not replace per-alert labels or annotations.

Capture realistic repeats before enrollment. Dynamic annotation values such as a changing measured number can violate immutability even when fingerprint is stable. Review an episode policy that freezes retained content, or block source acceptance until a separately approved contract decision exists. This package neither rewrites the mapping nor repairs payloads. Permanent identity survives archive purge, so retention does not resolve drift.

The example below was checked against the official [Alertmanager v0.28.1 configuration](https://github.com/prometheus/alertmanager/blob/v0.28.1/docs/configuration.md#webhook_config). It is a preparation template with a deliberately non-resolving endpoint. Pin and validate the actual operator version before using a private substitute; no Alertmanager binary is installed or run by this package.

```yaml
route:
  receiver: 'example:primary'
  group_by: [alertname, instance]
receivers:
  - name: 'example:primary'
    webhook_configs:
      - url: 'https://signalhub.example.invalid/v1/adapters/alertmanager'
        send_resolved: true
        max_alerts: 100
        timeout: 10s
        http_config:
          authorization:
            type: Bearer
            credentials_file: /run/secrets/signalhub-example/alertmanager.token
          follow_redirects: false
```

The documented limit can truncate excess alerts, recorded in `truncatedAlerts`; it does not queue an overflow page. Treat truncation as an admission failure requiring reviewed grouping/volume policy. The [v0.28.1 notifier source](https://github.com/prometheus/alertmanager/blob/v0.28.1/notify/webhook/webhook.go) classifies the HTTP status through its retrier; it does not decode Signal Hub's results array. Consequently a member409 under outer200 is not a promised automatic retry. Real acceptance requires observable per-member receipts/errors and compatible content, without changing upstream or hub behavior silently.

## Offline captures and receipts

Use the existing pinned contract environment, from the component root:

```sh
python scripts/test_check_sources.py
python scripts/check_sources.py
python scripts/check_sources.py /path/to/private/captures
```

Every directory requires `config.json`, `release.json`, `inspection.json`, `alertmanager-firing.json` and `alertmanager-resolved.json`. Additional JSON files use `release-*.json`, `inspection-*.json` or `alertmanager-*.json` for repeated captures. Filename family states which configured producer credential would be used; payload URI alone cannot establish attribution. Unknown JSON filenames fail instead of being silently ignored. Files are compared in sorted filename order; the tool establishes equality/conflict, not chronological order or a baseline database state.

Optional receipt files use the same family and end in `.response.json`, for example `alertmanager-firing.response.json`:

```json
{
  "http_status": 200,
  "body": {
    "results": [
      {"index": 0, "status": 202, "seq": 1},
      {"index": 1, "status": 200, "seq": 2, "duplicate": true}
    ]
  }
}
```

Single-event receipts use `{"http_status":202,"body":{"seq":1}}` or an explicit duplicate200. Receipt captures are optional evidence checks; the checker does not correlate them to runtime seq values or prove actual transport. Record raw request/response pairing separately in private acceptance evidence. Every failed member remains an error even under outer200. Empty result arrays produce a liveness warning.

The tool reuses `contracts/check.py` strict JSON parsing, JCS and schema checks, plus existing OpenAPI Alertmanager schemas. At file admission it also rejects unpaired Unicode surrogates in every string and object key, including envelope fields unused by mapping; valid escaped surrogate pairs remain accepted. Whole-document JCS validation rejects unsafe integer literals and nonfinite numbers even in unused envelope fields; valid large finite floats remain accepted. It checks narrow retained input fields for Alertmanager identity drift; it does not emit mapped events or implement a second full mapper. The Go adapter remains authoritative, cross-checked by isolated HTTP tests. Duplicate keys, unsupported shapes, oversized payloads/data, cross-source authorization and retained-content drift fail explicitly without printing payload values. Same-reference credential collisions are rejected without reading files. Runtime auth, host ACL, real credentials and networks remain separate gates.

## Cadence and pending acceptance

Freshness belongs to the authenticated configured source name and successful receipt time. Identical authorized duplicates refresh it, while conflict/invalid/forbidden requests do not. A duplicate proves receipt of old content, not a new release or inspection. Empty Alertmanager alerts create no attributed delivery and cannot refresh freshness. The tool warns on empty batches; the existing OpenAPI description calling them a heartbeat is not evidence of runtime freshness.

Inspection's synthetic expected interval is1h. Release and Alertmanager omit it because they may be naturally quiet: age checks are disabled, but an unseen source remains never. Before live enrollment define an approved genuine reporting cadence or an independent heartbeat/watchdog policy, with allowed types and expected interval reviewed together. Silence starts strictly after twice the interval, not at the exact boundary. Do not fabricate events or treat repeated payloads as seven days of new activity.

Live acceptance stays pending: all three actual sources observed continuously for seven days with gap/new-event/duplicate records and no unexpected409; an authorized real producer outage produces silent plus phone receipt; an authorized hub outage reaches an independent notifier within five minutes; and yesterday's real snapshot restores in an approved isolated environment. Offline captures and synthetic service tests satisfy preparation only.
