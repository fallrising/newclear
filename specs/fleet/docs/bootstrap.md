# Bootstrap (Phase 1)

The [SDD](SDD.md) is the source of truth. This page is the operator checklist.

## Cloudflare (once)

1. Zone in the account; API token with Tunnel Write, DNS Write, Access Apps/Policies Write, Cloudflare One Networks Write, Access IdP Write.
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

## WARP / private-mode checklist

Private hostnames are **not** RFC1918. Cloudflare assigns initial resolved IPs in CGNAT:

- IPv4: `100.80.0.0/16`
- IPv6: `2606:4700:0cf1:4000::/64`

Default WARP Split Tunnels **Exclude** lists `100.64.0.0/10`, which covers `100.80.0.0/16`. Official steps: [Connect a private hostname](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/cloudflared/connect-private-hostname/).

1. Enroll the operator laptop (and phone) in **Cloudflare WARP** (Gateway with WARP) for the same Zero Trust org.
2. **Split Tunnels — Exclude mode (typical default):**
   1. **Remove** `100.64.0.0/10` from the exclude list so `100.80.0.0/16` rides WARP.
   2. Optionally add back unused CGNAT slices so other CGNAT stays local, e.g. exclude `100.64.0.0/12`, `100.81.0.0/16`, `100.82.0.0/15`, `100.84.0.0/14`, `100.88.0.0/13`, `100.112.0.0/12`. Do **not** re-add `100.80.0.0/16`.
   3. **Include mode** (if that is the profile): add `100.80.0.0/16` and `2606:4700:0cf1:4000::/64`.
3. **Local Domain Fallback:** **delete** `fleet.internal` (and any parent that would catch `*.fleet.internal`) from the LDF list so DNS hits Gateway. Adding a fallback for `fleet.internal` is the wrong knob.
4. Hostname routes are created by `fleetd` (`POST .../zerotrust/routes/hostname`). Confirm `warp-routing.enabled=true` on the **node** tunnel (`ingress_status=ok`).
5. From the WARP device: `curl -sS http://files.fleet.internal/healthz` after Example C is running.

Do **not** allocate `10.42.0.0/16` / teamnet CIDR routes in Phase 1. SSH port-forward to `127.0.0.1:<hostPort>` remains a manual escape hatch.

## Hygiene footgun

`vps-hygiene` `clean-docker.sh --aggressive` runs `docker system prune -af --volumes` and will delete named volumes of **stopped** `fleet-*` stacks. Prefer `compose stop` only when you will not prune.
