#!/bin/bash

# Goku CLI Browser Import Script
# Simple import for browser bookmark exports with automatic format detection

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

show_help() {
    cat << EOF
Goku CLI Browser Import Script

USAGE:
    $0 [OPTIONS] <file> [user]

DESCRIPTION:
    Simple import for browser bookmark exports with automatic format detection.
    Optimized for typical browser export files (Chrome, Firefox, Safari, Edge).

ARGUMENTS:
    file            Browser export file (.html, .json)
    user            User profile (default: goku)

OPTIONS:
    -f, --fetch            Enable metadata fetching
    -w, --workers NUM      Number of workers (default: 5)
    --mqtt-broker HOST     Enable MQTT publishing
    --mqtt-port PORT       MQTT port (default: 1883)
    -v, --verbose          Verbose output
    -h, --help             Show this help

SUPPORTED BROWSERS:
    Chrome          - HTML export (chrome://bookmarks -> Export bookmarks)
    Firefox         - HTML or JSON export (Library -> Import and Backup -> Export)
    Safari          - HTML export (File -> Export Bookmarks)
    Edge            - HTML export (Settings -> Import or export -> Export to file)

EXAMPLES:
    # Import Chrome bookmarks
    $0 chrome-bookmarks.html

    # Import Firefox bookmarks with metadata fetching
    $0 --fetch firefox-bookmarks.json personal

    # Import with MQTT notifications
    $0 --mqtt-broker localhost safari-bookmarks.html work

EOF
}

# Parse arguments
FETCH="false"
WORKERS="5"
MQTT_BROKER=""
MQTT_PORT="1883"
VERBOSE="false"
FILE=""
USER="goku"

while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--fetch)
            FETCH="true"
            shift
            ;;
        -w|--workers)
            WORKERS="$2"
            shift 2
            ;;
        --mqtt-broker)
            MQTT_BROKER="$2"
            shift 2
            ;;
        --mqtt-port)
            MQTT_PORT="$2"
            shift 2
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

# Validate
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

# Detect browser type
detect_browser() {
    local file="$1"
    local ext="${file##*.}"
    
    case "$ext" in
        html)
            if grep -q "NETSCAPE-Bookmark-file-1" "$file"; then
                echo "Netscape/Mozilla format (Firefox, Chrome, Safari, Edge)"
            else
                echo "HTML format"
            fi
            ;;
        json)
            if grep -q '"type":"text/x-moz-place"' "$file"; then
                echo "Firefox JSON format"
            elif grep -q '"type":"folder"' "$file"; then
                echo "Firefox/Chrome JSON format"
            else
                echo "JSON format"
            fi
            ;;
        *)
            echo "Unknown format"
            ;;
    esac
}

# Build command
CMD=("$GOKU_BIN" "--user" "$USER" "import" "--file" "$FILE" "--workers" "$WORKERS")

if [[ "$FETCH" == "true" ]]; then
    CMD+=("--fetch")
fi

if [[ -n "$MQTT_BROKER" ]]; then
    CMD+=("--mqtt-broker" "$MQTT_BROKER" "--mqtt-port" "$MQTT_PORT")
fi

# Display info
log "Browser Import Configuration"
echo "================================"
echo "File:           $FILE"
echo "User Profile:   $USER"
echo "Detected Type:  $(detect_browser "$FILE")"
echo "Workers:        $WORKERS"
echo "Fetch Metadata: $FETCH"
if [[ -n "$MQTT_BROKER" ]]; then
    echo "MQTT Broker:    $MQTT_BROKER:$MQTT_PORT"
fi
echo "================================"

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
esac

echo "Estimated Bookmarks: $BOOKMARK_COUNT"
echo "================================"

# Execute import
log "Starting browser import..."
START_TIME=$(date +%s)

if [[ "$VERBOSE" == "true" ]]; then
    log "Command: ${CMD[*]}"
fi

set +e
"${CMD[@]}"
EXIT_CODE=$?
set -e

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "================================"
echo "Import completed in: ${DURATION}s"

if [[ $EXIT_CODE -eq 0 ]]; then
    success "Browser import completed successfully!"
    log "Updated statistics:"
    "$GOKU_BIN" --user "$USER" stats
else
    error "Import failed with exit code: $EXIT_CODE"
    exit $EXIT_CODE
fi