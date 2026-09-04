#!/bin/bash

# Goku CLI Backup Script
# Regular backup operations with compression and rotation

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOKU_BIN="${GOKU_BIN:-./bin/goku}"
DEFAULT_BACKUP_DIR="$HOME/.goku/backups"

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
Goku CLI Backup Script

USAGE:
    $0 [OPTIONS] [user]

DESCRIPTION:
    Create compressed backups of Goku bookmarks with automatic rotation and
    verification. Supports single user or all users backup.

ARGUMENTS:
    user            User profile to backup (default: all users)

OPTIONS:
    -d, --backup-dir DIR       Backup directory (default: $DEFAULT_BACKUP_DIR)
    -k, --keep NUM             Number of backups to keep (default: 7)
    -c, --compress LEVEL       Compression level 1-9 (default: 6)
    --all-users               Backup all user profiles
    --verify                  Verify backup integrity
    --no-compression          Disable compression
    --include-cache           Include cache database in backup
    --exclude-stats           Exclude statistics database
    -v, --verbose             Verbose output
    -q, --quiet               Quiet mode (errors only)
    -h, --help                Show this help

BACKUP FORMAT:
    Single user: goku-backup-{user}-{timestamp}.tar.gz
    All users:   goku-backup-all-{timestamp}.tar.gz

EXAMPLES:
    # Backup specific user
    $0 research

    # Backup all users
    $0 --all-users

    # Backup with custom location and retention
    $0 -d /backups/goku -k 30 --all-users

    # Quick backup without compression
    $0 --no-compression personal

    # Backup with verification
    $0 --verify research

EOF
}

# Get all user profiles
get_user_profiles() {
    local profiles=()
    
    # Look for database files
    for db in *.db; do
        if [[ -f "$db" && "$db" != *"_cache.db" && "$db" != *"_stats.db" ]]; then
            local user="${db%.db}"
            profiles+=("$user")
        fi
    done
    
    # Remove duplicates and sort
    printf '%s\n' "${profiles[@]}" | sort -u
}

# Get database files for user
get_user_files() {
    local user="$1"
    local include_cache="$2"
    local exclude_stats="$3"
    
    local files=()
    
    # Main database
    if [[ -f "${user}.db" ]]; then
        files+=("${user}.db")
    fi
    
    # Cache database
    if [[ "$include_cache" == "true" && -f "${user}_cache.db" ]]; then
        files+=("${user}_cache.db")
    fi
    
    # Stats database
    if [[ "$exclude_stats" == "false" && -f "${user}_stats.db" ]]; then
        files+=("${user}_stats.db")
    fi
    
    printf '%s\n' "${files[@]}"
}

# Verify backup
verify_backup() {
    local backup_file="$1"
    
    log "Verifying backup: $backup_file"
    
    if [[ ! -f "$backup_file" ]]; then
        error "Backup file not found: $backup_file"
        return 1
    fi
    
    # Test archive integrity
    if [[ "$backup_file" == *.tar.gz ]]; then
        if ! tar -tzf "$backup_file" >/dev/null 2>&1; then
            error "Backup archive is corrupted"
            return 1
        fi
    elif [[ "$backup_file" == *.tar ]]; then
        if ! tar -tf "$backup_file" >/dev/null 2>&1; then
            error "Backup archive is corrupted"
            return 1
        fi
    fi
    
    # Check file size
    local size=$(du -h "$backup_file" | cut -f1)
    log "Backup size: $size"
    
    # List contents
    if [[ "$VERBOSE" == "true" ]]; then
        log "Backup contents:"
        if [[ "$backup_file" == *.tar.gz ]]; then
            tar -tzf "$backup_file" | sed 's/^/  /'
        else
            tar -tf "$backup_file" | sed 's/^/  /'
        fi
    fi
    
    success "Backup verification passed"
    return 0
}

# Cleanup old backups
cleanup_backups() {
    local backup_dir="$1"
    local keep="$2"
    local pattern="$3"
    
    log "Cleaning up old backups (keeping $keep)"
    
    # Find and sort backups by date
    local backups=()
    while IFS= read -r -d '' file; do
        backups+=("$file")
    done < <(find "$backup_dir" -name "$pattern" -type f -print0 | sort -z)
    
    local count=${#backups[@]}
    if [[ $count -le $keep ]]; then
        log "Found $count backups, all within retention limit"
        return 0
    fi
    
    local to_remove=$((count - keep))
    log "Found $count backups, removing oldest $to_remove"
    
    for ((i=0; i<to_remove; i++)); do
        local file="${backups[$i]}"
        log "Removing old backup: $(basename "$file")"
        rm -f "$file"
    done
    
    success "Cleanup completed"
}

# Create backup for user
backup_user() {
    local user="$1"
    local backup_dir="$2"
    local compress="$3"
    local compression_level="$4"
    local include_cache="$5"
    local exclude_stats="$6"
    local verify="$7"
    
    log "Creating backup for user: $user"
    
    # Get files to backup
    local files=()
    while IFS= read -r line; do
        [[ -n "$line" ]] && files+=("$line")
    done < <(get_user_files "$user" "$include_cache" "$exclude_stats")
    
    if [[ ${#files[@]} -eq 0 ]]; then
        warning "No database files found for user: $user"
        return 1
    fi
    
    # Create backup filename
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_name="goku-backup-${user}-${timestamp}"
    local backup_file="$backup_dir/$backup_name"
    
    if [[ "$compress" == "true" ]]; then
        backup_file="${backup_file}.tar.gz"
    else
        backup_file="${backup_file}.tar"
    fi
    
    # Create backup
    log "Files to backup: ${files[*]}"
    log "Backup file: $backup_file"
    
    if [[ "$compress" == "true" ]]; then
        tar -czf "$backup_file" --level="$compression_level" "${files[@]}"
    else
        tar -cf "$backup_file" "${files[@]}"
    fi
    
    if [[ ! -f "$backup_file" ]]; then
        error "Failed to create backup file"
        return 1
    fi
    
    # Verify if requested
    if [[ "$verify" == "true" ]]; then
        if ! verify_backup "$backup_file"; then
            error "Backup verification failed"
            return 1
        fi
    fi
    
    local size=$(du -h "$backup_file" | cut -f1)
    success "Backup created: $(basename "$backup_file") ($size)"
    
    echo "$backup_file"
}

# Parse arguments
BACKUP_DIR="$DEFAULT_BACKUP_DIR"
KEEP="7"
COMPRESSION_LEVEL="6"
ALL_USERS="false"
VERIFY="false"
COMPRESS="true"
INCLUDE_CACHE="false"
EXCLUDE_STATS="false"
VERBOSE="false"
QUIET="false"
USER=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--backup-dir)
            BACKUP_DIR="$2"
            shift 2
            ;;
        -k|--keep)
            KEEP="$2"
            shift 2
            ;;
        -c|--compress)
            COMPRESSION_LEVEL="$2"
            shift 2
            ;;
        --all-users)
            ALL_USERS="true"
            shift
            ;;
        --verify)
            VERIFY="true"
            shift
            ;;
        --no-compression)
            COMPRESS="false"
            shift
            ;;
        --include-cache)
            INCLUDE_CACHE="true"
            shift
            ;;
        --exclude-stats)
            EXCLUDE_STATS="true"
            shift
            ;;
        -v|--verbose)
            VERBOSE="true"
            shift
            ;;
        -q|--quiet)
            QUIET="true"
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
            if [[ -z "$USER" ]]; then
                USER="$1"
            else
                error "Too many arguments"
                exit 1
            fi
            shift
            ;;
    esac
done

# Quiet mode
if [[ "$QUIET" == "true" ]]; then
    exec >/dev/null
fi

# Check goku binary
if [[ ! -x "$GOKU_BIN" ]]; then
    error "Goku binary not found: $GOKU_BIN"
    exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"
if [[ ! -d "$BACKUP_DIR" ]]; then
    error "Cannot create backup directory: $BACKUP_DIR"
    exit 1
fi

# Determine users to backup
users=()
if [[ "$ALL_USERS" == "true" ]]; then
    while IFS= read -r user; do
        [[ -n "$user" ]] && users+=("$user")
    done < <(get_user_profiles)
    
    if [[ ${#users[@]} -eq 0 ]]; then
        warning "No user profiles found"
        exit 1
    fi
    
    log "Found ${#users[@]} user profiles: ${users[*]}"
elif [[ -n "$USER" ]]; then
    users=("$USER")
else
    error "No user specified (use --all-users or specify a user)"
    show_help
    exit 1
fi

# Start backup process
log "Starting backup process"
echo "Backup directory: $BACKUP_DIR"
echo "Retention: $KEEP backups"
echo "Compression: $COMPRESS (level $COMPRESSION_LEVEL)"
echo "Include cache: $INCLUDE_CACHE"
echo "Exclude stats: $EXCLUDE_STATS"
echo "Verify: $VERIFY"
echo "Users: ${users[*]}"
echo "================================"

START_TIME=$(date +%s)
successful_backups=()
failed_backups=()

# Backup each user
for user in "${users[@]}"; do
    if backup_file=$(backup_user "$user" "$BACKUP_DIR" "$COMPRESS" "$COMPRESSION_LEVEL" "$INCLUDE_CACHE" "$EXCLUDE_STATS" "$VERIFY"); then
        successful_backups+=("$backup_file")
    else
        failed_backups+=("$user")
    fi
done

# Cleanup old backups
if [[ ${#successful_backups[@]} -gt 0 ]]; then
    if [[ "$ALL_USERS" == "true" ]]; then
        cleanup_backups "$BACKUP_DIR" "$KEEP" "goku-backup-*"
    else
        for user in "${users[@]}"; do
            cleanup_backups "$BACKUP_DIR" "$KEEP" "goku-backup-${user}-*"
        done
    fi
fi

# Summary
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "================================"
echo "Backup Summary:"
echo "  Duration: ${DURATION}s"
echo "  Successful: ${#successful_backups[@]}"
echo "  Failed: ${#failed_backups[@]}"

if [[ ${#successful_backups[@]} -gt 0 ]]; then
    echo "  Backup files:"
    for file in "${successful_backups[@]}"; do
        local size=$(du -h "$file" | cut -f1)
        echo "    $(basename "$file") ($size)"
    done
fi

if [[ ${#failed_backups[@]} -gt 0 ]]; then
    echo "  Failed users:"
    for user in "${failed_backups[@]}"; do
        echo "    $user"
    done
fi

if [[ ${#failed_backups[@]} -eq 0 ]]; then
    success "All backups completed successfully"
    exit 0
else
    error "Some backups failed"
    exit 1
fi