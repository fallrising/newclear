# Video Processing System

A complete solution for converting videos to HLS format with adaptive bitrate streaming and web playback support.

## Table of Contents
1. [System Requirements](#system-requirements)
2. [Directory Structure](#directory-structure)
3. [Installation](#installation)
4. [Scripts Usage](#scripts-usage)
5. [Web Player](#web-player)
6. [Troubleshooting](#troubleshooting)

## System Requirements

- FFmpeg >= 4.2
- Bash >= 4.0
- Node.js >= 14 (optional, for API server)
- Nginx >= 1.18
- Required tools:
  ```bash
  # Ubuntu/Debian
  sudo apt-get update
  sudo apt-get install ffmpeg jq bc
  
  # CentOS/RHEL
  sudo yum install ffmpeg jq bc
  ```

## Directory Structure

```
~/video_conversion/
├── scripts/                # Conversion scripts
│   ├── config.sh          # Configuration settings
│   ├── convert.sh         # Video conversion script
│   ├── validate.sh        # Video validation script
│   ├── cleanup.sh         # Maintenance script
│   └── control.sh         # Main control script
├── upload/                # Upload directory for new videos
├── processed/             # Processed videos directory
│   └── video_name/        # Each video gets its own directory
│       ├── master.m3u8    # Master playlist
│       └── 1080p/         # Quality-specific directories
├── www/                   # Web server directory
│   ├── index.html        # Player page
│   └── videos -> ../processed  # Symlink to processed videos
└── logs/                  # Log files directory
```

## Installation

1. **Clone or Create Directory Structure**
```bash
mkdir -p ~/video_conversion/{scripts,upload,processed,www,logs}
```

2. **Copy Scripts**
```bash
chmod +x ~/video_conversion/scripts/*.sh
```

3. **Configure Nginx**
```nginx
server {
    listen 80;
    server_name your_domain.com;

    root /home/your_username/video_conversion/www;
    index index.html;

    # Serve HLS content
    location /videos/ {
        alias /home/your_username/video_conversion/processed/;
        add_header Cache-Control "public, max-age=31536000";
        add_header Access-Control-Allow-Origin *;
    }

    # Serve m3u8 files
    location ~ \.m3u8$ {
        add_header Cache-Control "no-cache";
        add_header Access-Control-Allow-Origin *;
    }

    # Serve TS segments
    location ~ \.ts$ {
        add_header Cache-Control "public, max-age=31536000";
        add_header Access-Control-Allow-Origin *;
    }
}
```

4. **Configure System**
Edit `config.sh` to set your preferences:
```bash
# Example configurations
export MIN_WIDTH=640
export MIN_HEIGHT=360
export RETENTION_DAYS=7
```

## Scripts Usage

### 1. Main Control Script
```bash
# Watch upload directory for new videos
./scripts/control.sh watch

# Convert a specific video
./scripts/control.sh convert -f upload/video.mp4

# Run cleanup
./scripts/control.sh cleanup

# List processed videos
./scripts/control.sh list

# Show system status
./scripts/control.sh status
```

### 2. Individual Scripts

**Validate Video:**
```bash
./scripts/validate.sh upload/video.mp4
```

**Convert Video:**
```bash
./scripts/convert.sh input.mp4 output_directory
```

**Cleanup Old Files:**
```bash
./scripts/cleanup.sh
```

### 3. Automation
Add to crontab for automatic processing:
```bash
# Edit crontab
crontab -e

# Add these lines
# Run cleanup daily at 3 AM
0 3 * * * ~/video_conversion/scripts/cleanup.sh

# Check for new videos every 5 minutes
*/5 * * * * ~/video_conversion/scripts/control.sh watch
```

## Web Player

### Installation
1. Copy the player files to your web directory:
```bash
cp www/index.html ~/video_conversion/www/
```

2. Create symlink for videos:
```bash
ln -s ~/video_conversion/processed ~/video_conversion/www/videos
```

### Player Features
- Adaptive bitrate streaming
- Quality selection
- Subtitle support (if available)
- Debug information panel
- Error recovery
- Cross-browser compatibility

### Usage
1. Access the player at `http://your_domain.com/`
2. Select a video from the dropdown
3. Choose quality or use auto-mode
4. Enable subtitles if available

### API Integration
The player expects an API endpoint at `/api/videos` that returns:
```json
[
  {
    "name": "Video Title",
    "path": "videos/video_name/master.m3u8"
  }
]
```

## Troubleshooting

### Common Issues

1. **Video Won't Convert**
   - Check FFmpeg installation
   - Verify input video format
   - Check logs in `logs/conversion.log`

2. **Playback Issues**
   - Verify Nginx configuration
   - Check browser console for errors
   - Ensure correct MIME types are set

3. **Missing Subtitles**
   - Verify VTT files exist
   - Check playlist_vtt.m3u8 format
   - Ensure proper file permissions

### Log Locations
- Conversion logs: `logs/conversion.log`
- Nginx logs: `/var/log/nginx/error.log`
- Debug panel in web player

### Monitoring
Monitor system health:
```bash
# Check disk space
df -h ~/video_conversion

# Check recent conversions
tail -f ~/video_conversion/logs/conversion.log

# List current processes
ps aux | grep ffmpeg
```

## Development

### Modifying the Player
The player can be customized by editing `www/index.html`. Key areas for customization:
- Quality levels in `convert.sh`
- UI styling in CSS
- Player configuration in JavaScript

### Adding Features
1. Edit relevant script
2. Test thoroughly
3. Update configuration if needed
4. Restart services if required

## Security Considerations
- Set proper file permissions
- Configure CORS headers
- Implement authentication if needed
- Monitor system resources

## Support
For issues and feature requests:
1. Check the logs
2. Verify configurations
3. Test with sample videos
4. Contact system administrator

## R2 Upload Configuration (Optional)

The system supports optional upload to Cloudflare R2 storage.

### Setup R2 Upload

1. Install rclone:
```bash
# Ubuntu/Debian
sudo apt install rclone

# CentOS/RHEL
sudo yum install rclone
```

2. Configure rclone for R2:
```bash
rclone config

# Select "New remote"
# Name: r2
# Type: Select "Cloudflare R2"
# Enter your R2 credentials
```

3. Enable R2 upload in config.sh:
```bash
# Edit config.sh
export USE_R2="true"
export R2_BUCKET_NAME="your-bucket-name"
export R2_DOMAIN="your-domain.com"
export R2_BASE_PATH="videos"
```

### Usage

1. Automatic upload (when enabled in config):
```bash
# Videos will automatically upload after conversion
./scripts/control.sh convert -f upload/video.mp4
```

2. Manual upload:
```bash
# Upload specific video
./scripts/control.sh upload video_name
```

### R2 Structure
```
your-bucket/
└── videos/
    └── video_name/
        ├── master.m3u8
        └── 1080p/
            ├── playlist.m3u8
            └── segments/
```

### Update Web Player
Update the video URLs in index.html to use R2 URLs:
```javascript
// Example R2 URL format
const videoPath = `https://${R2_DOMAIN}/${R2_BASE_PATH}/${videoName}/master.m3u8`;
```

## Docker

### Build
```bash
docker build -t video_processor .
```

### Run
```
docker run -d \
    --name video_processor \
    -v /path/to/local/upload:/app/upload \
    -v /path/to/local/processed:/app/processed \
    video_processor
```
