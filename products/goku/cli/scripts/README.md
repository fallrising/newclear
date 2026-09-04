# Goku CLI Scripts Collection

This directory contains automation scripts and workflow examples to simplify Goku CLI operations and demonstrate enterprise-grade capabilities.

## 📁 Directory Structure

```
scripts/
├── import/          # Import automation scripts
├── export/          # Export and backup scripts  
├── management/      # User and system management
├── automation/      # Monitoring and automation
├── examples/        # Workflow examples and demos
└── README.md        # This file
```

## 🚀 Quick Start

Make all scripts executable:
```bash
chmod +x scripts/**/*.sh
```

Set the Goku binary path (if not in default location):
```bash
export GOKU_BIN="/path/to/your/goku"
```

## 📥 Import Scripts

### bulk-import.sh
**Optimized bulk import for 100k+ bookmarks**

```bash
# Basic bulk import
./scripts/import/bulk-import.sh large-dataset.json research

# High-performance enterprise import
./scripts/import/bulk-import.sh \
  --domain-delay 1s \
  --timeout 45s \
  --max-domains 10 \
  --workers 15 \
  huge-dataset.json enterprise

# With MQTT real-time events
./scripts/import/bulk-import.sh \
  --mqtt-broker localhost \
  --mqtt-topic "company/bookmarks" \
  bookmarks.json team
```

**Features:**
- Domain-based rate limiting for web crawling etiquette
- Circuit breaker pattern for failing domains
- Resumable operations with progress saving
- Real-time progress monitoring
- Performance estimation and ETA
- MQTT integration for event streaming

### browser-import.sh
**Simple browser bookmark import with format detection**

```bash
# Import Chrome bookmarks
./scripts/import/browser-import.sh chrome-bookmarks.html

# Import with metadata fetching
./scripts/import/browser-import.sh --fetch firefox-bookmarks.json personal

# Import with MQTT notifications
./scripts/import/browser-import.sh \
  --mqtt-broker localhost \
  safari-bookmarks.html work
```

### resumable-import.sh
**Handle interrupted imports and resume operations**

```bash
# Start resumable import
./scripts/import/resumable-import.sh large-file.json research

# Check progress
./scripts/import/resumable-import.sh -s -r progress.txt large-file.json

# Force restart (ignore resume file)
./scripts/import/resumable-import.sh -f large-file.json research

# Cleanup old resume files
./scripts/import/resumable-import.sh -c
```

### mqtt-import.sh
**Import with comprehensive MQTT integration**

```bash
# Basic MQTT import
./scripts/import/mqtt-import.sh -b localhost bookmarks.html

# Secure MQTT with authentication
./scripts/import/mqtt-import.sh \
  -b mqtt.company.com \
  -s -u user -P password \
  bookmarks.json work

# Test MQTT connection
./scripts/import/mqtt-import.sh -b localhost --test-connection
```

## 📤 Export & Backup Scripts

### backup-bookmarks.sh
**Automated backup with compression and rotation**

```bash
# Backup specific user
./scripts/export/backup-bookmarks.sh research

# Backup all users with custom retention
./scripts/export/backup-bookmarks.sh \
  --all-users \
  --keep 30 \
  --backup-dir /backups/goku

# Backup with verification
./scripts/export/backup-bookmarks.sh --verify research

# Quick backup without compression
./scripts/export/backup-bookmarks.sh --no-compression personal
```

**Features:**
- Automatic backup rotation and cleanup
- Compression with configurable levels
- Backup verification and integrity checks
- Support for single user or all users
- Custom backup directories and retention policies

## 🛠️ Management Scripts

### setup-user.sh
**Initialize new user profiles with best practices**

```bash
# Basic user setup
./scripts/management/setup-user.sh research

# Setup with sample data and configuration
./scripts/management/setup-user.sh \
  --sample-data \
  --config-template \
  --backup-config \
  --mqtt-config \
  enterprise

# Setup with import from existing file
./scripts/management/setup-user.sh \
  --import-from bookmarks.html \
  personal

# Custom data directory
./scripts/management/setup-user.sh \
  -d /data/bookmarks \
  work
```

**Features:**
- Database initialization and validation
- Sample bookmark creation
- Configuration template generation
- MQTT setup templates
- Automated backup script creation
- Environment variable configuration

## 🤖 Automation Scripts

### monitor-import.sh
**Real-time import monitoring with progress tracking**

```bash
# Basic monitoring
./scripts/automation/monitor-import.sh

# Monitor specific user
./scripts/automation/monitor-import.sh --user research

# Interactive dashboard
./scripts/automation/monitor-import.sh --dashboard

# Monitor with MQTT events
./scripts/automation/monitor-import.sh \
  --mqtt-monitor localhost \
  --mqtt-topic "goku/+/+"

# Monitor with alerts
./scripts/automation/monitor-import.sh \
  --alert-webhook http://alerts.company.com/webhook \
  --alert-email admin@company.com
```

**Features:**
- Real-time progress tracking from resume files
- Performance metrics and ETA calculation
- Interactive dashboard with system information
- MQTT event monitoring
- Webhook and email alerts
- Stalled import detection

## 🏢 Example Workflows

### enterprise-workflow.sh
**Complete enterprise demonstration**

```bash
# Run complete enterprise workflow
./scripts/examples/enterprise-workflow.sh

# Setup enterprise environment only
./scripts/examples/enterprise-workflow.sh setup \
  --data-dir /enterprise/goku

# Demonstrate bulk import with monitoring
./scripts/examples/enterprise-workflow.sh import \
  --sample-size 5000 \
  --mqtt-broker mqtt.company.com

# Interactive monitoring demo
./scripts/examples/enterprise-workflow.sh monitor

# Cleanup demo data
./scripts/examples/enterprise-workflow.sh --cleanup
```

**Features:**
- Multi-user profile setup (research, development, security, compliance, operations)
- Enterprise directory structure
- Sample dataset generation
- Bulk import demonstration
- Real-time monitoring
- Automated backup procedures
- MQTT integration showcase

## 📊 Performance & Monitoring

### Performance Characteristics

| Script | Use Case | Performance | Features |
|--------|----------|-------------|----------|
| `bulk-import.sh` | 100k+ bookmarks | 200-500/min | Rate limiting, resumable |
| `browser-import.sh` | Browser exports | 800-1000/min | Format detection, simple |
| `resumable-import.sh` | Interrupted imports | Variable | Progress tracking, recovery |
| `backup-bookmarks.sh` | Data protection | 5000/min export | Compression, verification |

### Monitoring Capabilities

- **Real-time Progress**: Live tracking of import operations
- **Performance Metrics**: Rate calculation and ETA estimation
- **Health Monitoring**: Stalled operation detection
- **Event Streaming**: MQTT-based real-time notifications
- **Dashboard**: Interactive monitoring interface
- **Alerting**: Webhook and email notifications

## 🔧 Configuration

### Environment Variables

```bash
# Goku binary location
export GOKU_BIN="/usr/local/bin/goku"

# Default settings
export GOKU_DEFAULT_WORKERS=10
export GOKU_DEFAULT_DOMAIN_DELAY=2s
export GOKU_DEFAULT_TIMEOUT=30s

# Enterprise settings
export GOKU_ENTERPRISE_MODE=true
export GOKU_BACKUP_RETENTION=30
export GOKU_MONITORING_ENABLED=true

# MQTT configuration
export GOKU_MQTT_BROKER="mqtt.company.com"
export GOKU_MQTT_PORT=8883
export GOKU_MQTT_SSL=true
```

### Script Configuration

Most scripts support configuration through:
- Command-line arguments
- Environment variables
- Configuration files (generated by setup scripts)

## 🔒 Security Considerations

### Enterprise Security Features

- **User Isolation**: Complete separation of user profiles
- **Data Validation**: Input validation and sanitization
- **Access Control**: File permissions and directory restrictions
- **Audit Logging**: Comprehensive operation logging
- **Network Security**: MQTT SSL/TLS support
- **Backup Encryption**: Secure backup storage options

### Best Practices

1. **User Profiles**: Use separate profiles for different contexts
2. **Rate Limiting**: Respect web crawling etiquette with appropriate delays
3. **Monitoring**: Implement monitoring for production deployments
4. **Backups**: Regular automated backups with verification
5. **Logging**: Enable comprehensive logging for audit trails

## 🚀 Integration Examples

### CI/CD Pipeline Integration

```bash
# Automated import in CI/CD
./scripts/import/bulk-import.sh \
  --no-fetch \
  --workers 20 \
  --domain-delay 500ms \
  production-bookmarks.json \
  production

# Automated backup
./scripts/export/backup-bookmarks.sh \
  --all-users \
  --verify \
  --backup-dir "$BACKUP_PATH"
```

### Cron Jobs

```bash
# Daily backup at 2 AM
0 2 * * * /path/to/scripts/export/backup-bookmarks.sh --all-users

# Weekly cleanup at 3 AM Sunday
0 3 * * 0 /path/to/scripts/import/resumable-import.sh -c

# Hourly monitoring check
0 * * * * /path/to/scripts/automation/monitor-import.sh --user production
```

### Docker Integration

```bash
# Run in container
docker run -v $(pwd):/data -v $(pwd)/scripts:/scripts \
  goku-cli /scripts/import/bulk-import.sh /data/bookmarks.json production
```

## 📚 Additional Resources

- **[Main README](../README.md)** - Goku CLI overview and features
- **[Command Reference](../cmd/goku/README.md)** - Detailed command documentation
- **[Build Scripts](../build.sh)** - Build and deployment automation

## 🤝 Contributing

To add new scripts:

1. Follow the existing script structure and naming conventions
2. Include comprehensive help text and examples
3. Add error handling and validation
4. Include progress indicators for long-running operations
5. Update this README with the new script documentation

## 📄 License

These scripts are part of the Goku CLI project and follow the same license terms.