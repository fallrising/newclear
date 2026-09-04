#!/bin/bash

# Goku CLI Bulk Import Script
# Optimized for importing 100k+ bookmarks with proper rate limiting and monitoring

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOKU_BIN="${GOKU_BIN:-./bin/goku}"
DEFAULT_DOMAIN_DELAY="2s"
DEFAULT_FETCH_TIMEOUT="30s"
DEFAULT_MAX_DOMAINS="5"
DEFAULT_MAX_FAILURES="5"
DEFAULT_COOLDOWN="1h"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
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

# Help function
show_help() {
    cat << EOF
Goku CLI Bulk Import Script

USAGE:
    $0 [OPTIONS] <file> [user]

DESCRIPTION:
    Import large datasets (100k+ bookmarks) with optimized settings for web crawling etiquette.
    Includes automatic progress monitoring, resumable operations, and performance optimization.

ARGUMENTS:
    file            Input file path (.html, .json, or .txt)
    user            User profile (default: goku)

OPTIONS:
    -d, --domain-delay DELAY     Delay between requests to same domain (default: $DEFAULT_DOMAIN_DELAY)
    -t, --timeout TIMEOUT        HTTP timeout for metadata fetching (default: $DEFAULT_FETCH_TIMEOUT)
    -c, --max-domains NUM        Maximum concurrent domains (default: $DEFAULT_MAX_DOMAINS)
    -f, --max-failures NUM       Max failures before skipping domain (default: $DEFAULT_MAX_FAILURES)
    -w, --workers NUM            Number of worker threads (default: 5)
    -r, --resume-file FILE       Resume file path (default: auto-generated)
    --cooldown DURATION          Domain cooldown after failures (default: $DEFAULT_COOLDOWN)
    --no-fetch                   Disable metadata fetching
    --mqtt-broker HOST           Enable MQTT publishing
    --mqtt-port PORT             MQTT port (default: 1883)
    --mqtt-topic TOPIC           MQTT topic (default: goku/bookmarks)
    --dry-run                    Show what would be imported without executing
    -v, --verbose                Enable verbose logging
    -h, --help                   Show this help

EXAMPLES:
    # Basic bulk import
    $0 large-bookmarks.json research

    # High-performance import with custom settings
    $0 -d 1s -t 45s -c 10 -w 10 huge-dataset.json enterprise

    # Import with MQTT real-time events
    $0 --mqtt-broker localhost bookmarks.html personal

    # Resume interrupted import
    $0 -r my-progress.txt large-export.json research

    # Conservative import for respectful crawling
    $0 -d 5s -c 3 -f 3 bookmarks.json research

PERFORMANCE ESTIMATES:
    Small datasets (<1k):     ~1000 bookmarks/minute
    Medium datasets (1k-10k): ~800 bookmarks/minute
    Large datasets (10k-100k): ~500 bookmarks/minute
    Enterprise (100k+):      ~200-400 bookmarks/minute (with rate limiting)

EOF
}

# Parse command line arguments
DOMAIN_DELAY="$DEFAULT_DOMAIN_DELAY"
FETCH_TIMEOUT="$DEFAULT_FETCH_TIMEOUT"
MAX_DOMAINS="$DEFAULT_MAX_DOMAINS"
MAX_FAILURES="$DEFAULT_MAX_FAILURES"
WORKERS="5"
RESUME_FILE=""
COOLDOWN="$DEFAULT_COOLDOWN"
FETCH_ENABLED="true"
MQTT_BROKER=""
MQTT_PORT="1883"
MQTT_TOPIC="goku/bookmarks"
DRY_RUN="false"
VERBOSE="false"
FILE=""
USER="goku"

while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--domain-delay)
            DOMAIN_DELAY="$2"
            shift 2
            ;;
        -t|--timeout)
            FETCH_TIMEOUT="$2"
            shift 2
            ;;
        -c|--max-domains)
            MAX_DOMAINS="$2"
            shift 2
            ;;
        -f|--max-failures)
            MAX_FAILURES="$2"
            shift 2
            ;;
        -w|--workers)
            WORKERS="$2"
            shift 2
            ;;
        -r|--resume-file)
            RESUME_FILE="$2"
            shift 2
            ;;
        --cooldown)
            COOLDOWN="$2"
            shift 2
            ;;
        --no-fetch)
            FETCH_ENABLED="false"
            shift
            ;;
        --mqtt-broker)
            MQTT_BROKER="$2"
            shift 2
            ;;
        --mqtt-port)
            MQTT_PORT="$2"
            shift 2
            ;;
        --mqtt-topic)
            MQTT_TOPIC="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN="true"
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
            else
                error "Too many arguments"
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate required arguments
if [[ -z "$FILE" ]]; then
    error "File argument is required"
    show_help
    exit 1
fi

if [[ ! -f "$FILE" ]]; then
    error "File not found: $FILE"
    exit 1
fi

# Check if goku binary exists
if [[ ! -x "$GOKU_BIN" ]]; then
    error "Goku binary not found or not executable: $GOKU_BIN"
    error "Set GOKU_BIN environment variable or build goku first"
    exit 1
fi

# Generate resume file if not provided
if [[ -z "$RESUME_FILE" ]]; then
    RESUME_FILE=".goku-bulk-import-$(basename "$FILE")-${USER}.progress"
fi

# Prepare command
CMD=("$GOKU_BIN" "--user" "$USER" "import" "--file" "$FILE" "--bulk-mode")
CMD+=("--workers" "$WORKERS")
CMD+=("--domain-delay" "$DOMAIN_DELAY")
CMD+=("--fetch-timeout" "$FETCH_TIMEOUT")
CMD+=("--max-concurrent-domains" "$MAX_DOMAINS")
CMD+=("--max-failures-per-domain" "$MAX_FAILURES")
CMD+=("--skip-domain-cooldown" "$COOLDOWN")
CMD+=("--resume-file" "$RESUME_FILE")

if [[ "$FETCH_ENABLED" == "true" ]]; then
    CMD+=("--fetch")
fi

if [[ -n "$MQTT_BROKER" ]]; then
    CMD+=("--mqtt-broker" "$MQTT_BROKER")
    CMD+=("--mqtt-port" "$MQTT_PORT")
    CMD+=("--mqtt-topic" "$MQTT_TOPIC")
fi

# Display configuration
log "Goku Bulk Import Configuration"
echo "================================"
echo "File:                $FILE"
echo "User Profile:        $USER"
echo "Domain Delay:        $DOMAIN_DELAY"
echo "Fetch Timeout:       $FETCH_TIMEOUT"
echo "Max Concurrent:      $MAX_DOMAINS domains"
echo "Max Failures:        $MAX_FAILURES per domain"
echo "Workers:             $WORKERS"
echo "Resume File:         $RESUME_FILE"
echo "Metadata Fetching:   $FETCH_ENABLED"
if [[ -n "$MQTT_BROKER" ]]; then
    echo "MQTT Broker:         $MQTT_BROKER:$MQTT_PORT"
    echo "MQTT Topic:          $MQTT_TOPIC"
fi
echo "================================"

# File size and estimation
FILE_SIZE=$(du -h "$FILE" | cut -f1)
echo "File Size:           $FILE_SIZE"

# Estimate bookmark count
case "${FILE##*.}" in
    html)
        ESTIMATED_COUNT=$(grep -c 'href=' "$FILE" 2>/dev/null || echo "unknown")
        ;;
    json)
        ESTIMATED_COUNT=$(grep -c '"url"' "$FILE" 2>/dev/null || echo "unknown")
        ;;
    txt)
        ESTIMATED_COUNT=$(wc -l < "$FILE" 2>/dev/null || echo "unknown")
        ;;
    *)
        ESTIMATED_COUNT="unknown"
        ;;
esac

if [[ "$ESTIMATED_COUNT" != "unknown" ]]; then
    echo "Estimated Bookmarks: $ESTIMATED_COUNT"
    
    # Time estimation
    if [[ "$ESTIMATED_COUNT" -gt 0 ]]; then
        DELAY_SECONDS=$(echo "$DOMAIN_DELAY" | sed 's/[^0-9]//g')
        if [[ -n "$DELAY_SECONDS" && "$DELAY_SECONDS" -gt 0 ]]; then
            ESTIMATED_MINUTES=$((ESTIMATED_COUNT * DELAY_SECONDS / 60 / MAX_DOMAINS))
            echo "Estimated Time:      ~$ESTIMATED_MINUTES minutes (with rate limiting)"
        fi
    fi
fi

echo "================================"

# Dry run
if [[ "$DRY_RUN" == "true" ]]; then
    log "DRY RUN - Command that would be executed:"
    echo "${CMD[*]}"
    exit 0
fi

# Check for existing resume file
if [[ -f "$RESUME_FILE" ]]; then
    RESUME_POSITION=$(cat "$RESUME_FILE" 2>/dev/null || echo "0")
    warning "Resume file found: $RESUME_FILE (position: $RESUME_POSITION)"
    echo "This will resume the import from where it left off."
    read -p "Continue with resume? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "Starting fresh import (resume file will be overwritten)"
        rm -f "$RESUME_FILE"
    fi
fi

# Pre-import checks
log "Running pre-import checks..."

# Check database accessibility
if ! "$GOKU_BIN" --user "$USER" list --limit 1 >/dev/null 2>&1; then
    error "Cannot access database for user '$USER'"
    exit 1
fi

# Check available disk space
AVAILABLE_SPACE=$(df . | tail -1 | awk '{print $4}')
if [[ "$AVAILABLE_SPACE" -lt 1000000 ]]; then # Less than 1GB
    warning "Low disk space available: $(df -h . | tail -1 | awk '{print $4}')"
fi

success "Pre-import checks passed"

# Start import with monitoring
log "Starting bulk import..."
START_TIME=$(date +%s)

# Setup monitoring in background
if [[ "$VERBOSE" == "true" ]]; then
    # Monitor progress in background
    (
        while [[ -f "$RESUME_FILE" ]]; do
            if [[ -f "$RESUME_FILE" ]]; then
                CURRENT_POS=$(cat "$RESUME_FILE" 2>/dev/null || echo "0")
                if [[ "$CURRENT_POS" -gt 0 && "$ESTIMATED_COUNT" != "unknown" ]]; then
                    PERCENT=$((CURRENT_POS * 100 / ESTIMATED_COUNT))
                    log "Progress: $CURRENT_POS/$ESTIMATED_COUNT ($PERCENT%)"
                fi
            fi
            sleep 30
        done
    ) &
    MONITOR_PID=$!
fi

# Execute import
set +e
"${CMD[@]}"
EXIT_CODE=$?
set -e

# Stop monitoring
if [[ "$VERBOSE" == "true" && -n "${MONITOR_PID:-}" ]]; then
    kill "$MONITOR_PID" 2>/dev/null || true
fi

# Calculate execution time
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
HOURS=$((DURATION / 3600))
MINUTES=$(((DURATION % 3600) / 60))
SECONDS=$((DURATION % 60))

echo "================================"
echo "Import completed in: ${HOURS}h ${MINUTES}m ${SECONDS}s"

# Final status
if [[ $EXIT_CODE -eq 0 ]]; then
    success "Bulk import completed successfully!"
    
    # Clean up resume file on success
    if [[ -f "$RESUME_FILE" ]]; then
        rm -f "$RESUME_FILE"
        log "Resume file cleaned up"
    fi
    
    # Show final statistics
    log "Final Statistics:"
    "$GOKU_BIN" --user "$USER" stats
    
else
    error "Import failed with exit code: $EXIT_CODE"
    if [[ -f "$RESUME_FILE" ]]; then
        warning "Resume file preserved: $RESUME_FILE"
        warning "You can resume the import by running this script again"
    fi
    exit $EXIT_CODE
fi