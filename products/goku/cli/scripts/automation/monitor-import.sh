#!/bin/bash

# Goku CLI Import Monitor Script
# Real-time monitoring of import operations with progress tracking

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOKU_BIN="${GOKU_BIN:-./bin/goku}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
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

info() {
    echo -e "${CYAN}[INFO]${NC} $1"
}

show_help() {
    cat << EOF
Goku CLI Import Monitor Script

USAGE:
    $0 [OPTIONS]

DESCRIPTION:
    Monitor active import operations with real-time progress tracking,
    performance metrics, and automated notifications.

OPTIONS:
    -u, --user USER           Monitor specific user (default: all users)
    -r, --resume-files DIR    Directory to watch for resume files (default: current)
    -i, --interval SECONDS    Update interval (default: 5)
    -l, --log-file FILE       Log file to monitor (default: goku.log)
    --mqtt-monitor HOST       Monitor MQTT events from broker
    --mqtt-port PORT          MQTT broker port (default: 1883)
    --mqtt-topic TOPIC        MQTT topic to monitor (default: goku/+/+)
    --alert-webhook URL       Webhook URL for alerts
    --alert-email EMAIL       Email for notifications
    --dashboard               Launch interactive dashboard
    --export-metrics FILE     Export metrics to file
    -v, --verbose             Verbose output
    -h, --help                Show this help

FEATURES:
    - Real-time progress tracking
    - Performance metrics (rate, ETA)
    - Resume file monitoring
    - MQTT event monitoring
    - Error detection and alerting
    - Interactive dashboard
    - Metrics export

EXAMPLES:
    # Basic monitoring
    $0

    # Monitor specific user
    $0 --user research

    # Monitor with MQTT events
    $0 --mqtt-monitor localhost

    # Interactive dashboard
    $0 --dashboard

    # Monitor with alerts
    $0 --alert-webhook http://alerts.company.com/webhook

EOF
}

# Parse resume file
parse_resume_file() {
    local file="$1"
    local position
    
    if [[ -f "$file" ]]; then
        position=$(cat "$file" 2>/dev/null || echo "0")
        echo "$position"
    else
        echo "0"
    fi
}

# Calculate progress statistics
calculate_stats() {
    local current="$1"
    local total="$2"
    local start_time="$3"
    local last_position="$4"
    local last_time="$5"
    
    local now=$(date +%s)
    local elapsed=$((now - start_time))
    local recent_elapsed=$((now - last_time))
    
    local percent=0
    local rate=0
    local recent_rate=0
    local eta="unknown"
    
    if [[ "$total" -gt 0 ]]; then
        percent=$((current * 100 / total))
    fi
    
    if [[ "$elapsed" -gt 0 ]]; then
        rate=$((current / elapsed))
    fi
    
    if [[ "$recent_elapsed" -gt 0 && "$current" -gt "$last_position" ]]; then
        recent_rate=$(( (current - last_position) / recent_elapsed ))
    fi
    
    if [[ "$recent_rate" -gt 0 && "$total" -gt "$current" ]]; then
        local remaining=$((total - current))
        local eta_seconds=$((remaining / recent_rate))
        eta=$(printf "%02d:%02d:%02d" $((eta_seconds/3600)) $(((eta_seconds%3600)/60)) $((eta_seconds%60)))
    fi
    
    echo "$percent,$rate,$recent_rate,$eta"
}

# Monitor resume files
monitor_resume_files() {
    local user="$1"
    local resume_dir="$2"
    local interval="$3"
    
    local tracked_files=()
    local file_stats=()
    
    log "Monitoring resume files in: $resume_dir"
    
    while true; do
        # Find resume files
        local current_files=()
        if [[ -n "$user" ]]; then
            while IFS= read -r -d '' file; do
                current_files+=("$file")
            done < <(find "$resume_dir" -name ".goku-*-${user}.progress" -type f -print0 2>/dev/null || true)
        else
            while IFS= read -r -d '' file; do
                current_files+=("$file")
            done < <(find "$resume_dir" -name ".goku-*.progress" -type f -print0 2>/dev/null || true)
        fi
        
        # Process each file
        for file in "${current_files[@]}"; do
            local basename=$(basename "$file")
            local position=$(parse_resume_file "$file")
            local now=$(date +%s)
            
            # Check if this is a new file
            local found=false
            for ((i=0; i<${#tracked_files[@]}; i++)); do
                if [[ "${tracked_files[$i]}" == "$basename" ]]; then
                    found=true
                    
                    # Update existing tracking
                    local old_stats="${file_stats[$i]}"
                    IFS=',' read -r start_time last_pos last_time total <<< "$old_stats"
                    
                    if [[ "$position" != "$last_pos" ]]; then
                        # Progress detected
                        local stats=$(calculate_stats "$position" "$total" "$start_time" "$last_pos" "$last_time")
                        IFS=',' read -r percent rate recent_rate eta <<< "$stats"
                        
                        info "Progress: $basename"
                        echo "  Position: $position/$total (${percent}%)"
                        echo "  Rate: ${recent_rate}/sec (avg: ${rate}/sec)"
                        echo "  ETA: $eta"
                        
                        # Update stats
                        file_stats[$i]="$start_time,$position,$now,$total"
                    fi
                    break
                fi
            done
            
            # New file detected
            if [[ "$found" == "false" ]]; then
                log "New import detected: $basename"
                
                # Estimate total from filename or file analysis
                local total=1000  # Default estimate
                if [[ "$basename" =~ \.json ]]; then
                    local json_file="${basename%%.progress}"
                    if [[ -f "$json_file" ]]; then
                        total=$(grep -c '"url"' "$json_file" 2>/dev/null || echo "1000")
                    fi
                elif [[ "$basename" =~ \.html ]]; then
                    local html_file="${basename%%.progress}"
                    if [[ -f "$html_file" ]]; then
                        total=$(grep -c 'href=' "$html_file" 2>/dev/null || echo "1000")
                    fi
                fi
                
                tracked_files+=("$basename")
                file_stats+=("$now,$position,$now,$total")
                
                echo "  Estimated total: $total"
                echo "  Starting position: $position"
            fi
        done
        
        # Remove completed files from tracking
        local new_tracked=()
        local new_stats=()
        for ((i=0; i<${#tracked_files[@]}; i++)); do
            local file="${tracked_files[$i]}"
            local full_path="$resume_dir/$file"
            
            if [[ -f "$full_path" ]]; then
                new_tracked+=("$file")
                new_stats+=("${file_stats[$i]}")
            else
                success "Import completed: $file"
            fi
        done
        
        tracked_files=("${new_tracked[@]}")
        file_stats=("${new_stats[@]}")
        
        sleep "$interval"
    done
}

# Monitor MQTT events
monitor_mqtt() {
    local broker="$1"
    local port="$2"
    local topic="$3"
    
    log "Monitoring MQTT events: $broker:$port ($topic)"
    
    if ! command -v mosquitto_sub >/dev/null 2>&1; then
        error "mosquitto_sub not found. Install mosquitto-clients package"
        return 1
    fi
    
    mosquitto_sub -h "$broker" -p "$port" -t "$topic" | while read -r line; do
        # Parse MQTT message
        local timestamp=$(date +'%Y-%m-%d %H:%M:%S')
        info "MQTT: $line"
        
        # Extract event type if JSON
        if echo "$line" | jq . >/dev/null 2>&1; then
            local event_type=$(echo "$line" | jq -r '.type // "unknown"')
            local bookmark_url=$(echo "$line" | jq -r '.bookmark.url // "unknown"')
            
            case "$event_type" in
                "imported")
                    echo "  ✓ Imported: $bookmark_url"
                    ;;
                "error")
                    echo "  ✗ Error: $bookmark_url"
                    ;;
                "status")
                    local status=$(echo "$line" | jq -r '.status // "unknown"')
                    echo "  Status: $status"
                    ;;
            esac
        fi
    done
}

# Monitor log file
monitor_log_file() {
    local log_file="$1"
    local user="$2"
    
    if [[ ! -f "$log_file" ]]; then
        warning "Log file not found: $log_file"
        return 1
    fi
    
    log "Monitoring log file: $log_file"
    
    tail -f "$log_file" | while read -r line; do
        # Filter by user if specified
        if [[ -n "$user" && ! "$line" =~ $user ]]; then
            continue
        fi
        
        # Parse different log types
        if [[ "$line" =~ "Starting Import" ]]; then
            info "Import started: $(echo "$line" | cut -d' ' -f4-)"
        elif [[ "$line" =~ "Import summary" ]]; then
            success "Import completed: $(echo "$line" | cut -d' ' -f4-)"
        elif [[ "$line" =~ "ERROR" ]]; then
            error "$(echo "$line" | cut -d' ' -f4-)"
        elif [[ "$line" =~ "Progress:" ]]; then
            info "$(echo "$line" | cut -d' ' -f4-)"
        fi
    done
}

# Interactive dashboard
launch_dashboard() {
    local user="$1"
    local resume_dir="$2"
    
    log "Launching interactive dashboard..."
    
    # Clear screen and hide cursor
    clear
    tput civis
    
    # Trap to restore cursor on exit
    trap 'tput cnorm; exit' INT TERM EXIT
    
    while true; do
        # Clear screen and move to top
        tput cup 0 0
        
        # Header
        echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
        echo -e "${BLUE}               Goku CLI Import Monitor Dashboard               ${NC}"
        echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
        echo
        
        # Current time
        echo -e "${CYAN}Current Time:${NC} $(date)"
        echo -e "${CYAN}Monitoring:${NC} ${user:-"All users"}"
        echo
        
        # Find active imports
        local active_imports=()
        if [[ -n "$user" ]]; then
            while IFS= read -r -d '' file; do
                active_imports+=("$file")
            done < <(find "$resume_dir" -name ".goku-*-${user}.progress" -type f -print0 2>/dev/null || true)
        else
            while IFS= read -r -d '' file; do
                active_imports+=("$file")
            done < <(find "$resume_dir" -name ".goku-*.progress" -type f -print0 2>/dev/null || true)
        fi
        
        if [[ ${#active_imports[@]} -eq 0 ]]; then
            echo -e "${YELLOW}No active imports detected${NC}"
            echo
            echo "Looking for resume files matching: .goku-*.progress"
            echo "Resume directory: $resume_dir"
        else
            echo -e "${GREEN}Active Imports: ${#active_imports[@]}${NC}"
            echo
            
            for file in "${active_imports[@]}"; do
                local basename=$(basename "$file")
                local position=$(parse_resume_file "$file")
                local file_age=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null || echo "0")
                local now=$(date +%s)
                local age=$((now - file_age))
                
                echo -e "${CYAN}Import:${NC} $basename"
                echo -e "  Position: $position"
                echo -e "  Last update: ${age}s ago"
                
                # Check if stalled
                if [[ $age -gt 60 ]]; then
                    echo -e "  ${YELLOW}Status: Possibly stalled${NC}"
                else
                    echo -e "  ${GREEN}Status: Active${NC}"
                fi
                echo
            done
        fi
        
        # System info
        echo -e "${BLUE}System Information:${NC}"
        echo -e "  Load: $(uptime | awk -F'load average:' '{print $2}' | sed 's/^ *//')"
        echo -e "  Memory: $(free -h 2>/dev/null | grep '^Mem:' | awk '{print $3 "/" $2}' || echo 'N/A')"
        echo -e "  Disk: $(df -h . | tail -1 | awk '{print $3 "/" $2 " (" $5 " used)"}')"
        echo
        
        echo -e "${YELLOW}Press Ctrl+C to exit${NC}"
        
        # Update every 2 seconds
        sleep 2
    done
}

# Send alert
send_alert() {
    local message="$1"
    local webhook_url="$2"
    local email="$3"
    
    # Webhook alert
    if [[ -n "$webhook_url" ]]; then
        local payload="{\"text\":\"Goku Import Alert: $message\",\"timestamp\":\"$(date -Iseconds)\"}"
        curl -s -X POST -H "Content-Type: application/json" -d "$payload" "$webhook_url" >/dev/null 2>&1 || true
    fi
    
    # Email alert
    if [[ -n "$email" ]]; then
        echo "Goku Import Alert: $message" | mail -s "Goku Import Alert" "$email" 2>/dev/null || true
    fi
}

# Parse arguments
USER=""
RESUME_DIR="."
INTERVAL="5"
LOG_FILE="goku.log"
MQTT_BROKER=""
MQTT_PORT="1883"
MQTT_TOPIC="goku/+/+"
ALERT_WEBHOOK=""
ALERT_EMAIL=""
DASHBOARD="false"
EXPORT_METRICS=""
VERBOSE="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--user)
            USER="$2"
            shift 2
            ;;
        -r|--resume-files)
            RESUME_DIR="$2"
            shift 2
            ;;
        -i|--interval)
            INTERVAL="$2"
            shift 2
            ;;
        -l|--log-file)
            LOG_FILE="$2"
            shift 2
            ;;
        --mqtt-monitor)
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
        --alert-webhook)
            ALERT_WEBHOOK="$2"
            shift 2
            ;;
        --alert-email)
            ALERT_EMAIL="$2"
            shift 2
            ;;
        --dashboard)
            DASHBOARD="true"
            shift
            ;;
        --export-metrics)
            EXPORT_METRICS="$2"
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
            error "Unexpected argument: $1"
            exit 1
            ;;
    esac
done

# Validate resume directory
if [[ ! -d "$RESUME_DIR" ]]; then
    error "Resume directory not found: $RESUME_DIR"
    exit 1
fi

# Display configuration
log "Import Monitor Configuration"
echo "================================"
echo "User Filter:      ${USER:-"All users"}"
echo "Resume Directory: $RESUME_DIR"
echo "Update Interval:  ${INTERVAL}s"
echo "Log File:         $LOG_FILE"
if [[ -n "$MQTT_BROKER" ]]; then
    echo "MQTT Broker:      $MQTT_BROKER:$MQTT_PORT"
    echo "MQTT Topic:       $MQTT_TOPIC"
fi
if [[ -n "$ALERT_WEBHOOK" ]]; then
    echo "Alert Webhook:    $ALERT_WEBHOOK"
fi
if [[ -n "$ALERT_EMAIL" ]]; then
    echo "Alert Email:      $ALERT_EMAIL"
fi
echo "Dashboard Mode:   $DASHBOARD"
echo "================================"

# Launch appropriate monitor
if [[ "$DASHBOARD" == "true" ]]; then
    launch_dashboard "$USER" "$RESUME_DIR"
elif [[ -n "$MQTT_BROKER" ]]; then
    # MQTT monitoring
    monitor_mqtt "$MQTT_BROKER" "$MQTT_PORT" "$MQTT_TOPIC" &
    MQTT_PID=$!
    
    # Resume file monitoring
    monitor_resume_files "$USER" "$RESUME_DIR" "$INTERVAL" &
    RESUME_PID=$!
    
    trap 'kill $MQTT_PID $RESUME_PID 2>/dev/null || true' EXIT
    
    log "Monitoring MQTT and resume files (Ctrl+C to stop)"
    wait
else
    # Resume file monitoring only
    if [[ -f "$LOG_FILE" ]]; then
        monitor_log_file "$LOG_FILE" "$USER" &
        LOG_PID=$!
        trap 'kill $LOG_PID 2>/dev/null || true' EXIT
    fi
    
    monitor_resume_files "$USER" "$RESUME_DIR" "$INTERVAL"
fi