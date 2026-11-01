# Bootstrap (Phase 1)

The [SDD](SDD.md) is the source of truth. This page is the operator checklist.

## Cloudflare (once)

1. Zone in the account; API token with Tunnel Write, DNS Write, Access Apps/Policies Write, Access IdP Write.
2. Enable Zero Trust. One-time PIN IdP can be created by `fleetd` in the background (`EnsureOTPProvider`).
3. Create a **manual bootstrap tunnel** named `fleet-control`. Record UUID as `FLEET_BOOTSTRAP_TUNNEL_ID`.
4. PUT ingress for `FLEET_UI_HOSTNAME` and `FLEET_API_HOSTNAME` → `http://127.0.0.1:18765`. CNAME both.
5. Access app for **only** `FLEET_UI_HOSTNAME`. The API host has no Access (agents and GHA cannot complete OTP).

`fleetd` **never PUTs** `FLEET_BOOTSTRAP_TUNNEL_ID` and never stores it as `nodes.tunnel_id`.

## Control-plane VPS

```bash
cp deploy/fleet-control/.env.example deploy/fleet-control/.env
# fill FLEET_* / CF_* (no CF_BASE_DOMAIN alias)
docker compose -p fleet-control -f deploy/fleet-control/docker-compose.yml up -d
curl -sS https://<FLEET_API_HOSTNAME>/healthz
```

Unset `FLEETD_BOOTSTRAP_OPERATOR_TOKEN` from compose env after first boot (the hash is already in SQLite). `fleetd` logs `bootstrap_operator_token_ignored` if it stays set.

`fleetd` is **not** a catalog row.

## First agent

On a workload VPS (or optionally the CP VPS under a **different** node id):

```bash
cp deploy/fleet-agent/.env.example deploy/fleet-agent/.env
# FLEET_URL=https://<FLEET_API_HOSTNAME>
# FLEET_NODE_ID=vps-hel-1
# FLEET_BOOTSTRAP_TOKEN=flt_bs_...
docker compose -p fleet-agent -f deploy/fleet-agent/docker-compose.yml up -d fleet-agent
```

Do **not** pass `--profile tunnel`. The agent registers, writes `/var/lib/fleet/cloudflared.env` (`0600` root), then `UpSidecar` recreates only service `cloudflared` of project `fleet-agent` from the baked `/usr/local/share/fleet/agent-stack.yml`.

Two `cloudflared` processes on the control-plane VPS (if it also hosts workloads): bootstrap (`fleet-control`) + node (`fleet-agent`). Distinct tokens/tunnels.

## First workload

Copy `contrib/github-actions/deploy.yml` into the workload repo (hello-healthz already has it). Set `FLEET_URL` and `FLEET_CI_TOKEN`. Push `main`. Catalog stores the SHA tag, not `:latest`.

## Access web login (current operating path)

Set `CF_ACCESS_ALLOWED_EMAILS` to the explicit allowed email addresses. Empty configuration fails reconciliation; it never creates an allow-everyone policy. Enable the One-time PIN identity provider in Zero Trust. Use `expose.mode: access`; all shipped workload examples use this mode. `public` remains supported but is currently unused.

Fleet creates/verifies the Access application and its managed email policy before publishing the workload's ingress rule and DNS. Existing managed policies are updated to the configured allowlist; unmanaged policies require operator review. The normal user flow is browser → HTTPS service URL → email address → one-time PIN from email → application.

Verify in a fresh browser session that unauthenticated requests cannot reach the origin. Complete login using an allowed email and verify the service. Also check a non-allowlisted identity is denied. Keep sanitized timestamps, hostname aliases, expected denial and authorized success in the acceptance record.

The Fleet UI hostname has Access; the machine API hostname continues using Fleet bearer tokens because agents and CI cannot complete an interactive browser login. Existing Fleet operator-token authentication for the control panel remains in place.

## Database upgrade

Back up the SQLite database before upgrading. Migration `002_web_exposure.sql` removes the retired route-ID column and enforces the two supported modes on inserts and updates. Historical migration `001_init.sql` stays immutable. If an existing row uses an unsupported mode, startup fails and the migration transaction rolls back; no row is deleted or silently made public. Use the previous version to explicitly redeploy the service as `access` with an allowed zone hostname, or uninstall it, then retry the upgrade. Review/remove any previously provisioned external resources separately; this source change performs no Cloudflare cleanup on a live account.

## Hygiene footgun

`vps-hygiene` `clean-docker.sh --aggressive` runs `docker system prune -af --volumes` and will delete named volumes of **stopped** `fleet-*` stacks. Prefer `compose stop` only when you will not prune.

## Isolated lifecycle and recovery acceptance

The repeatable non-Cloudflare acceptance entrypoints are `scripts/verify.py` and `scripts/acceptance.py` (Python standard library tooling). Run both through the common agent workspace launcher. The verifier executes the Makefile-equivalent native commands and writes three binaries under `AGENT_ARTIFACTS_DIR/bin`, plus source hashes and logs under `AGENT_EVIDENCE_DIR`.

On an authorized test host, first inspect current processes, services, containers, storage and active tasks. The acceptance runner requires real Docker/Compose, the `registry:2` image already present, and free loopback ports 15001, 18765, 19600 and 20000. It refuses reused state. Transfer the exact built binaries and runner, then invoke `scripts/acceptance.py --bin-dir <artifact-bin-dir> --source-id <source-manifest-id>` through the launcher. These arguments are operator inputs, not a claim that a particular host has been approved.

It creates a dedicated local registry, one synthetic node and one hello-healthz workload; checks literal env/argv, lifecycle, stable generations, secret merge, fresh restart reporting, outage reconciliation and uninstall after generated-file loss. It then stops its own processes, removes only its own containers/network, and verifies the original container inventory. State databases, logs and test image artifacts remain available for inspection; there is no prune or automatic data cleanup. A daemon/host reboot is not part of this runner.

Cloudflare credentials are deliberately absent in this local-origin test; the synthetic workload uses Access mode but no edge authentication is claimed. To finish AC-03, supply account/zone and API-token configuration, base/allowed domains, protected bootstrap tunnel/hostnames and a nonempty Access email allowlist. Verify unauthenticated denial and authorized email OTP success in a real browser. Local origin success cannot satisfy these checks. Prior lifecycle results: [2026-10-23 acceptance](evidence/2026-10-23-acceptance.md); current scope and results: [SUCCESS](../SUCCESS.md).
