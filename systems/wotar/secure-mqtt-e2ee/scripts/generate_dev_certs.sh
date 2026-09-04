#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="${ROOT}/certs"
mkdir -p "${CERT_DIR}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required" >&2
  exit 1
fi

cat > "${CERT_DIR}/openssl.cnf" <<'EOF'
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_ca
prompt = no

[req_distinguished_name]
CN = Secure MQTT Dev CA

[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer

[server_cert]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
EOF

if [[ ! -f "${CERT_DIR}/ca.key" ]]; then
  openssl genrsa -out "${CERT_DIR}/ca.key" 4096
  openssl req -x509 -new -nodes -key "${CERT_DIR}/ca.key" -sha256 -days 3650 \
    -out "${CERT_DIR}/ca.pem" -config "${CERT_DIR}/openssl.cnf"
fi

if [[ ! -f "${CERT_DIR}/server.key" ]]; then
  openssl genrsa -out "${CERT_DIR}/server.key" 2048
  openssl req -new -key "${CERT_DIR}/server.key" -out "${CERT_DIR}/server.csr" \
    -subj "/CN=localhost"
  openssl x509 -req -in "${CERT_DIR}/server.csr" -CA "${CERT_DIR}/ca.pem" -CAkey "${CERT_DIR}/ca.key" \
    -CAcreateserial -out "${CERT_DIR}/server.pem" -days 825 -sha256 \
    -extfile "${CERT_DIR}/openssl.cnf" -extensions server_cert
fi

if [[ ! -f "${CERT_DIR}/client.key" ]]; then
  openssl genrsa -out "${CERT_DIR}/client.key" 2048
  openssl req -new -key "${CERT_DIR}/client.key" -out "${CERT_DIR}/client.csr" \
    -subj "/CN=secure-mqtt-client"
  openssl x509 -req -in "${CERT_DIR}/client.csr" -CA "${CERT_DIR}/ca.pem" -CAkey "${CERT_DIR}/ca.key" \
    -CAcreateserial -out "${CERT_DIR}/client.pem" -days 825 -sha256 \
    -extfile "${CERT_DIR}/openssl.cnf" -extensions server_cert
fi

if [[ ! -f "${CERT_DIR}/unauthorized-client.key" ]]; then
  openssl genrsa -out "${CERT_DIR}/unauthorized-client.key" 2048
  openssl req -new -key "${CERT_DIR}/unauthorized-client.key" \
    -out "${CERT_DIR}/unauthorized-client.csr" -subj "/CN=unauthorized-client"
  openssl x509 -req -in "${CERT_DIR}/unauthorized-client.csr" \
    -CA "${CERT_DIR}/ca.pem" -CAkey "${CERT_DIR}/ca.key" \
    -CAcreateserial -out "${CERT_DIR}/unauthorized-client.pem" -days 825 -sha256 \
    -extfile "${CERT_DIR}/openssl.cnf" -extensions server_cert
fi

chmod 600 "${CERT_DIR}/"*.key 2>/dev/null || true
echo "Generated certs in ${CERT_DIR}"