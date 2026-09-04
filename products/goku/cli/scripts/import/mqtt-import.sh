#!/bin/bash

# Goku CLI MQTT Import Script
# Import bookmarks with real-time MQTT event publishing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOKU_BIN="${GOKU_BIN:-./bin/goku}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

show_help() {
    cat << EOF
Goku CLI MQTT Import Script

USAGE:
    $0 [OPTIONS] <file> [user]

DESCRIPTION:
    Import bookmarks with real-time MQTT event publishing for integration with
    external systems, monitoring, and analytics platforms.

ARGUMENTS:
    file            Input file path
    user            User profile (default: goku)

OPTIONS:
    -b, --broker HOST          MQTT broker hostname/IP (required)
    -p, --port PORT            MQTT broker port (default: 1883)
    -u, --username USER        MQTT username
    -P, --password PASS        MQTT password
    -t, --topic TOPIC          MQTT topic prefix (default: goku/bookmarks)
    -q, --qos LEVEL            QoS level 0|1|2 (default: 1)
    -c, --client-id ID         MQTT client ID (default: auto-generated)
    -s, --ssl                  Use SSL/TLS connection
    --ca-file FILE             CA certificate file for SSL
    --cert-file FILE           Client certificate file
    --key-file FILE            Client private key file
    -w, --workers NUM          Number of workers (default: 5)
    --fetch                    Enable metadata fetching
    --bulk-mode               Enable bulk import mode
    --test-connection         Test MQTT connection and exit
    -v, --verbose             Verbose output
    -h, --help                Show this help

MQTT TOPICS:
    The script publishes events to the following topic structure:
    
    {topic-prefix}/imported    - Bookmark imported events
    {topic-prefix}/status      - Import status updates
    {topic-prefix}/stats       - Import statistics
    {topic-prefix}/errors      - Error notifications

EVENT PAYLOAD:
    {
        "type": "imported",
        "timestamp": "2023-12-01T10:30:00Z",
        "bookmark": {
            "id": 123,
            "url": "https://example.com",
            "title": "Example Site",
            "description": "Example description",
            "tags": ["example", "test"]
        },
        "source": "json-import",
        "user": "research"
    }

EXAMPLES:
    # Basic MQTT import
    $0 -b localhost bookmarks.html

    # Secure MQTT with authentication
    $0 -b mqtt.company.com -s -u goku-user -P secret bookmarks.json work

    # Custom topic and QoS
    $0 -b broker.example.com -t "data/bookmarks" -q 2 bookmarks.txt

    # Test MQTT connection
    $0 -b localhost --test-connection

    # High-throughput with bulk mode
    $0 -b localhost --bulk-mode --workers 10 large-dataset.json research

INTEGRATION EXAMPLES:
    # With Mosquitto broker
    $0 -b localhost -p 1883 bookmarks.html

    # With AWS IoT Core
    $0 -b xxx.iot.us-east-1.amazonaws.com -p 8883 -s --cert-file cert.pem --key-file key.pem bookmarks.json

    # With Azure IoT Hub
    $0 -b xxx.azure-devices.net -p 8883 -s -u device1 -P "SharedAccessSignature sr=..." bookmarks.json

EOF
}

# Test MQTT connection
test_mqtt_connection() {
    local broker="$1"
    local port="$2"
    local username="$3"
    local password="$4"
    local ssl="$5"
    local topic="$6"
    
    log "Testing MQTT connection..."
    echo "Broker: $broker:$port"
    echo "SSL: $ssl"
    echo "Username: ${username:-"(none)"}"
    echo "Topic: $topic"
    
    # Use mosquitto_pub if available for testing
    if command -v mosquitto_pub >/dev/null 2>&1; then
        local cmd=(mosquitto_pub -h "$broker" -p "$port" -t "${topic}/test" -m "connection test")
        
        if [[ "$ssl" == "true" ]]; then
            cmd+=(--cafile "${CA_FILE:-/etc/ssl/certs/ca-certificates.crt}")
        fi
        
        if [[ -n "$username" ]]; then
            cmd+=(-u "$username")
        fi
        
        if [[ -n "$password" ]]; then
            cmd+=(-P "$password")
        fi
        
        if [[ -n "${CERT_FILE:-}" ]]; then
            cmd+=(--cert "$CERT_FILE")
        fi
        
        if [[ -n "${KEY_FILE:-}" ]]; then
            cmd+=(--key "$KEY_FILE")
        fi
        
        set +e
        "${cmd[@]}"
        local exit_code=$?
        set -e
        
        if [[ $exit_code -eq 0 ]]; then
            success "MQTT connection test passed"
        else
            error "MQTT connection test failed"
            return 1
        fi
    else
        warning "mosquitto_pub not found - skipping connection test"
        warning "Install mosquitto-clients for connection testing"
    fi
}

# Parse arguments
BROKER=""
PORT="1883"
USERNAME=""
PASSWORD=""
TOPIC="goku/bookmarks"
QOS="1"
CLIENT_ID=""
SSL="false"
CA_FILE=""
CERT_FILE=""
KEY_FILE=""
WORKERS="5"
FETCH="false"
BULK_MODE="false"
TEST_CONNECTION="false"
VERBOSE="false"
FILE=""
USER="goku"

while [[ $# -gt 0 ]]; do
    case $1 in
        -b|--broker)
            BROKER="$2"
            shift 2
            ;;
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        -u|--username)
            USERNAME="$2"
            shift 2
            ;;
        -P|--password)
            PASSWORD="$2"
            shift 2
            ;;
        -t|--topic)
            TOPIC="$2"
            shift 2
            ;;
        -q|--qos)
            QOS="$2"
            shift 2
            ;;
        -c|--client-id)
            CLIENT_ID="$2"
            shift 2
            ;;
        -s|--ssl)
            SSL="true"
            if [[ "$PORT" == "1883" ]]; then
                PORT="8883"  # Default SSL port
            fi
            shift
            ;;
        --ca-file)
            CA_FILE="$2"
            shift 2
            ;;
        --cert-file)
            CERT_FILE="$2"
            shift 2
            ;;
        --key-file)
            KEY_FILE="$2"
            shift 2
            ;;
        -w|--workers)
            WORKERS="$2"
            shift 2
            ;;
        --fetch)
            FETCH="true"
            shift
            ;;
        --bulk-mode)
            BULK_MODE="true"
            shift
            ;;
        --test-connection)
            TEST_CONNECTION="true"
            shift
            ;;
        -v|--verbose)
            VERBOSE="true"
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        -*)
            error "Unknown option: $1"
            exit 1
            ;;
        *)
            if [[ -z "$FILE" ]]; then
                FILE="$1"
            elif [[ -z "$USER" || "$USER" == "goku" ]]; then
                USER="$1"
            fi
            shift
            ;;
    esac
done

# Validate required arguments
if [[ -z "$BROKER" ]]; then
    error "MQTT broker is required (-b/--broker)"
    show_help
    exit 1
fi

# Test connection mode
if [[ "$TEST_CONNECTION" == "true" ]]; then
    test_mqtt_connection "$BROKER" "$PORT" "$USERNAME" "$PASSWORD" "$SSL" "$TOPIC"
    exit 0
fi

if [[ -z "$FILE" ]]; then
    error "File argument is required"
    show_help
    exit 1
fi

if [[ ! -f "$FILE" ]]; then
    error "File not found: $FILE"
    exit 1
fi

if [[ ! -x "$GOKU_BIN" ]]; then
    error "Goku binary not found: $GOKU_BIN"
    exit 1
fi

# Validate QoS
if [[ ! "$QOS" =~ ^[012]$ ]]; then
    error "Invalid QoS level: $QOS (must be 0, 1, or 2)"
    exit 1
fi

# Generate client ID if not provided
if [[ -z "$CLIENT_ID" ]]; then
    CLIENT_ID="goku-import-$(date +%s)-$$"
fi

# Build command
CMD=("$GOKU_BIN" "--user" "$USER" "import" "--file" "$FILE" "--workers" "$WORKERS")
CMD+=("--mqtt-broker" "$BROKER" "--mqtt-port" "$PORT" "--mqtt-topic" "$TOPIC" "--mqtt-qos" "$QOS")
CMD+=("--mqtt-client-id" "$CLIENT_ID")

if [[ -n "$USERNAME" ]]; then
    CMD+=("--mqtt-username" "$USERNAME")
fi

if [[ -n "$PASSWORD" ]]; then
    CMD+=("--mqtt-password" "$PASSWORD")
fi

if [[ "$FETCH" == "true" ]]; then
    CMD+=("--fetch")
fi

if [[ "$BULK_MODE" == "true" ]]; then
    CMD+=("--bulk-mode")
fi

# Display configuration
log "MQTT Import Configuration"
echo "================================"
echo "File:         $FILE"
echo "User:         $USER"
echo "MQTT Broker:  $BROKER:$PORT"
echo "SSL/TLS:      $SSL"
echo "Username:     ${USERNAME:-"(none)"}"
echo "Topic Prefix: $TOPIC"
echo "QoS Level:    $QOS"
echo "Client ID:    $CLIENT_ID"
echo "Workers:      $WORKERS"
echo "Fetch:        $FETCH"
echo "Bulk Mode:    $BULK_MODE"
echo "================================"

# SSL configuration display
if [[ "$SSL" == "true" ]]; then
    echo "SSL Configuration:"
    echo "  CA File:    ${CA_FILE:-"(system default)"}"
    echo "  Cert File:  ${CERT_FILE:-"(none)"}"
    echo "  Key File:   ${KEY_FILE:-"(none)"}"
    echo "================================"
fi

# File analysis
FILE_SIZE=$(du -h "$FILE" | cut -f1)
echo "File Size: $FILE_SIZE"

case "${FILE##*.}" in
    html)
        BOOKMARK_COUNT=$(grep -c 'href=' "$FILE" 2>/dev/null || echo "0")
        ;;
    json)
        BOOKMARK_COUNT=$(grep -c '"url"' "$FILE" 2>/dev/null || echo "0")
        ;;
    txt)
        BOOKMARK_COUNT=$(wc -l < "$FILE" 2>/dev/null || echo "0")
        ;;
esac

echo "Estimated Bookmarks: $BOOKMARK_COUNT"
echo "Estimated MQTT Events: $((BOOKMARK_COUNT + 10))"  # +10 for status events
echo "================================"

# Test MQTT connection before starting
if command -v mosquitto_pub >/dev/null 2>&1; then
    log "Testing MQTT connection before import..."
    if ! test_mqtt_connection "$BROKER" "$PORT" "$USERNAME" "$PASSWORD" "$SSL" "$TOPIC"; then
        error "MQTT connection test failed - aborting import"
        exit 1
    fi
    echo "================================"
fi

# Start import
log "Starting MQTT-enabled import..."
START_TIME=$(date +%s)

if [[ "$VERBOSE" == "true" ]]; then
    log "Command: ${CMD[*]}"
fi

# Setup MQTT monitoring
if command -v mosquitto_sub >/dev/null 2>&1 && [[ "$VERBOSE" == "true" ]]; then
    log "Starting MQTT event monitor..."
    
    local monitor_cmd=(mosquitto_sub -h "$BROKER" -p "$PORT" -t "${TOPIC}/+")
    
    if [[ "$SSL" == "true" ]]; then
        monitor_cmd+=(--cafile "${CA_FILE:-/etc/ssl/certs/ca-certificates.crt}")
    fi
    
    if [[ -n "$USERNAME" ]]; then
        monitor_cmd+=(-u "$USERNAME")
    fi
    
    if [[ -n "$PASSWORD" ]]; then
        monitor_cmd+=(-P "$PASSWORD")
    fi
    
    # Start MQTT monitor in background
    "${monitor_cmd[@]}" | while read -r line; do
        echo "[MQTT] $line"
    done &
    MQTT_MONITOR_PID=$!
    
    trap 'kill $MQTT_MONITOR_PID 2>/dev/null || true' EXIT
fi

# Execute import
set +e
"${CMD[@]}"
EXIT_CODE=$?
set -e

# Stop MQTT monitor
if [[ -n "${MQTT_MONITOR_PID:-}" ]]; then
    kill "$MQTT_MONITOR_PID" 2>/dev/null || true
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "================================"
echo "Import completed in: ${DURATION}s"

if [[ $EXIT_CODE -eq 0 ]]; then
    success "MQTT import completed successfully!"
    log "Check your MQTT topic '$TOPIC' for real-time events"
    
    # Final statistics
    log "Final statistics:"
    "$GOKU_BIN" --user "$USER" stats
else
    error "Import failed with exit code: $EXIT_CODE"
    exit $EXIT_CODE
fi