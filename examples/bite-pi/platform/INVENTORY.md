# Platform inventory

Generated at: 2026-07-28T12:34:35-04:00
Domain: `apps.local`
APM enabled in compose file: `1`
LLM gateway (9router) enabled: `1`
9router bind: `127.0.0.1:20128`

| Service | Port | Role |
|---------|------|------|
| nginx | 80 | edge router for business apps |
| prometheus | 9090 | metrics |
| grafana | 3000 | dashboards (admin / changeme) |
| loki | 3100 | log store |
| promtail | (internal) | ship container logs to Loki |
| nine_router | 127.0.0.1:20128 | LLM gateway — OpenAI-compatible `/v1` + dashboard |
| skywalking-oap | 11800 / 12800 | APM backend (compose profile `apm`) |
| skywalking-ui | 8080 | APM UI (compose profile `apm`) |

## Start

```bash
cd platform
docker compose up -d
# LLM gateway: http://127.0.0.1:20128/dashboard
# Wire clients: see clients/README.md
docker compose --profile apm up -d   # optional APM
```

## Attach a business app

1. Put the app container on network `platform_edge`
2. Add Nginx upstream/location in `nginx/conf.d/`
3. Add Prometheus scrape job if the app exposes `/metrics`
4. Reload nginx: `docker compose exec nginx nginx -s reload`

## LLM clients (Pi / OpenCode)

1. Start `nine_router` and open the dashboard
2. Connect upstream providers (API keys stay in 9router data volume)
3. Copy templates from `clients/` into Pi / OpenCode config
4. Prefer bind `127.0.0.1` — do not expose 20128 on the public internet without auth
