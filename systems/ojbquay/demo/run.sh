#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export OJBQUAY_E2E_PROJECT=ojbquay-demo
export KEEP_STACK=1

"$root/e2e/compose_full.sh"

cat <<'EOF'

DEMO_READY
  Console:    http://localhost:28088
  Prometheus: http://localhost:29090
  Grafana:    http://localhost:23000
  Push count: http://localhost:28081/count
  Login:      admin / local-admin-password (isolated local demo only)

The verified topic, group, and subscription remain available in the console.
Stop and remove only this disposable demo with: make demo-down
EOF
