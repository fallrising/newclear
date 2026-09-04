#!/bin/bash
# convert.sh - Adaptive video conversion script

source "$(dirname "$0")/config.sh"

get_scaled_qualities() {
    local input_width="$1"
    local input_height="$2"
    local scaled_qualities=()
    
    # Add source quality if input resolution is above minimum (e.g., 720p or higher)
    if [ "$input_width" -ge 1280 ] && [ "$input_height" -ge 720 ]; then
        scaled_qualities+=("source:${input_width}x${input_height}:4000k")
    fi
    
    # Add lower qualities only if they are supported by input dimensions
    for quality in "${QUALITIES[@]}"; do
        IFS=':' read -r name resolution bitrate <<< "$quality"
        if [ "$name" = "source" ]; then
            continue
        fi
        
        target_width=$(echo "$resolution" | cut -d'x' -f1)
        target_height=$(echo "$resolution" | cut -d'x' -f2)
        
        # Only add resolution if it's less than or equal to the input dimensions
        if [ "$input_width" -ge "$target_width" ] && [ "$input_height" -ge "$target_height" ]; then
            scaled_qualities+=("$name:$resolution:$bitrate")
        fi
    done
    
    echo "${scaled_qualities[@]}"
}

convert_video() {
    local input_file="$1"
    local basename=$(basename "${input_file%.*}")
    local output_dir="$PROCESSED_DIR/$basename"
    
    log "INFO" "Starting conversion for $basename"
    
    # Get input video dimensions
    local input_dims=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$input_file")
    local input_width=$(echo "$input_dims" | cut -d'x' -f1)
    local input_height=$(echo "$input_dims" | cut -d'x' -f2)
    
    log "INFO" "Input dimensions: ${input_dims}"
    
    # Create output directory
    mkdir -p "$output_dir"
    
    # Create master playlist
    echo "#EXTM3U" > "$output_dir/master.m3u8"
    echo "#EXT-X-VERSION:3" >> "$output_dir/master.m3u8"
    
    # Get adaptive quality settings based on input dimensions
    local qualities=($(get_scaled_qualities "$input_width" "$input_height"))
    
    # Convert each quality
    for quality in "${qualities[@]}"; do
        IFS=':' read -r name resolution bitrate <<< "$quality"
        
        local quality_dir="$output_dir/$name"
        mkdir -p "$quality_dir/segments"
        
        log "INFO" "Converting $basename to $name ($resolution)"
        
        if [ "$name" = "source" ]; then
            # Source quality - no scaling
            ffmpeg_scale_opts="-vf format=yuv420p"
        else
            # Scale to target resolution without forcing exact match
            target_width=$(echo "$resolution" | cut -d'x' -f1)
            target_height=$(echo "$resolution" | cut -d'x' -f2)
            ffmpeg_scale_opts="-vf scale='min(iw,$target_width):min(ih,$target_height)',format=yuv420p"
        fi
        
        if ! ffmpeg -y -i "$input_file" \
            -c:v libx264 -preset "$VIDEO_PRESET" \
            -b:v "$bitrate" \
            -maxrate "$bitrate" \
            -bufsize "$(echo "$bitrate" | sed 's/k$//')k" \
            $ffmpeg_scale_opts \
            -c:a aac -b:a "$AUDIO_BITRATE" -ac "$AUDIO_CHANNELS" \
            -force_key_frames "expr:gte(t,n_forced*$HLS_SEGMENT_TIME)" \
            -hls_time "$HLS_SEGMENT_TIME" \
            -hls_list_size "$HLS_LIST_SIZE" \
            -hls_segment_filename "$quality_dir/segments/%03d.ts" \
            -f hls \
            "$quality_dir/playlist.m3u8"; then
            
            log "ERROR" "Failed to convert $basename to $name"
            return 1
        fi
        
        # Add to master playlist
        echo "" >> "$output_dir/master.m3u8"
        echo "#EXT-X-STREAM-INF:BANDWIDTH=$(echo "$bitrate" | sed 's/k/000/'),RESOLUTION=$resolution" >> "$output_dir/master.m3u8"
        echo "$name/playlist.m3u8" >> "$output_dir/master.m3u8"
    done
    
    log "INFO" "Conversion completed for $basename"
    return 0
}

# Main execution if the script is run directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    if [[ $# -lt 1 ]]; then
        echo "Usage: $0 <input_file>"
        exit 1
    fi
    
    convert_video "$1"
fi

