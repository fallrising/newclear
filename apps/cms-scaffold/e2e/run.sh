#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

need_docker=0
browser="$(find "$HOME/.cache/ms-playwright" -name chrome-headless-shell -type f 2>/dev/null | head -n 1 || true)"
if [[ -z "${browser}" ]]; then
  need_docker=1
elif ldd "${browser}" 2>/dev/null | grep -q "not found"; then
  need_docker=1
fi

if [[ "${need_docker}" -eq 0 ]]; then
  exec npx playwright test "$@"
fi

image="mcr.microsoft.com/playwright:v1.63.0-noble"
echo "Host Chromium is missing system libraries; running e2e in ${image}" >&2
docker run --rm -v "${root}:/work" "${image}" rm -rf /work/test-results /work/playwright-report >/dev/null 2>&1 || true
exec docker run --rm --network=host \
  -v "${root}:/work" \
  -w /work \
  -e CMS_E2E_PASSWORD \
  -e CMS_SEED_PASSWORD \
  -e CMS_E2E_PASSWORD_FILE=/work/local/seed-passwords.txt \
  -e CMS_E2E_FRONT \
  -e CMS_E2E_BACK \
  -e CMS_E2E_ADMIN \
  -e CMS_E2E_API \
  -e PLAYWRIGHT_OUTPUT_DIR=/tmp/playwright-results \
  "${image}" \
  npx playwright test "$@"
