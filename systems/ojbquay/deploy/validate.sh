#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$root/deploy/validate-brand.sh"

docker run --rm \
  -v "$root/deploy/prometheus:/etc/prometheus:ro" \
  --entrypoint promtool \
  prom/prometheus:v3.7.3 \
  check config /etc/prometheus/prometheus.yml

docker run --rm \
  -v "$root/deploy/k8s:/work:ro" \
  -w /work \
  registry.k8s.io/kubectl:v1.35.1 \
  kustomize . >/dev/null

docker run --rm \
  -v "$root:/workspace:ro" \
  -w /workspace \
  python:3.14-alpine \
  python -c '
import json
from pathlib import Path

dashboards = sorted(Path("deploy/grafana/dashboards").glob("*.json"))
assert [path.stem for path in dashboards] == [
    "platform-overview", "subscription-detail", "topic-detail"
]
for path in dashboards:
    model = json.loads(path.read_text())
    assert model["uid"] and model["title"]
    assert len(model["panels"]) >= 3
print(f"validated {len(dashboards)} Grafana dashboards")
'
