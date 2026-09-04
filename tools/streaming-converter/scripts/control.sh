#!/bin/bash
# control.sh - Main control script for video processing system

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

process_video() {
    local input_file="$1"
    local basename=$(basename "${input_file%.*}")
    local output_dir="$PROCESSED_DIR/$basename"
    local failed_marker="$PROCESSED_DIR/.${basename}.failed"

    # Skip if a failed marker exists
    if [[ -f "$failed_marker" ]]; then
        log "WARNING" "Skipping failed video: $basename (already marked as failed)"
        return 1
    fi

    log "INFO" "Starting video processing pipeline..."

    # Step 1: Validate video
    log "INFO" "Step 1: Validating video..."
    if ! "$SCRIPT_DIR/validate.sh" "$input_file"; then
        log "ERROR" "Validation failed. Aborting."
        touch "$failed_marker"
        return 1
    fi

    # Step 2: Convert to HLS
    log "INFO" "Step 2: Converting to HLS..."
    if ! "$SCRIPT_DIR/convert.sh" "$input_file" "$output_dir"; then
        log "ERROR" "Conversion failed. Aborting."
        touch "$failed_marker"
        return 1
    fi

    # Step 3: Upload to R2 if enabled
    if [[ "$USE_R2" == "true" ]]; then
        log "INFO" "Step 3: Uploading to R2..."
        if ! "$SCRIPT_DIR/upload.sh" "$output_dir" "$basename"; then
            log "WARNING" "R2 upload failed, but local files are available"
        fi
    fi

    log "INFO" "Processing completed successfully!"
    return 0
}

watch_directory() {
    log "INFO" "Watching upload directory for new videos..."
    
    while true; do
        for file in "$UPLOAD_DIR"/*; do
            if [[ -f "$file" ]]; then
                local basename=$(basename "$file")
                local processed_marker="$PROCESSED_DIR/.${basename}.processed"
                
                if [[ ! -f "$processed_marker" ]]; then
                    log "INFO" "Found new file: $basename"
                    
                    if process_video "$file"; then
                        touch "$processed_marker"
                        log "INFO" "Successfully processed: $basename"
                        # Optionally remove original file after successful processing
                        # rm "$file"
                    else
                        log "ERROR" "Failed to process: $basename"
                    fi
                fi
            fi
        done
        sleep 10
    done
}

list_videos() {
    echo "Processed Videos:"
    echo "----------------"
    
    for dir in "$PROCESSED_DIR"/*; do
        if [[ -d "$dir" ]]; then
            local name=$(basename "$dir")
            local master_playlist="$dir/master.m3u8"
            
            if [[ -f "$master_playlist" ]]; then
                local qualities=$(grep RESOLUTION "$master_playlist" | wc -l)
                local r2_status=""
                if [[ -f "$dir/.r2_uploaded" ]]; then
                    r2_status=" (R2 uploaded)"
                fi
                echo "- $name ($qualities quality levels)$r2_status"
            fi
        fi
    done
}

show_status() {
    echo "System Status:"
    echo "--------------"
    echo "Upload Directory: $UPLOAD_DIR"
    echo "Processed Directory: $PROCESSED_DIR"
    echo "Web Directory: $WWW_DIR"
    
    echo
    echo "Storage Usage:"
    df -h "$BASE_DIR"
    
    echo
    echo "Recent Conversions:"
    tail -n 5 "$LOG_DIR/conversion.log"
    
    echo
    echo "R2 Upload Status: $USE_R2"
    if [[ "$USE_R2" == "true" ]]; then
        echo "R2 Bucket: $R2_BUCKET_NAME"
        echo "R2 Domain: $R2_DOMAIN"
    fi
}

upload_to_r2_manual() {
    local video_name="$1"
    local video_dir="$PROCESSED_DIR/$video_name"
    
    if [[ ! -d "$video_dir" ]]; then
        log "ERROR" "Video directory not found: $video_dir"
        return 1
    fi
    
    "$SCRIPT_DIR/upload.sh" "$video_dir" "$video_name"
}

show_help() {
    echo "Video Processing System Control Script"
    echo
    echo "Usage: $0 [command] [options]"
    echo
    echo "Commands:"
    echo "  watch     - Watch upload directory for new videos"
    echo "  convert   - Convert a specific video"
    echo "  cleanup   - Run cleanup routine"
    echo "  list      - List all processed videos"
    echo "  status    - Show system status"
    echo "  upload    - Upload processed video to R2"
    echo "  help      - Show this help message"
    echo
    echo "Options:"
    echo "  -f, --file     - Specify input file (for convert command)"
    echo "  -a, --all      - Process all files in upload directory"
    echo "  -r, --r2       - Force R2 upload regardless of config setting"
    echo
    echo "Examples:"
    echo "  $0 watch                    - Watch for new videos"
    echo "  $0 convert -f video.mp4     - Convert specific video"
    echo "  $0 convert -a               - Convert all new videos"
    echo "  $0 upload video_name        - Upload to R2"
}

check_dependencies() {
    local missing_deps=()
    
    for cmd in ffmpeg ffprobe jq bc; do
        if ! command -v "$cmd" &> /dev/null; then
            missing_deps+=("$cmd")
        fi
    done
    
    if [[ "$USE_R2" == "true" ]] && ! command -v rclone &> /dev/null; then
        missing_deps+=("rclone")
    fi
    
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log "ERROR" "Missing required dependencies: ${missing_deps[*]}"
        echo "Please install the missing dependencies and try again."
        exit 1
    fi
}

# Check dependencies before running
check_dependencies

# Main execution
case "$1" in
    watch)
        watch_directory
        ;;
    convert)
        shift
        if [[ "$1" == "-f" || "$1" == "--file" ]]; then
            if [[ -f "$2" ]]; then
                process_video "$2"
            else
                log "ERROR" "File not found: $2"
                exit 1
            fi
        elif [[ "$1" == "-a" || "$1" == "--all" ]]; then
            for file in "$UPLOAD_DIR"/*; do
                if [[ -f "$file" ]]; then
                    process_video "$file"
                fi
            done
        else
            show_help
            exit 1
        fi
        ;;
    cleanup)
        "$SCRIPT_DIR/cleanup.sh"
        ;;
    list)
        list_videos
        ;;
    status)
        show_status
        ;;
    upload)
        if [[ $# -lt 2 ]]; then
            echo "Usage: $0 upload <video_name>"
            exit 1
        fi
        upload_to_r2_manual "$2"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        show_help
        exit 1
        ;;
esac
