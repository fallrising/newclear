# Platform Bootstrap

Adapt a single VPS into a minimal shared infrastructure platform for multiple business apps.

## When to use

Use this skill when the user wants to provision or evolve baseline platform services on a VPS, such as:

- reverse proxy / routing (Nginx)
- metrics (Prometheus)
- dashboards (Grafana)
- logs (Loki + Promtail)
- LLM gateway (9router — OpenAI-compatible `/v1` for Pi, OpenCode, and other tools)
- optional APM (SkyWalking)
- a simple Docker-based CI/CD skeleton

## Non-goals

- Do NOT pretend to be Kubernetes, Terraform Cloud, or a managed PaaS
- Do NOT destroy existing named volumes without explicit confirmation
- Do NOT expose Grafana/Prometheus/SkyWalking/9router publicly without auth guidance
- Do NOT install packages system-wide when Docker Compose is enough
- Do NOT vendor or fork the 9router source tree into this repo — use the official `decolua/9router` image
- Do NOT commit LLM API keys; configure them in the 9router dashboard (persisted in the volume)

## OpenCode naming (do not confuse)

| Name | Role |
|------|------|
| **OpenCode CLI** | Client — point provider `baseURL` at 9router `/v1` |
| **OpenCode Free** | Upstream provider *inside* 9router (passthrough to opencode.ai) |

## Operating procedure

1. Probe the host (non-destructive):
   - `uname -a`, free disk, free memory
   - `docker version`, `docker compose version`
   - listening ports: 80, 443, 3000, 9090, 3100, 20128, 11800, 12800
2. Ask (or infer from args) which modules to enable:
   - always: nginx, prometheus, grafana, loki, promtail, ci skeleton
   - default on: LLM gateway (`ENABLE_LLM_GATEWAY=1`)
   - optional: skywalking (`ENABLE_APM=1`)
3. Generate files under `platform/` by running:
   ```bash
   DOMAIN=<domain> ENABLE_APM=<0|1> ENABLE_LLM_GATEWAY=<0|1> NINE_ROUTER_BIND=127.0.0.1 ./scripts/bootstrap-platform.sh
   ```
4. Show `platform/INVENTORY.md`, `platform/clients/README.md`, and the compose service list to the user
5. Only after confirmation, run:
   ```bash
   cd platform && docker compose up -d
   ```
6. For LLM gateway: open `http://127.0.0.1:20128/dashboard`, connect providers, then wire Pi/OpenCode from `platform/clients/`
7. Record what changed in `platform/CHANGELOG.md` (append a dated note)

## Adaptation rules for "many business systems"

When the user already has apps on the same VPS:

- Prefer adding an Nginx upstream + `location` / server block per app
- Prefer each app exporting `/metrics` for Prometheus scrape
- Prefer apps writing logs to stdout so Promtail/Docker logging can collect them
- Keep platform services on a dedicated compose project name: `platform`
- Keep app compose projects separate; only share the external docker network `platform_edge`
- Prefer binding 9router to `127.0.0.1` on public VPS; optional Nginx `/llm/` reverse proxy only with auth

## Safety checklist before `docker compose up`

- [ ] No port conflict with existing services (including 20128)
- [ ] Grafana admin password is not the default in production
- [ ] 9router is not bound to `0.0.0.0` on a public VPS without auth / firewall
- [ ] Data directories / volumes are on a disk with enough space
- [ ] User understands this is a starter stack, not production-hardened HA
- [ ] Subscription / free LLM channels will be used in compliance with provider terms

## Example user prompts this skill should handle

- "幫我在這臺 VPS 長出基礎平臺：nginx + prometheus + grafana + 日誌"
- "我已經有兩個業務容器，幫我掛到 nginx 並納入監控"
- "加 SkyWalking，但先不要對外暴露 UI"
- "給我一個 docker 流的簡易 CI 骨架"
- "幫我把 9router 拉起來並產出 Pi 的 models.json"
- "讓 OpenCode 走這臺 VPS 上的 LLM 網關"

## Success criteria

- `docker compose config` succeeds
- `platform/INVENTORY.md` lists every service, port, and purpose
- User can open Grafana after stack is up (when they chose to start it)
- With LLM gateway enabled: `nine_router` is in compose, bound to loopback by default, and `platform/clients/` has Pi + OpenCode templates
- Adding a new business app only requires Nginx + Prometheus scrape edits, not reinventing the platform
