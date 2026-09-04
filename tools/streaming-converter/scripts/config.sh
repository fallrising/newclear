#!/bin/bash
# config.sh - Configuration settings for video processing

# Determine the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Set the project root to one level up from SCRIPT_DIR
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Base directories (relative to project root)
export BASE_DIR="$PROJECT_ROOT"
export UPLOAD_DIR="$BASE_DIR/upload"
export PROCESSED_DIR="$BASE_DIR/processed"
export WWW_DIR="$BASE_DIR/www"
export LOG_DIR="$BASE_DIR/logs"

# Video Quality Settings
# Format: "name:resolution:bitrate"
# Automatically scales based on input video resolution
export QUALITIES=(
    "source:original:4000k"   # Original quality
    "720p:1280x720:2500k"     # 720p
    "480p:854x480:1000k"      # 480p
    "360p:640x360:800k"       # 360p
    "240p:426x240:400k"       # 240p
)

# Video Encoding Settings
export HLS_SEGMENT_TIME=10       # Length of each segment in seconds
export HLS_LIST_SIZE=0           # 0 means keep all segments
export VIDEO_PRESET="fast"       # Encoding preset
export AUDIO_BITRATE="128k"      # Audio bitrate
export AUDIO_CHANNELS=2          # Number of audio channels

# Validation settings - Minimal requirements
export MIN_WIDTH=160             # Minimum width
export MIN_HEIGHT=90             # Minimum height
export MIN_DURATION=1            # Minimum video duration in seconds

# Create required directories if they don't exist
mkdir -p "$UPLOAD_DIR" "$PROCESSED_DIR" "$WWW_DIR" "$LOG_DIR"

# Logging function
log() {
    local level="$1"
    local message="$2"
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] [$level] $message" >> "$LOG_DIR/conversion.log"
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] [$level] $message"
}

export -f log

