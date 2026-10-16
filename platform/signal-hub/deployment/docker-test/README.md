# Synthetic Docker integration fixtures

This Python 3.11+ standard-library tool supplies completed synthetic release and
inspection runs, a durable signed HTTPS receiver, and an observable Alertmanager
relay. The goal is repeatable Docker integration evidence using existing runtime
contracts. It does not enroll production sources or establish full M6 acceptance,
seven-day operation, phone delivery, or OneFleet admission. Bark server probes
belong to the external test runner; this tool adds no Bark channel or APNs client.

## CLI and deployment boundary

Run each command as a non-root user inside an explicitly authorized test container.
Use read-only code/credential mounts and separate writable state mounts. The hub
remains bound to loopback in a shared test network namespace. Only the HTTPS
receiver may be published on an approved real tailnet address with a trusted test
CA and an exact hub URL allowlist entry. Ordinary Docker bridge addresses do not
become tailnet addresses. No public ingress or runtime address-policy exception is
provided. HTTP producer/relay traffic stays within the isolated test namespace.
Never pass credential values on the command line; files are private mounted refs.

```sh
python3 fixture.py producer --kind release \
  --url http://127.0.0.1:18080/v1/events \
  --token-file /run/secrets/release.token --state-dir /state/release \
  --interval 2 --count 1
python3 fixture.py producer --kind inspection \
  --url http://127.0.0.1:18080/v1/events \
  --token-file /run/secrets/inspection.token --state-dir /state/inspection \
  --interval 2 --count 0
python3 fixture.py receiver --listen 0.0.0.0:8443 \
  --cert-file /run/tls/receiver.crt --key-file /run/tls/receiver.key \
  --secret-file /run/secrets/webhook.secret --db /state/receiver.sqlite
python3 fixture.py alert-relay --listen 127.0.0.1:18081 \
  --hub-url http://127.0.0.1:18080 --token-file /run/secrets/alertmanager.token \
  --capture-dir /state/relay
```

The producer URL is the complete ingest endpoint; relay hub-url is a base URL.
The relay accepts POST `/webhook` and appends `/v1/adapters/alertmanager` upstream.
Receiver accepts POST `/webhook`. Both servers expose only GET `/healthz` for
health, with no record-dump endpoint. Requests have a 4 MiB bound and 10-second
socket deadline. Redirects are rejected without forwarding credentials.

## Persistence and failure semantics

Producer `state-dir/producer.sqlite` contains `runs` with monotonic `run_index`,
`kind`, immutable `body`, and eventual `receipt_status`/`receipt_body`; `attempts`
contains every observed status/response (transport failures use status 0).
A process lock prevents two producers sharing a state directory. Each new
completed run is committed before send, with current UTC event time, unique ID,
source `urn:example:<kind>:docker`, type `release.deploy.succeeded` or
`inspection.check.passed`, and explicit synthetic Docker test summary/data.
Pending runs resume first with identical bytes/ID/time. `--count` counts only new
runs; 0 continues until stopped. One state directory belongs to one kind.
Receipt 202 needs a positive integer seq; 200 also needs `duplicate: true`.
Transport errors, 429 and 503 retry at most three attempts per invocation with
bounded backoff. Other statuses or invalid receipts stop nonzero and retain
pending data. Restart deliberately retries pending data; it never replaces IDs.

Receiver `deliveries` stores `delivery_id`, raw `body`, `body_sha256`, and UTC
`received_at` in SQLite with FULL synchronous commits before 202. Header format,
300-second timestamp tolerance and constant-time HMAC validation precede dedup.
Secret bytes are used unchanged. A valid same-ID/body retry returns 200 duplicate;
a valid same-ID/different-body request returns 409. Invalid/stale signatures stay
401 even for accepted IDs. Structured CloudEvent JSON is required. The receiver
is a bounded test sink, not a general CloudEvents schema validator.

Relay `capture-dir/relay.sqlite` stores unique `seq`, original `request`, raw
`response`, upstream `hub_status`, outgoing `status`, diagnostic, and timestamp.
Requests are committed before forwarding and responses before replying. An
interrupted request remains visible with null result. Bytes are forwarded
unchanged with a file-loaded bearer credential. Upstream HTTP 200 is successful
only when every expected batch member has its matching index, status 202 or
explicit duplicate 200, positive seq, and no error. Empty/truncated batches fail.
Member errors produce 502 with a fixed diagnostic; the original response remains
in the private capture DB. No automatic relay retry or content rewriting occurs.
Secrets, request bodies and upstream diagnostics are never printed to logs.
Inspect SQLite from the private test runner; never expose captures publicly.

## Acceptance and verification

Tests must establish immutable retry/restart, current completed-run source
markers, receipt rejection, per-member adapter failure, signature-before-dedup,
durable duplicate/conflict behavior, bounded request reads and HTTP wiring.
Production safety and actual Docker/HTTPS execution remain runner-owned gates.
From repository root:

```sh
python3 -m unittest discover -s platform/signal-hub/deployment/docker-test -p 'test_*.py' -v
python3 platform/signal-hub/deployment/docker-test/fixture.py --help
git diff --check
```
