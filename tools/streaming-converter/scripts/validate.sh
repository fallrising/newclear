#!/bin/bash
# validate.sh - Validate video files before conversion

source "$(dirname "$0")/config.sh"

get_video_info() {
    local input_file="$1"
    local video_info
    
    # Get detailed video information in JSON format
    video_info=$(ffprobe -v quiet -print_format json \
                        -show_format -show_streams \
                        "$input_file")
    
    if [ $? -ne 0 ]; then
        log "ERROR" "Failed to get video information for: $input_file"
        return 1
    fi
    
    echo "$video_info"
}

validate_video() {
    local input_file="$1"
    
    # Check if file exists
    if [[ ! -f "$input_file" ]]; then
        log "ERROR" "File not found: $input_file"
        return 1
    fi

    # Check file extension
    if [[ ! "$input_file" =~ \.(mp4|mkv|mov|avi|webm)$ ]]; then
        log "ERROR" "Unsupported format: $input_file"
        return 1
    fi

    # Get video information
    local video_info
    video_info=$(get_video_info "$input_file")
    if [ $? -ne 0 ]; then
        return 1
    fi

    # Extract video stream information
    local width height duration codec bitrate fps
    
    width=$(echo "$video_info" | jq -r '.streams[] | select(.codec_type=="video") | .width')
    height=$(echo "$video_info" | jq -r '.streams[] | select(.codec_type=="video") | .height')
    duration=$(echo "$video_info" | jq -r '.format.duration')
    codec=$(echo "$video_info" | jq -r '.streams[] | select(.codec_type=="video") | .codec_name')
    bitrate=$(echo "$video_info" | jq -r '.format.bit_rate')
    fps=$(echo "$video_info" | jq -r '.streams[] | select(.codec_type=="video") | .r_frame_rate')

    # Check if we got valid numbers
    if [[ ! "$width" =~ ^[0-9]+$ ]] || [[ ! "$height" =~ ^[0-9]+$ ]]; then
        log "ERROR" "Could not determine video dimensions for: $input_file"
        return 1
    fi

    # Check dimensions
    if [ "$width" -lt "$MIN_WIDTH" ] || [ "$height" -lt "$MIN_HEIGHT" ]; then
        log "ERROR" "Video resolution too low: ${width}x${height}, minimum required: ${MIN_WIDTH}x${MIN_HEIGHT}"
        return 1
    fi

    # Check if dimensions are even numbers
    if [ $((width % 2)) -ne 0 ] || [ $((height % 2)) -ne 0 ]; then
        log "WARNING" "Video dimensions are not even numbers: ${width}x${height}"
        log "INFO" "Video will be resized to even dimensions during conversion"
    fi

    # Check duration
    if [[ ! "$duration" =~ ^[0-9]+([.][0-9]+)?$ ]] || [ "$(echo "$duration < $MIN_DURATION" | bc -l)" -eq 1 ]; then
        log "ERROR" "Invalid video duration: ${duration}s, minimum required: ${MIN_DURATION}s"
        return 1
    fi

    # Calculate frame rate
    local fps_num fps_den
    IFS='/' read -r fps_num fps_den <<< "$fps"
    if [[ -n "$fps_den" && "$fps_den" != "0" ]]; then
        local fps_value
        fps_value=$(echo "scale=2; $fps_num / $fps_den" | bc)
        log "INFO" "Frame Rate: $fps_value fps"
    else
        log "WARNING" "Could not determine frame rate"
    fi

    # Log video information
    log "INFO" "Video validation passed for: $input_file"
    log "INFO" "Details:"
    log "INFO" "  Resolution: ${width}x${height}"
    log "INFO" "  Duration: ${duration}s"
    log "INFO" "  Codec: $codec"
    if [[ -n "$bitrate" ]]; then
        log "INFO" "  Bitrate: $((bitrate/1000)) kbps"
    fi

    return 0
}

# Check for required tools
check_dependencies() {
    local missing_deps=()
    
    for cmd in ffprobe jq bc; do
        if ! command -v "$cmd" &> /dev/null; then
            missing_deps+=("$cmd")
        fi
    done
    
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log "ERROR" "Missing required dependencies: ${missing_deps[*]}"
        echo "Please install missing dependencies:"
        echo "  Ubuntu/Debian: sudo apt-get install ${missing_deps[*]}"
        echo "  CentOS/RHEL: sudo yum install ${missing_deps[*]}"
        return 1
    fi
}

# Main execution if script is run directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    if [[ $# -lt 1 ]]; then
        echo "Usage: $0 <input_file>"
        exit 1
    fi

    # Check dependencies first
    if ! check_dependencies; then
        exit 1
    fi

    # Run validation
    validate_video "$1"
fi
