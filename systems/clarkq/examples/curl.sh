#!/usr/bin/env bash
# clarkQ curl 用法演示
# 用法: CLARKQ_URL=http://localhost:8080 CLARKQ_API_KEY=dev-key bash examples/curl.sh

set -euo pipefail

BASE_URL="${CLARKQ_URL:-http://localhost:8080}"
API_KEY="${CLARKQ_API_KEY:-}"

auth_header() {
  if [[ -n "$API_KEY" ]]; then
    echo "-H" "X-API-Key: ${API_KEY}"
  fi
}

section() {
  echo
  echo "========== $1 =========="
}

section "1. 健康檢查（無需 API Key）"
curl -s "${BASE_URL}/health" | jq . 2>/dev/null || curl -s "${BASE_URL}/health"
echo

section "2. 寫入消息"
curl -s -X POST "${BASE_URL}/api/v1/queue/demo-curl" \
  $(auth_header) \
  -H "Content-Type: application/json" \
  -d '{"body":"hello from curl","metadata":{"demo":"curl"}}' | jq . 2>/dev/null || true
echo

section "3. 讀取消息"
curl -s "${BASE_URL}/api/v1/queue/demo-curl" $(auth_header) | jq . 2>/dev/null || true
echo

section "4. 再次讀取（隊列應為空，204）"
code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/queue/demo-curl" $(auth_header))
echo "HTTP ${code} (expect 204 if consumed)"

section "5. 列出隊列"
curl -s "${BASE_URL}/api/v1/queues" $(auth_header) | jq . 2>/dev/null || true
echo

section "6. 加密配置"
curl -s "${BASE_URL}/api/v1/crypto/config" $(auth_header) | jq . 2>/dev/null || true
echo

section "7. 公鑰（僅 server_rsa 模式有效）"
curl -s "${BASE_URL}/api/v1/crypto/public-key" $(auth_header) | jq 'del(.public_key) | .public_key_preview = "...(omitted)"' 2>/dev/null \
  || curl -s "${BASE_URL}/api/v1/crypto/public-key" $(auth_header)
echo

section "8. 無 API Key 時應返回 401（若已啟用認證）"
if [[ -n "$API_KEY" ]]; then
  code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/v1/queues")
  echo "HTTP ${code} (expect 401)"
else
  echo "CLARKQ_API_KEY 未設置，跳過"
fi

echo
echo "完成。詳見 docs/USAGE.md"