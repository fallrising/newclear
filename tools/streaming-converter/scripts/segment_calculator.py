#!/usr/bin/env python3

def calculate_hls_segments(file_size_gb, video_duration_minutes=None):
    """
    Calculate approximate number of HLS segments for different quality levels
    
    Args:
        file_size_gb: Size of input file in GB
        video_duration_minutes: Duration in minutes (if known)
    """
    # Estimate duration if not provided (assuming typical 1080p bitrate of 8Mbps)
    if not video_duration_minutes:
        estimated_bitrate = 8 * 1024 * 1024  # 8 Mbps in bits
        video_duration_minutes = (file_size_gb * 8 * 1024 * 1024 * 1024) / (estimated_bitrate * 60)
    
    # Convert to seconds
    duration_seconds = video_duration_minutes * 60
    
    # HLS segment length (in seconds)
    segment_duration = 6
    
    # Calculate number of segments for each quality level
    qualities = {
        "2160p": {"bitrate": 8000},  # 8Mbps
        "1080p": {"bitrate": 4000},  # 4Mbps
        "720p": {"bitrate": 2500},   # 2.5Mbps
        "480p": {"bitrate": 1000}    # 1Mbps
    }
    
    total_segments = 0
    total_size_gb = 0
    
    print(f"\nEstimated calculations for {duration_seconds:.1f} seconds of video:")
    print("\nQuality  Segments  Approx Size")
    print("-" * 35)
    
    for quality, specs in qualities.items():
        # Number of segments
        segments = int(duration_seconds / segment_duration) + 1
        
        # Estimated size per quality level
        bitrate_gbps = specs["bitrate"] / (8 * 1024)  # Convert kbps to GB/s
        estimated_size = (duration_seconds * bitrate_gbps) + 0.001  # Adding 1MB for playlist files
        
        qualities[quality]["segments"] = segments
        total_segments += segments
        total_size_gb += estimated_size
        
        print(f"{quality:<8} {segments:>8}  {estimated_size:>8.2f} GB")
    
    print("-" * 35)
    print(f"Total    {total_segments:>8}  {total_size_gb:>8.2f} GB")
    
    return {
        "total_segments": total_segments,
        "total_size": total_size_gb,
        "duration_minutes": video_duration_minutes,
        "qualities": qualities
    }

# Example calculation for a 4GB file
if __name__ == "__main__":
    FILE_SIZE_GB = 4
    results = calculate_hls_segments(FILE_SIZE_GB)
