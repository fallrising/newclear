#!/bin/bash

# Goku CLI Enterprise Workflow Example
# Complete enterprise setup and workflow demonstration

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
Goku CLI Enterprise Workflow Example

USAGE:
    $0 [OPTIONS] [action]

DESCRIPTION:
    Demonstrates complete enterprise workflow including multi-user setup,
    bulk imports, MQTT integration, monitoring, and automated backups.

ACTIONS:
    setup           Setup enterprise environment
    import          Demonstrate bulk import workflow
    monitor         Show monitoring capabilities
    backup          Demonstrate backup procedures
    mqtt            Show MQTT integration
    all             Run complete workflow (default)

OPTIONS:
    --data-dir DIR          Enterprise data directory (default: ./enterprise-data)
    --mqtt-broker HOST      MQTT broker for integration (default: localhost)
    --sample-size SIZE      Number of sample bookmarks (default: 1000)
    --skip-setup           Skip initial setup
    --cleanup              Cleanup demo data
    -v, --verbose          Verbose output
    -h, --help             Show this help

ENTERPRISE FEATURES DEMONSTRATED:
    ✓ Multi-user profile isolation
    ✓ Bulk import optimization (100k+ bookmarks)
    ✓ Real-time MQTT event streaming
    ✓ Automated backup and retention
    ✓ Performance monitoring
    ✓ Security and access control
    ✓ Configuration management
    ✓ Disaster recovery procedures

EOF
}

# Create sample enterprise data
create_sample_data() {
    local size="$1"
    local output_file="$2"
    
    log "Creating sample dataset with $size bookmarks: $output_file"
    
    cat > "$output_file" << 'EOF'
[
EOF
    
    # Generate sample bookmarks
    for ((i=1; i<=size; i++)); do
        local url
        local title
        local tags
        
        # Vary the domains and content
        case $((i % 10)) in
            0) url="https://github.com/project$i"; title="GitHub Project $i"; tags="development,git,opensource" ;;
            1) url="https://stackoverflow.com/questions/$i"; title="Stack Overflow Question $i"; tags="programming,help,community" ;;
            2) url="https://docs.company.com/api/$i"; title="API Documentation $i"; tags="documentation,api,internal" ;;
            3) url="https://blog.tech.com/post/$i"; title="Tech Blog Post $i"; tags="blog,technology,news" ;;
            4) url="https://research.university.edu/paper/$i"; title="Research Paper $i"; tags="research,academic,science" ;;
            5) url="https://tools.devops.org/tool/$i"; title="DevOps Tool $i"; tags="devops,tools,infrastructure" ;;
            6) url="https://security.cert.gov/advisory/$i"; title="Security Advisory $i"; tags="security,vulnerability,alert" ;;
            7) url="https://compliance.legal.com/reg/$i"; title="Compliance Regulation $i"; tags="compliance,legal,governance" ;;
            8) url="https://monitoring.ops.net/metric/$i"; title="Monitoring Metric $i"; tags="monitoring,metrics,operations" ;;
            9) url="https://training.corp.edu/course/$i"; title="Training Course $i"; tags="training,education,corporate" ;;
        esac
        
        # Add bookmark to JSON
        cat >> "$output_file" << EOF
  {
    "type": "link",
    "url": "$url",
    "title": "$title",
    "tags": "$tags",
    "addDate": $((1700000000 + i * 3600))
  }EOF
        
        if [[ $i -lt $size ]]; then
            echo "," >> "$output_file"
        else
            echo >> "$output_file"
        fi
        
        # Progress indicator
        if [[ $((i % 100)) -eq 0 ]]; then
            echo -n "."
        fi
    done
    
    echo "]" >> "$output_file"
    echo
    success "Sample data created: $output_file"
}

# Setup enterprise environment
setup_enterprise() {
    local data_dir="$1"
    
    log "Setting up enterprise environment"
    
    # Create directory structure
    mkdir -p "$data_dir"/{databases,backups,configs,logs,monitoring}
    
    # Create enterprise users
    local users=("research" "development" "security" "compliance" "operations")
    
    for user in "${users[@]}"; do
        info "Setting up user: $user"
        
        # Initialize user profile
        if ! "$GOKU_BIN" --user "$user" list --limit 1 >/dev/null 2>&1; then
            "$GOKU_BIN" --user "$user" add --url "https://example.com/welcome" --title "Welcome to $user profile" --tags "welcome,setup" >/dev/null 2>&1
        fi
        
        # Create user-specific configuration
        cat > "$data_dir/configs/${user}-config.env" << EOF
# Enterprise configuration for user: $user
export GOKU_USER="$user"
export GOKU_DB_PATH_$(echo "$user" | tr '[:lower:]' '[:upper:]')="$data_dir/databases/${user}.db"
export GOKU_CACHE_DB_PATH_$(echo "$user" | tr '[:lower:]' '[:upper:]')="$data_dir/databases/${user}_cache.db"
export GOKU_LOG_FILE="$data_dir/logs/goku-${user}.log"
export GOKU_BACKUP_DIR="$data_dir/backups"

# Performance tuning for enterprise
export GOKU_BULK_MODE_THRESHOLD=1000
export GOKU_DEFAULT_DOMAIN_DELAY=2s
export GOKU_DEFAULT_TIMEOUT=30s
export GOKU_MAX_CONCURRENT_DOMAINS=5

# Security settings
export GOKU_ALLOW_INTERNAL_IPS=false
export GOKU_MAX_FILE_SIZE=500M
EOF
        
        # Move databases to enterprise directory
        if [[ -f "${user}.db" ]]; then
            mv "${user}.db" "$data_dir/databases/" 2>/dev/null || true
        fi
        if [[ -f "${user}_cache.db" ]]; then
            mv "${user}_cache.db" "$data_dir/databases/" 2>/dev/null || true
        fi
    done
    
    # Create master configuration
    cat > "$data_dir/configs/enterprise-master.env" << EOF
# Enterprise Master Configuration
export GOKU_ENTERPRISE_MODE=true
export GOKU_DATA_DIR="$data_dir"
export GOKU_BACKUP_RETENTION=30
export GOKU_MONITORING_ENABLED=true
export GOKU_AUDIT_LOG="$data_dir/logs/audit.log"

# Load all user configurations
for config in $data_dir/configs/*-config.env; do
    source "\$config"
done
EOF
    
    success "Enterprise environment setup completed"
    echo "Users created: ${users[*]}"
    echo "Data directory: $data_dir"
}

# Demonstrate bulk import
demo_bulk_import() {
    local data_dir="$1"
    local sample_size="$2"
    local mqtt_broker="$3"
    
    log "Demonstrating bulk import workflow"
    
    # Create sample data
    local sample_file="$data_dir/sample-enterprise-bookmarks.json"
    create_sample_data "$sample_size" "$sample_file"
    
    # Import to research user with bulk optimization
    info "Starting bulk import for research user..."
    
    local import_cmd=("$GOKU_BIN" "--user" "research" "import" "--file" "$sample_file")
    import_cmd+=("--bulk-mode" "--workers" "10")
    import_cmd+=("--domain-delay" "1s" "--fetch-timeout" "20s")
    import_cmd+=("--max-concurrent-domains" "8")
    import_cmd+=("--resume-file" "$data_dir/monitoring/research-import.progress")
    
    # Add MQTT if available
    if [[ -n "$mqtt_broker" ]]; then
        import_cmd+=("--mqtt-broker" "$mqtt_broker")
        import_cmd+=("--mqtt-topic" "enterprise/research/bookmarks")
        import_cmd+=("--mqtt-qos" "2")
    fi
    
    # Start import in background for monitoring
    "${import_cmd[@]}" &
    IMPORT_PID=$!
    
    # Monitor progress
    info "Monitoring import progress..."
    local start_time=$(date +%s)
    local last_position=0
    
    while kill -0 $IMPORT_PID 2>/dev/null; do
        if [[ -f "$data_dir/monitoring/research-import.progress" ]]; then
            local current_pos=$(cat "$data_dir/monitoring/research-import.progress" 2>/dev/null || echo "0")
            local now=$(date +%s)
            local elapsed=$((now - start_time))
            
            if [[ "$current_pos" -gt "$last_position" ]]; then
                local rate=$(( (current_pos - last_position) / 5 ))
                local percent=$((current_pos * 100 / sample_size))
                info "Progress: $current_pos/$sample_size (${percent}%) - Rate: ${rate}/sec"
                last_position=$current_pos
            fi
        fi
        sleep 5
    done
    
    wait $IMPORT_PID
    local exit_code=$?
    
    if [[ $exit_code -eq 0 ]]; then
        success "Bulk import completed successfully"
        
        # Show statistics
        info "Final statistics:"
        "$GOKU_BIN" --user "research" stats
    else
        error "Bulk import failed"
    fi
    
    # Cleanup progress file
    rm -f "$data_dir/monitoring/research-import.progress"
}

# Demonstrate monitoring
demo_monitoring() {
    local data_dir="$1"
    
    log "Demonstrating monitoring capabilities"
    
    # Create monitoring dashboard
    info "Creating monitoring dashboard..."
    
    cat > "$data_dir/monitoring/dashboard.html" << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Goku Enterprise Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .metric { display: inline-block; margin: 10px; padding: 15px; border: 1px solid #ccc; border-radius: 5px; }
        .metric h3 { margin: 0 0 10px 0; color: #333; }
        .metric .value { font-size: 24px; font-weight: bold; color: #007acc; }
        .status { padding: 5px 10px; border-radius: 3px; color: white; }
        .status.active { background-color: #28a745; }
        .status.idle { background-color: #6c757d; }
    </style>
    <meta http-equiv="refresh" content="30">
</head>
<body>
    <h1>Goku Enterprise Dashboard</h1>
    <div id="metrics">
        <!-- Metrics will be populated by monitoring script -->
    </div>
    <h2>Active Imports</h2>
    <div id="imports">
        <!-- Import status will be populated by monitoring script -->
    </div>
</body>
</html>
EOF
    
    # Generate metrics
    info "Collecting enterprise metrics..."
    
    local total_bookmarks=0
    local total_users=0
    local users=("research" "development" "security" "compliance" "operations")
    
    for user in "${users[@]}"; do
        if [[ -f "$data_dir/databases/${user}.db" ]]; then
            local user_count=$("$GOKU_BIN" --user "$user" list --limit 99999 2>/dev/null | grep -c "ID:" || echo "0")
            total_bookmarks=$((total_bookmarks + user_count))
            total_users=$((total_users + 1))
            info "User $user: $user_count bookmarks"
        fi
    done
    
    echo
    success "Enterprise Metrics Summary:"
    echo "  Total Users: $total_users"
    echo "  Total Bookmarks: $total_bookmarks"
    echo "  Average per User: $((total_bookmarks / total_users))"
    echo "  Dashboard: $data_dir/monitoring/dashboard.html"
}

# Demonstrate backup procedures
demo_backup() {
    local data_dir="$1"
    
    log "Demonstrating backup procedures"
    
    # Create backup script
    local backup_script="$data_dir/backups/enterprise-backup.sh"
    
    cat > "$backup_script" << EOF
#!/bin/bash
# Enterprise Backup Script

set -euo pipefail

BACKUP_DIR="$data_dir/backups"
RETENTION=7
TIMESTAMP=\$(date +%Y%m%d_%H%M%S)

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] \$1"
}

# Backup all enterprise data
log "Starting enterprise backup..."

# Create backup archive
BACKUP_FILE="\$BACKUP_DIR/enterprise-backup-\$TIMESTAMP.tar.gz"

tar -czf "\$BACKUP_FILE" \\
    "$data_dir/databases" \\
    "$data_dir/configs" \\
    "$data_dir/logs" \\
    2>/dev/null || true

if [[ -f "\$BACKUP_FILE" ]]; then
    SIZE=\$(du -h "\$BACKUP_FILE" | cut -f1)
    log "Backup created: \$(basename "\$BACKUP_FILE") (\$SIZE)"
    
    # Cleanup old backups
    find "\$BACKUP_DIR" -name "enterprise-backup-*.tar.gz" -mtime +\$RETENTION -delete
    log "Old backups cleaned up (retention: \$RETENTION days)"
else
    echo "ERROR: Backup failed" >&2
    exit 1
fi
EOF
    
    chmod +x "$backup_script"
    
    # Run backup
    info "Running enterprise backup..."
    "$backup_script"
    
    # Show backup files
    info "Available backups:"
    ls -lh "$data_dir/backups/"*.tar.gz 2>/dev/null | while read -r line; do
        echo "  $line"
    done || echo "  No backup files found"
    
    success "Backup demonstration completed"
}

# Demonstrate MQTT integration
demo_mqtt() {
    local mqtt_broker="$1"
    
    log "Demonstrating MQTT integration"
    
    if [[ -z "$mqtt_broker" ]]; then
        warning "No MQTT broker specified, skipping MQTT demo"
        return 0
    fi
    
    # Test MQTT connection
    if command -v mosquitto_pub >/dev/null 2>&1; then
        info "Testing MQTT connection to $mqtt_broker..."
        
        if mosquitto_pub -h "$mqtt_broker" -t "enterprise/goku/test" -m "connection test" 2>/dev/null; then
            success "MQTT connection successful"
            
            # Start MQTT monitor
            info "Starting MQTT event monitor (Ctrl+C to stop)..."
            timeout 10 mosquitto_sub -h "$mqtt_broker" -t "enterprise/+/+" 2>/dev/null | while read -r line; do
                info "MQTT Event: $line"
            done || true
            
        else
            warning "MQTT connection failed"
        fi
    else
        warning "mosquitto_pub not found, install mosquitto-clients for MQTT demo"
    fi
}

# Cleanup demo data
cleanup_demo() {
    local data_dir="$1"
    
    warning "Cleaning up demo data..."
    
    read -p "This will delete all demo data in $data_dir. Continue? (y/N): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$data_dir"
        
        # Remove user databases from current directory
        local users=("research" "development" "security" "compliance" "operations")
        for user in "${users[@]}"; do
            rm -f "${user}.db" "${user}_cache.db" 2>/dev/null || true
        done
        
        success "Demo data cleanup completed"
    else
        info "Cleanup cancelled"
    fi
}

# Main workflow
run_enterprise_workflow() {
    local action="$1"
    local data_dir="$2"
    local mqtt_broker="$3"
    local sample_size="$4"
    local skip_setup="$5"
    
    log "Starting Enterprise Workflow: $action"
    echo "================================"
    echo "Data Directory: $data_dir"
    echo "MQTT Broker: ${mqtt_broker:-"(none)"}"
    echo "Sample Size: $sample_size"
    echo "================================"
    
    case "$action" in
        "setup"|"all")
            if [[ "$skip_setup" == "false" ]]; then
                setup_enterprise "$data_dir"
            fi
            ;&
        "import")
            if [[ "$action" == "import" || "$action" == "all" ]]; then
                demo_bulk_import "$data_dir" "$sample_size" "$mqtt_broker"
            fi
            ;&
        "monitor")
            if [[ "$action" == "monitor" || "$action" == "all" ]]; then
                demo_monitoring "$data_dir"
            fi
            ;&
        "backup")
            if [[ "$action" == "backup" || "$action" == "all" ]]; then
                demo_backup "$data_dir"
            fi
            ;&
        "mqtt")
            if [[ "$action" == "mqtt" || "$action" == "all" ]]; then
                demo_mqtt "$mqtt_broker"
            fi
            ;;
        *)
            error "Unknown action: $action"
            exit 1
            ;;
    esac
    
    if [[ "$action" == "all" ]]; then
        echo
        success "Enterprise workflow demonstration completed!"
        echo
        echo "Summary of demonstrated features:"
        echo "✓ Multi-user profile isolation"
        echo "✓ Enterprise data directory structure"
        echo "✓ Bulk import optimization with monitoring"
        echo "✓ Real-time progress tracking"
        echo "✓ Automated backup procedures"
        echo "✓ Configuration management"
        if [[ -n "$mqtt_broker" ]]; then
            echo "✓ MQTT real-time event integration"
        fi
        echo
        echo "Enterprise data available in: $data_dir"
        echo "Load configuration: source $data_dir/configs/enterprise-master.env"
    fi
}

# Parse arguments
ACTION="all"
DATA_DIR="./enterprise-data"
MQTT_BROKER="localhost"
SAMPLE_SIZE="1000"
SKIP_SETUP="false"
CLEANUP="false"
VERBOSE="false"

while [[ $# -gt 0 ]]; do
    case $1 in
        --data-dir)
            DATA_DIR="$2"
            shift 2
            ;;
        --mqtt-broker)
            MQTT_BROKER="$2"
            shift 2
            ;;
        --sample-size)
            SAMPLE_SIZE="$2"
            shift 2
            ;;
        --skip-setup)
            SKIP_SETUP="true"
            shift
            ;;
        --cleanup)
            CLEANUP="true"
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
            ACTION="$1"
            shift
            ;;
    esac
done

# Validate action
if [[ ! "$ACTION" =~ ^(setup|import|monitor|backup|mqtt|all)$ ]]; then
    error "Invalid action: $ACTION"
    show_help
    exit 1
fi

# Check goku binary
if [[ ! -x "$GOKU_BIN" ]]; then
    error "Goku binary not found: $GOKU_BIN"
    exit 1
fi

# Cleanup mode
if [[ "$CLEANUP" == "true" ]]; then
    cleanup_demo "$DATA_DIR"
    exit 0
fi

# Run workflow
run_enterprise_workflow "$ACTION" "$DATA_DIR" "$MQTT_BROKER" "$SAMPLE_SIZE" "$SKIP_SETUP"