#!/bin/bash

# Goku CLI User Setup Script
# Initialize new user profiles with best practices

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
Goku CLI User Setup Script

USAGE:
    $0 [OPTIONS] <username>

DESCRIPTION:
    Initialize a new user profile with database setup, configuration,
    and optional sample data import.

ARGUMENTS:
    username        User profile name to create

OPTIONS:
    -d, --data-dir DIR         Custom data directory
    -s, --sample-data         Import sample bookmarks
    -c, --config-template     Create configuration template
    -b, --backup-config       Setup backup configuration
    --import-from FILE        Import bookmarks from file
    --mqtt-config             Setup MQTT configuration template
    -v, --verbose             Verbose output
    -h, --help                Show this help

FEATURES:
    - Database initialization and validation
    - Custom data directory setup
    - Configuration templates
    - Sample data import
    - Backup configuration
    - MQTT integration setup
    - Environment variable configuration

EXAMPLES:
    # Basic user setup
    $0 research

    # Setup with sample data
    $0 --sample-data personal

    # Setup with custom directory
    $0 -d /data/bookmarks work

    # Setup with import
    $0 --import-from bookmarks.html personal

    # Complete setup with all features
    $0 -s -c -b --mqtt-config enterprise

EOF
}

# Create sample bookmarks
create_sample_data() {
    local user="$1"
    
    log "Creating sample bookmarks for user: $user"
    
    # Development bookmarks
    "$GOKU_BIN" --user "$user" add --url "https://github.com" --title "GitHub" --tags "development,git,code"
    "$GOKU_BIN" --user "$user" add --url "https://stackoverflow.com" --title "Stack Overflow" --tags "development,programming,help"
    "$GOKU_BIN" --user "$user" add --url "https://golang.org" --title "Go Programming Language" --tags "programming,go,documentation"
    
    # Documentation
    "$GOKU_BIN" --user "$user" add --url "https://docs.docker.com" --title "Docker Documentation" --tags "docker,containers,documentation"
    "$GOKU_BIN" --user "$user" add --url "https://kubernetes.io/docs" --title "Kubernetes Documentation" --tags "kubernetes,containers,orchestration"
    
    # Learning resources
    "$GOKU_BIN" --user "$user" add --url "https://news.ycombinator.com" --title "Hacker News" --tags "news,technology,startup"
    "$GOKU_BIN" --user "$user" add --url "https://reddit.com/r/programming" --title "Programming Subreddit" --tags "programming,community,discussion"
    
    success "Sample bookmarks created"
}

# Create configuration template
create_config_template() {
    local user="$1"
    local data_dir="$2"
    
    local config_file="${user}-config.env"
    
    log "Creating configuration template: $config_file"
    
    cat > "$config_file" << EOF
# Goku CLI Configuration for user: $user
# Source this file: source $config_file

# User profile
export GOKU_USER="$user"

# Database paths
export GOKU_DB_PATH_$(echo "$user" | tr '[:lower:]' '[:upper:]')="$data_dir/${user}.db"
export GOKU_CACHE_DB_PATH_$(echo "$user" | tr '[:lower:]' '[:upper:]')="$data_dir/${user}_cache.db"

# Default settings
export GOKU_DEFAULT_WORKERS=5
export GOKU_DEFAULT_FETCH=true

# Logging
export GOKU_LOG_LEVEL=info
export GOKU_LOG_FILE="$data_dir/goku-${user}.log"

# Backup settings
export GOKU_BACKUP_DIR="$data_dir/backups"
export GOKU_BACKUP_RETENTION=30

# Performance tuning
export GOKU_BULK_MODE_THRESHOLD=1000
export GOKU_DEFAULT_DOMAIN_DELAY=2s
export GOKU_DEFAULT_TIMEOUT=30s

# Security
export GOKU_ALLOW_INTERNAL_IPS=false
export GOKU_MAX_FILE_SIZE=100M

EOF
    
    success "Configuration template created: $config_file"
    echo "Usage: source $config_file"
}

# Create MQTT configuration template
create_mqtt_config() {
    local user="$1"
    
    local mqtt_config="${user}-mqtt.env"
    
    log "Creating MQTT configuration template: $mqtt_config"
    
    cat > "$mqtt_config" << EOF
# MQTT Configuration for user: $user
# Source this file for MQTT operations: source $mqtt_config

# MQTT Broker settings
export GOKU_MQTT_BROKER="localhost"
export GOKU_MQTT_PORT=1883
export GOKU_MQTT_SSL=false

# Authentication (uncomment and set if needed)
# export GOKU_MQTT_USERNAME="your-username"
# export GOKU_MQTT_PASSWORD="your-password"

# Client settings
export GOKU_MQTT_CLIENT_ID="goku-${user}-\$(date +%s)"
export GOKU_MQTT_TOPIC="goku/${user}/bookmarks"
export GOKU_MQTT_QOS=1

# SSL/TLS settings (for secure connections)
# export GOKU_MQTT_CA_FILE="/path/to/ca.crt"
# export GOKU_MQTT_CERT_FILE="/path/to/client.crt"
# export GOKU_MQTT_KEY_FILE="/path/to/client.key"

# Usage examples:
# Import with MQTT:
# goku --user $user import --file bookmarks.html \\
#   --mqtt-broker \$GOKU_MQTT_BROKER \\
#   --mqtt-port \$GOKU_MQTT_PORT \\
#   --mqtt-topic \$GOKU_MQTT_TOPIC

EOF
    
    success "MQTT configuration template created: $mqtt_config"
    echo "Usage: source $mqtt_config"
}

# Create backup configuration
create_backup_config() {
    local user="$1"
    local data_dir="$2"
    
    local backup_script="${user}-backup.sh"
    
    log "Creating backup script: $backup_script"
    
    cat > "$backup_script" << 'EOF'
#!/bin/bash
# Automated backup script for user: $USER

set -euo pipefail

USER="$1"
BACKUP_DIR="${2:-$HOME/.goku/backups}"
RETENTION="${3:-7}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Main backup function
main() {
    log "Starting backup for user: $USER"
    
    # Run backup
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    BACKUP_SCRIPT="$SCRIPT_DIR/../export/backup-bookmarks.sh"
    
    if [[ -x "$BACKUP_SCRIPT" ]]; then
        "$BACKUP_SCRIPT" -d "$BACKUP_DIR" -k "$RETENTION" --verify "$USER"
    else
        log "Backup script not found, using basic backup"
        
        # Create backup directory
        mkdir -p "$BACKUP_DIR"
        
        # Create backup
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        BACKUP_FILE="$BACKUP_DIR/goku-backup-${USER}-${TIMESTAMP}.tar.gz"
        
        tar -czf "$BACKUP_FILE" "${USER}.db" "${USER}_cache.db" 2>/dev/null || true
        
        if [[ -f "$BACKUP_FILE" ]]; then
            SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
            success "Backup created: $(basename "$BACKUP_FILE") ($SIZE)"
        fi
    fi
}

main "$@"
EOF
    
    # Replace placeholder
    sed -i.bak "s/\$USER/$user/g" "$backup_script" && rm "$backup_script.bak"
    chmod +x "$backup_script"
    
    success "Backup script created: $backup_script"
    echo "Usage: ./$backup_script"
    
    # Create cron example
    local cron_example="${user}-cron.txt"
    cat > "$cron_example" << EOF
# Cron configuration for automated backups
# Add this to your crontab: crontab -e

# Daily backup at 2 AM
0 2 * * * $(pwd)/$backup_script

# Weekly backup with extended retention (Sundays at 3 AM)  
0 3 * * 0 $(pwd)/$backup_script $(pwd) 30

EOF
    
    log "Cron example created: $cron_example"
}

# Test user setup
test_user_setup() {
    local user="$1"
    
    log "Testing user setup: $user"
    
    # Test basic operations
    log "Testing basic operations..."
    
    # List (should work even with empty database)
    if ! "$GOKU_BIN" --user "$user" list --limit 1 >/dev/null 2>&1; then
        error "Basic list operation failed"
        return 1
    fi
    
    # Test add operation
    if ! "$GOKU_BIN" --user "$user" add --url "https://example.com" --title "Test Bookmark" >/dev/null 2>&1; then
        error "Add operation failed"
        return 1
    fi
    
    # Test search
    if ! "$GOKU_BIN" --user "$user" search --query "test" >/dev/null 2>&1; then
        error "Search operation failed"
        return 1
    fi
    
    # Test stats
    if ! "$GOKU_BIN" --user "$user" stats >/dev/null 2>&1; then
        error "Stats operation failed"
        return 1
    fi
    
    # Clean up test bookmark
    local test_id=$("$GOKU_BIN" --user "$user" search --query "example.com" | grep -o 'ID: [0-9]*' | head -1 | cut -d' ' -f2 || echo "")
    if [[ -n "$test_id" ]]; then
        "$GOKU_BIN" --user "$user" delete --id "$test_id" >/dev/null 2>&1 || true
    fi
    
    success "User setup test passed"
}

# Parse arguments
DATA_DIR=""
SAMPLE_DATA="false"
CONFIG_TEMPLATE="false"
BACKUP_CONFIG="false"
IMPORT_FILE=""
MQTT_CONFIG="false"
VERBOSE="false"
USERNAME=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--data-dir)
            DATA_DIR="$2"
            shift 2
            ;;
        -s|--sample-data)
            SAMPLE_DATA="true"
            shift
            ;;
        -c|--config-template)
            CONFIG_TEMPLATE="true"
            shift
            ;;
        -b|--backup-config)
            BACKUP_CONFIG="true"
            shift
            ;;
        --import-from)
            IMPORT_FILE="$2"
            shift 2
            ;;
        --mqtt-config)
            MQTT_CONFIG="true"
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
            if [[ -z "$USERNAME" ]]; then
                USERNAME="$1"
            else
                error "Too many arguments"
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate arguments
if [[ -z "$USERNAME" ]]; then
    error "Username is required"
    show_help
    exit 1
fi

if [[ ! "$USERNAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    error "Invalid username. Use only letters, numbers, underscore, and dash"
    exit 1
fi

if [[ ! -x "$GOKU_BIN" ]]; then
    error "Goku binary not found: $GOKU_BIN"
    exit 1
fi

# Set default data directory
if [[ -z "$DATA_DIR" ]]; then
    DATA_DIR="$(pwd)"
fi

# Validate import file
if [[ -n "$IMPORT_FILE" && ! -f "$IMPORT_FILE" ]]; then
    error "Import file not found: $IMPORT_FILE"
    exit 1
fi

# Create data directory
mkdir -p "$DATA_DIR"
if [[ ! -d "$DATA_DIR" ]]; then
    error "Cannot create data directory: $DATA_DIR"
    exit 1
fi

# Display configuration
log "User Setup Configuration"
echo "================================"
echo "Username:           $USERNAME"
echo "Data Directory:     $DATA_DIR"
echo "Sample Data:        $SAMPLE_DATA"
echo "Config Template:    $CONFIG_TEMPLATE"
echo "Backup Config:      $BACKUP_CONFIG"
echo "MQTT Config:        $MQTT_CONFIG"
echo "Import File:        ${IMPORT_FILE:-"(none)"}"
echo "================================"

# Check if user already exists
if [[ -f "$DATA_DIR/${USERNAME}.db" ]]; then
    warning "User profile already exists: $USERNAME"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log "Setup cancelled"
        exit 0
    fi
fi

# Start setup
log "Starting user setup for: $USERNAME"
START_TIME=$(date +%s)

# Initialize databases
log "Initializing databases..."
if ! "$GOKU_BIN" --user "$USERNAME" list --limit 1 >/dev/null 2>&1; then
    error "Failed to initialize user databases"
    exit 1
fi

success "Databases initialized"

# Import sample data
if [[ "$SAMPLE_DATA" == "true" ]]; then
    create_sample_data "$USERNAME"
fi

# Import from file
if [[ -n "$IMPORT_FILE" ]]; then
    log "Importing bookmarks from: $IMPORT_FILE"
    if "$GOKU_BIN" --user "$USERNAME" import --file "$IMPORT_FILE"; then
        success "Import completed"
    else
        warning "Import failed, but user setup continues"
    fi
fi

# Create configuration templates
if [[ "$CONFIG_TEMPLATE" == "true" ]]; then
    create_config_template "$USERNAME" "$DATA_DIR"
fi

if [[ "$MQTT_CONFIG" == "true" ]]; then
    create_mqtt_config "$USERNAME"
fi

if [[ "$BACKUP_CONFIG" == "true" ]]; then
    create_backup_config "$USERNAME" "$DATA_DIR"
fi

# Test setup
test_user_setup "$USERNAME"

# Final statistics
log "Final user statistics:"
"$GOKU_BIN" --user "$USERNAME" stats

# Summary
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "================================"
success "User setup completed in ${DURATION}s"

echo
echo "Next steps:"
echo "1. Start using: goku --user $USERNAME list"
if [[ "$CONFIG_TEMPLATE" == "true" ]]; then
    echo "2. Load config: source ${USERNAME}-config.env"
fi
if [[ "$BACKUP_CONFIG" == "true" ]]; then
    echo "3. Setup backups: ./${USERNAME}-backup.sh"
fi
if [[ "$MQTT_CONFIG" == "true" ]]; then
    echo "4. Configure MQTT: edit ${USERNAME}-mqtt.env"
fi
echo
echo "Database files created:"
echo "  ${DATA_DIR}/${USERNAME}.db"
echo "  ${DATA_DIR}/${USERNAME}_cache.db"