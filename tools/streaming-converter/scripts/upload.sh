#!/bin/bash
# upload.sh - Upload processed videos to R2

source "$(dirname "$0")/config.sh"

upload_to_r2() {
    local input_dir="$1"
    local video_name="$2"
    
    # Use config variables
    local bucket_name="$R2_BUCKET_NAME"
    local remote_path="${R2_BASE_PATH}/${video_name}"
    
    # Validate rclone configuration
    if ! rclone listremotes | grep -q "^r2:"; then
        log "ERROR" "R2 remote not configured in rclone"
        log "INFO" "Please configure rclone with your R2 credentials first"
        return 1
    }

    local remote_dest="r2:${bucket_name}/${remote_path}"
    log "INFO" "Uploading files to $remote_dest..."
    
    # Upload files with proper content types
    rclone sync "$input_dir" "$remote_dest" \
        --progress \
        --transfers 4 \
        --checkers 8 \
        --contimeout 60s \
        --timeout 300s \
        --retries 3 \
        --low-level-retries 10 \
        --stats 1s \
        --metadata-set "Cache-Control=public,max-age=31536000" \
        --mime-type "video/MP2T:*.ts" \
        --mime-type "application/x-mpegURL:*.m3u8" \
        --mime-type "text/vtt:*.vtt"

    if [[ $? -eq 0 ]]; then
        log "INFO" "Upload completed successfully"
        log "INFO" "Base URL: https://${R2_DOMAIN}/${remote_path}"
        
        # Create success marker
        touch "${input_dir}/.r2_uploaded"
        
        return 0
    else
        log "ERROR" "Upload failed"
        return 1
    fi
}

# Main execution if script is run directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # Check if rclone is installed
    if ! command -v rclone &> /dev/null; then
        log "ERROR" "rclone is required but not installed."
        exit 1
    fi

    if [[ $# -lt 2 ]]; then
        echo "Usage: $0 <input_directory> <video_name>"
        exit 1
    fi

    upload_to_r2 "$1" "$2"
fi
