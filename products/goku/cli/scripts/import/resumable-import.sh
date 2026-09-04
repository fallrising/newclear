#!/bin/bash

# Goku CLI Resumable Import Script
# Handle interrupted imports and resume from last position

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
Goku CLI Resumable Import Script

USAGE:
    $0 [OPTIONS] <file> [user]

DESCRIPTION:
    Resume interrupted imports or start new imports with automatic resume capability.
    Tracks progress and allows continuation from the last processed position.

ARGUMENTS:
    file            Input file path
    user            User profile (default: goku)

OPTIONS:
    -r, --resume-file FILE     Resume file path (default: auto-generated)
    -f, --force-restart        Ignore existing resume file and start fresh
    -s, --show-progress        Show current progress and exit
    -c, --cleanup              Clean up old resume files
    --bulk-mode               Enable bulk import mode
    -w, --workers NUM         Number of workers (default: 5)
    --fetch                   Enable metadata fetching
    -v, --verbose             Verbose output
    -h, --help                Show this help

EXAMPLES:
    # Start resumable import
    $0 large-file.json research

    # Resume specific import
    $0 -r my-progress.txt large-file.json research

    # Check progress without importing
    $0 -s -r progress.txt large-file.json research

    # Clean restart (ignore resume file)
    $0 -f large-file.json research

    # Cleanup old resume files
    $0 -c

EOF
}

# List resume files
list_resume_files() {
    echo "Resume files in current directory:"
    find . -name ".goku-*-progress*" -type f 2>/dev/null | while read -r file; do
        if [[ -f "$file" ]]; then
            local size=$(du -h "$file" | cut -f1)
            local modified=$(stat -c '%y' "$file" 2>/dev/null || stat -f '%Sm' "$file" 2>/dev/null || echo "unknown")
            local position=$(cat "$file" 2>/dev/null || echo "0")
            echo "  $file (position: $position, size: $size, modified: $modified)"
        fi
    done
}

# Show progress from resume file
show_progress() {
    local resume_file="$1"
    local file="$2"
    
    if [[ ! -f "$resume_file" ]]; then
        error "Resume file not found: $resume_file"
        return 1
    fi
    
    local position=$(cat "$resume_file" 2>/dev/null || echo "0")
    
    # Estimate total from file
    local total="unknown"
    case "${file##*.}" in
        html)
            total=$(grep -c 'href=' "$file" 2>/dev/null || echo "unknown")
            ;;
        json)
            total=$(grep -c '"url"' "$file" 2>/dev/null || echo "unknown")
            ;;
        txt)
            total=$(wc -l < "$file" 2>/dev/null || echo "unknown")
            ;;
    esac
    
    echo "Progress Information:"
    echo "  Resume file: $resume_file"
    echo "  Current position: $position"
    echo "  Total estimated: $total"
    
    if [[ "$total" != "unknown" && "$position" -gt 0 ]]; then
        local percent=$((position * 100 / total))
        echo "  Progress: ${percent}%"
        local remaining=$((total - position))
        echo "  Remaining: $remaining items"
    fi
    
    local file_age=$(stat -c '%Y' "$resume_file" 2>/dev/null || stat -f '%m' "$resume_file" 2>/dev/null || echo "0")
    local current_time=$(date +%s)
    local age_hours=$(( (current_time - file_age) / 3600 ))
    echo "  Resume file age: ${age_hours} hours"
}

# Cleanup old resume files
cleanup_resume_files() {
    log "Cleaning up old resume files..."
    
    local count=0
    find . -name ".goku-*-progress*" -type f -mtime +7 2>/dev/null | while read -r file; do
        echo "Removing old resume file: $file"
        rm -f "$file"
        ((count++))
    done
    
    success "Cleanup completed"
}

# Parse arguments
RESUME_FILE=""
FORCE_RESTART="false"
SHOW_PROGRESS="false"
CLEANUP="false"
BULK_MODE="false"
WORKERS="5"
FETCH="false"
VERBOSE="false"
FILE=""
USER="goku"

while [[ $# -gt 0 ]]; do
    case $1 in
        -r|--resume-file)
            RESUME_FILE="$2"
            shift 2
            ;;
        -f|--force-restart)
            FORCE_RESTART="true"
            shift
            ;;
        -s|--show-progress)
            SHOW_PROGRESS="true"
            shift
            ;;
        -c|--cleanup)
            CLEANUP="true"
            shift
            ;;
        --bulk-mode)
            BULK_MODE="true"
            shift
            ;;
        -w|--workers)
            WORKERS="$2"
            shift 2
            ;;
        --fetch)
            FETCH="true"
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

# Handle cleanup mode
if [[ "$CLEANUP" == "true" ]]; then
    cleanup_resume_files
    exit 0
fi

# Validate arguments
if [[ -z "$FILE" && "$SHOW_PROGRESS" == "false" ]]; then
    error "File argument is required"
    show_help
    exit 1
fi

# List resume files if no specific operation
if [[ -z "$FILE" ]]; then
    list_resume_files
    exit 0
fi

if [[ ! -f "$FILE" ]]; then
    error "File not found: $FILE"
    exit 1
fi

if [[ ! -x "$GOKU_BIN" ]]; then
    error "Goku binary not found: $GOKU_BIN"
    exit 1
fi

# Generate resume file if not provided
if [[ -z "$RESUME_FILE" ]]; then
    RESUME_FILE=".goku-resumable-$(basename "$FILE")-${USER}.progress"
fi

# Show progress mode
if [[ "$SHOW_PROGRESS" == "true" ]]; then
    show_progress "$RESUME_FILE" "$FILE"
    exit 0
fi

# Check for existing resume file
if [[ -f "$RESUME_FILE" && "$FORCE_RESTART" == "false" ]]; then
    log "Resume file found: $RESUME_FILE"
    show_progress "$RESUME_FILE" "$FILE"
    echo
    read -p "Resume from this position? (Y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        log "Starting fresh import"
        rm -f "$RESUME_FILE"
    else
        log "Resuming import from last position"
    fi
elif [[ "$FORCE_RESTART" == "true" ]]; then
    log "Force restart requested - removing existing resume file"
    rm -f "$RESUME_FILE"
fi

# Build command
CMD=("$GOKU_BIN" "--user" "$USER" "import" "--file" "$FILE" "--workers" "$WORKERS")
CMD+=("--resume-file" "$RESUME_FILE")

if [[ "$BULK_MODE" == "true" ]]; then
    CMD+=("--bulk-mode")
fi

if [[ "$FETCH" == "true" ]]; then
    CMD+=("--fetch")
fi

# Display configuration
log "Resumable Import Configuration"
echo "================================"
echo "File:         $FILE"
echo "User:         $USER"
echo "Resume File:  $RESUME_FILE"
echo "Bulk Mode:    $BULK_MODE"
echo "Workers:      $WORKERS"
echo "Fetch:        $FETCH"
echo "================================"

# Monitor function
monitor_progress() {
    local resume_file="$1"
    local file="$2"
    
    while [[ -f "$resume_file" ]]; do
        if [[ -f "$resume_file" ]]; then
            show_progress "$resume_file" "$file"
            echo "--------------------------------"
        fi
        sleep 30
    done
}

# Start import
log "Starting resumable import..."
START_TIME=$(date +%s)

# Start monitoring in background if verbose
if [[ "$VERBOSE" == "true" ]]; then
    monitor_progress "$RESUME_FILE" "$FILE" &
    MONITOR_PID=$!
    trap 'kill $MONITOR_PID 2>/dev/null || true' EXIT
fi

set +e
"${CMD[@]}"
EXIT_CODE=$?
set -e

# Stop monitoring
if [[ "$VERBOSE" == "true" && -n "${MONITOR_PID:-}" ]]; then
    kill "$MONITOR_PID" 2>/dev/null || true
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "================================"
echo "Import completed in: ${DURATION}s"

if [[ $EXIT_CODE -eq 0 ]]; then
    success "Resumable import completed successfully!"
    if [[ -f "$RESUME_FILE" ]]; then
        rm -f "$RESUME_FILE"
        log "Resume file cleaned up"
    fi
else
    error "Import failed with exit code: $EXIT_CODE"
    if [[ -f "$RESUME_FILE" ]]; then
        warning "Resume file preserved: $RESUME_FILE"
        show_progress "$RESUME_FILE" "$FILE"
        warning "Run this script again to resume from this position"
    fi
    exit $EXIT_CODE
fi