# Bounded M6 Docker integration test

This explicitly authorized test-environment continuation runs the production hub with generated release/inspection sources and a real Alertmanager container. Every generated source event identifies itself as a synthetic Docker test; native freshness events retain their shape and are traceable to those synthetic sources. It does not satisfy the original four live M6 gates, seven-day production observation, phone receipt, independent-host outage notification, yesterday's real snapshot or OneFleet production admission.

## Design before execution

The normal hub CLI permits only explicit loopback or actual tailnet listener addresses. Use a private Docker bridge with the hub listening on loopback and producer/Alertmanager fixture containers sharing its network namespace. No host networking or published hub port. A separate test-only HTTPS receiver publishes exclusively on an existing real tailnet address; configure the exact full URL allowlist and a certificate hostname resolving to that address. A generated CA is trusted only by the test hub container. Use a distinct ordinary receiver bridge when same-bridge hairpin traffic cannot reach the host-published tailnet endpoint; no host firewall change is needed. Include strict CA keyCertSign/cRLSign and leaf keyUsage/serverAuth/SAN extensions. Never assign Docker a fake tailnet subnet, disable TLS verification or expose the Go-only local test sender through the CLI.

The receiver verifies HMAC, timestamp freshness and durable delivery-ID/body deduplication before success. A test-only Alertmanager relay records original bytes and every adapter result because HTTP200 can contain member409. Release/inspection fixtures save immutable events before sending and retain original identity/time across bounded retry and restart. They are fixtures, not a new production controller or channel.

Bark requires a device key and a different request schema from the signed CloudEvent webhook. Run its pinned open-source server on an internal Docker network without internet access, device tokens or published ports. Verify health, malformed request handling and missing-device-key rejection. Server readiness is not hub-to-phone delivery; never send fabricated device registrations to APNs. No production Bark adapter is added.

## Admission and acceptance

Before mutation confirm authorized host, disk, existing workloads, ownership and unique names. Pin image digests, binary/config hashes, nonroot UID/GID, read-only config/credential mounts and separate owned data. Drop capabilities, enable no-new-privileges/default seccomp/AppArmor, read-only rootfs and bounded tmpfs/CPU/memory/pids/logs; no restart policy. No privileged container, Docker socket, host HOME, public ingress or existing service changes. Private identifiers/credentials/operations stay outside this public repository.

| Scenario | Required evidence |
| --- | --- |
| Three sources | Immutable release and periodic inspection receipts; real Alertmanager firing/resolved and per-member results |
| Identity/scope |202 new,200 duplicate original seq, changed-content409, cross-source403; original event unchanged |
| Signed HTTPS | Production sender reaches authentic tailnet address; current HMAC verified and IDs persisted |
| Silence/recovery | Stop only owned inspection; real elapsed time exceeds twice interval; silent then recovered |
| Restart | Owned hub stop/restart; seq/raw events and subscriptions survive; namespace clients rechecked |
| Restore | This-run snapshot/manifest; original hashes unchanged; fresh target; outbound blocked and isolated credentials before startup; seq/query/integrity/queue comparison |
| Bark | Pinned real server, isolated network, health and negative API responses; no APNs/device/phone claim |
| Preservation | Exact commands/results/failures, independent review, checksums and owned-resource cleanup |

Only explicit owned container names/labels may be stopped/removed. Preserve failed DB/logs/snapshots first; never broadly prune or overwrite restore targets. A query-only restored hub with blocked outbound traffic does not establish resumed delivery.

## Verification scope

New fixture behavior uses Python standard-library tests and actual containers. Existing native and Chromium evidence remains applicable to unchanged runtime bytes; repository-required CI still runs for the final change. From the component: `python3 -m unittest discover -s deployment/docker-test -p 'test_*.py' -v`, fixture CLI help and `git diff --check`. Execution results belong in STATUS and the scoped acceptance report, separately from this design.

## Resolver boundary repair discovered during execution

Actual production delivery exposed Go LookupNetIP returning IPv4 as IPv4-mapped IPv6, which the existing canonical address policy rejects. Normalize only production resolver output to its canonical IPv4 representation before checking every answer. Keep mapped literal URL rejection, both tailnet CIDRs, mixed-answer rejection, per-dial resolution, literal-IP pinning and TLS verification unchanged. Regression coverage must exercise the actual Go resolver boundary, then repeat real signed HTTPS delivery with the repaired binary. Original failed attempts remain evidence.
