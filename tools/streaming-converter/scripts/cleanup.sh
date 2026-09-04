#!/bin/bash
# cleanup.sh - Maintenance script for processed videos

source "$(dirname "$0")/config.sh"

cleanup_old_segments() {
    local cutoff_date=$(date -d "$RETENTION_DAYS days ago" +%s)
    
    find "$PROCESSED_DIR" -name "*.ts" -type f | while read -r segment; do
        local segment_date=$(stat -c %Y "$segment")
        if (( segment_date < cutoff_date )); then
            log "INFO" "Removing old segment: $segment"
            rm "$segment"
        fi
    done
}

cleanup_unused_segments() {
    find "$PROCESSED_DIR" -name "playlist.m3u8" | while read -r playlist; do
        local dir=$(dirname "$playlist")
        local segments_dir="$dir/segments"
        
        # Get referenced segments
        local referenced_segments=$(grep -o '[0-9]\{3\}\.ts' "$playlist" | sort | uniq)
        
        # Remove unreferenced segments
        find "$segments_dir" -name "*.ts" | while read -r segment; do
            local segment_name=$(basename "$segment")
            if ! echo "$referenced_segments" | grep -q "$segment_name"; then
                log "INFO" "Removing unreferenced segment: $segment"
                rm "$segment"
            fi
        done
    done
}

# Main execution if script is run directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    log "INFO" "Starting cleanup process"
    cleanup_old_segments
    cleanup_unused_segments
    log "INFO" "Cleanup completed"
fi
