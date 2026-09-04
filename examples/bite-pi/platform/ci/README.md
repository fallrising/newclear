# Docker-flow CI skeleton

Idea:

1. CI builds image and pushes to registry
2. Deploy job SSHes to VPS (or runs self-hosted runner on VPS)
3. Calls `./ci/deploy-app.sh` with `IMAGE=... SERVICE_NAME=...`
4. App joins `platform_edge` network → Nginx can route → Promtail collects logs

This is intentionally tiny. Expand with health checks, blue/green, and secrets as needed.
