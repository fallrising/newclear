#!/usr/bin/env bash
# Demonstrate DEK rotation with decrypt-only grace period.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEYRING="${ROOT}/.secure_mqtt/keyring.json"
CLI="${ROOT}/.venv/bin/secure-mqtt"

echo "== Current keys =="
"${CLI}" keys list --path "${KEYRING}"

NEW_KID="dek-demo-$(date +%s)"
echo "== Add pending ${NEW_KID} =="
"${CLI}" keys add-pending --path "${KEYRING}" --topic-group default --kid "${NEW_KID}"

echo "== Activate ${NEW_KID} =="
"${CLI}" keys activate --path "${KEYRING}" --topic-group default --kid "${NEW_KID}"

echo "== Validate keyring =="
"${CLI}" keys validate --path "${KEYRING}"