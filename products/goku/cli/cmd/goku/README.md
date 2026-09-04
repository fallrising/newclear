# Goku CLI Command Reference

Goku CLI is a powerful command-line interface for managing bookmarks efficiently across multiple user profiles with enterprise-grade features including bulk import optimization, real-time MQTT integration, and intelligent web crawling.

## 🌐 Global Options

- `--db`: Path to the Goku database file (default: `<user>.db`, env: `GOKU_DB_PATH_<USER>`)
- `--cache-db`: Path to the Goku cache database file (default: `<user>_cache.db`, env: `GOKU_CACHE_DB_PATH_<USER>`)
- `--user`: User profile to use (default: "goku", env: `GOKU_USER`)

## 📋 Commands Overview

| Command | Purpose | Key Features |
|---------|---------|--------------|
| `add` | Add new bookmarks | Automatic metadata fetching, tag support |
| `delete` | Remove bookmarks | Safe deletion by ID |
| `get` | Retrieve bookmark details | Full bookmark information display |
| `list` | Browse bookmarks | Pagination, filtering |
| `search` | Find bookmarks | Full-text search across all fields |
| `update` | Modify bookmarks | Update any bookmark property |
| `import` | Import from files | Multi-format, bulk optimization, MQTT |
| `export` | Export to files | HTML format with progress tracking |
| `tags` | Manage tags | List, remove, analytics |
| `stats` | View analytics | Comprehensive bookmark statistics |
| `purge` | Delete all bookmarks | Confirmation required |
| `fetch` | Update metadata | Refresh bookmark information |

---

## 📝 Detailed Command Reference

### 📌 add
Add a new bookmark with automatic metadata extraction

**Usage:** `goku [--user <user>] add [options]`

**Options:**
- `--url`: URL of the bookmark (required)
- `--title`: Title of the bookmark (auto-fetched if not provided)
- `--description`: Description of the bookmark (auto-fetched if not provided)
- `--tags`: Tags for the bookmark (comma-separated)
- `--fetch, -F`: Enable fetching additional data for the bookmark

**Examples:**
```bash
# Simple bookmark
goku add --url "https://github.com"

# With metadata
goku add --url "https://golang.org" --title "Go Programming" --tags "programming,go"

# Force metadata fetching
goku add --url "https://example.com" --fetch
```

---

### 🗑️ delete
Delete a bookmark by ID

**Usage:** `goku [--user <user>] delete --id <bookmark_id>`

**Options:**
- `--id`: ID of the bookmark to delete (required)

**Example:**
```bash
goku delete --id 42
```

---

### 👁️ get
Get detailed information about a specific bookmark

**Usage:** `goku [--user <user>] get --id <bookmark_id>`

**Options:**
- `--id`: ID of the bookmark to retrieve (required)

**Example:**
```bash
goku get --id 1
```

---

### 📃 list
List bookmarks with pagination and filtering

**Usage:** `goku [--user <user>] list [options]`

**Options:**
- `--limit`: Number of bookmarks to display per page (default: 10)
- `--offset`: Offset to start listing bookmarks from (default: 0)

**Examples:**
```bash
# List first 10 bookmarks
goku list

# List next 20 bookmarks
goku list --limit 20 --offset 20

# List all bookmarks
goku list --limit 1000
```

---

### 🔍 search
Search bookmarks across all fields

**Usage:** `goku [--user <user>] search [options] <query>`

**Options:**
- `--query, -q`: Search query (required)
- `--limit`: Number of results to display (default: 10)
- `--offset`: Offset for pagination (default: 0)

**Examples:**
```bash
# Search by keyword
goku search --query "golang"

# Search with pagination
goku search -q "programming" --limit 5 --offset 10

# Search in titles and descriptions
goku search -q "machine learning"
```

---

### ✏️ update
Update an existing bookmark's properties

**Usage:** `goku [--user <user>] update [options]`

**Options:**
- `--id`: ID of the bookmark to update (required)
- `--url`: New URL for the bookmark
- `--title`: New title for the bookmark
- `--description`: New description for the bookmark
- `--tags`: New tags for the bookmark (comma-separated)
- `--fetch, -F`: Enable fetching updated data for the bookmark

**Examples:**
```bash
# Update title and tags
goku update --id 1 --title "New Title" --tags "tag1,tag2"

# Update with fresh metadata
goku update --id 1 --fetch

# Update URL and refresh metadata
goku update --id 1 --url "https://newurl.com" --fetch
```

---

### 📥 import
Import bookmarks from various file formats with advanced optimization

**Usage:** `goku [--user <user>] import [options]`

#### Basic Options
- `--file, -f`: Input file path (.html, .json, or .txt) (required)
- `--workers, -w`: Number of worker goroutines for concurrent processing (default: 5)
- `--fetch, -F`: Enable fetching additional data for each imported bookmark

#### 🚀 Bulk Import Options (for 100k+ bookmarks)
- `--bulk-mode`: Enable bulk import mode with optimized settings
- `--domain-delay`: Delay between requests to the same domain (default: 2s)
- `--fetch-timeout`: HTTP timeout for fetching page metadata (default: 30s)
- `--max-concurrent-domains`: Maximum concurrent domains (default: 5)
- `--max-failures-per-domain`: Max failures before skipping domain (default: 5)
- `--skip-domain-cooldown`: Cooldown period for failed domains (default: 1h)
- `--resume-file`: File to save/load progress for resumable imports (default: ".goku-import-progress")

#### 📡 MQTT Integration Options
- `--mqtt-broker`: MQTT broker hostname/IP (enables MQTT publishing)
- `--mqtt-port`: MQTT broker port (default: 1883)
- `--mqtt-client-id`: MQTT client ID (auto-generated if not provided)
- `--mqtt-username`: MQTT username (optional)
- `--mqtt-password`: MQTT password (optional)
- `--mqtt-topic`: MQTT topic for bookmark events (default: "goku/bookmarks")
- `--mqtt-qos`: MQTT QoS level (0, 1, or 2) (default: 1)

#### Supported Formats
- **HTML**: Browser bookmark exports (Chrome, Firefox, Safari, Edge)
- **JSON**: Firefox JSON format with folder hierarchy support
- **Text**: Plain URL lists (one URL per line)

**Examples:**
```bash
# Basic import
goku import --file bookmarks.html

# High-performance import
goku import --file bookmarks.json --workers 10 --fetch

# Bulk import for large datasets (100k+ bookmarks)
goku import --file large-export.json \
  --bulk-mode \
  --domain-delay 2s \
  --fetch-timeout 30s \
  --max-concurrent-domains 5 \
  --resume-file my-progress.txt

# Import with MQTT real-time events
goku import --file bookmarks.html \
  --mqtt-broker localhost \
  --mqtt-port 1883 \
  --mqtt-topic "bookmarks/imported" \
  --mqtt-username user \
  --mqtt-password secret

# Resume interrupted large import
goku import --file large-export.json \
  --bulk-mode \
  --resume-file my-progress.txt
```

**Bulk Import Performance:**
- **Regular mode**: ~1000 bookmarks/minute
- **Bulk mode**: ~100-500 bookmarks/minute (with domain delays for web etiquette)
- **Memory usage**: Optimized for large datasets
- **Resumable**: Automatic progress saving every 100 items

---

### 📤 export
Export bookmarks to HTML format

**Usage:** `goku [--user <user>] export [options]`

**Options:**
- `--output, -o`: Output file path (default: stdout)

**Examples:**
```bash
# Export to file
goku export --output my-bookmarks.html

# Export to stdout
goku export

# Export specific user's bookmarks
goku --user work export --output work-bookmarks.html
```

---

### 🏷️ tags
Manage bookmark tags with advanced operations

**Usage:** `goku [--user <user>] tags <subcommand> [options]`

#### Subcommands

**`list`** - List all unique tags with usage statistics
```bash
goku tags list
```

**`remove`** - Remove a specific tag from a bookmark
```bash
goku tags remove --id <bookmark_id> --tag <tag_name>
```

**Examples:**
```bash
# List all tags
goku tags list

# Remove a tag from bookmark
goku tags remove --id 5 --tag "old-tag"
```

---

### 📊 stats
Display comprehensive bookmark statistics and analytics

**Usage:** `goku [--user <user>] stats`

**Provides:**
- Total bookmark count
- Top domains and hostnames
- Tag usage statistics
- Recent bookmark trends
- Accessibility metrics
- Creation patterns

**Example:**
```bash
goku stats
```

**Sample Output:**
```
Bookmark Statistics:
- Total Bookmarks: 15,342
- Unique Domains: 2,847
- Total Tags: 1,205
- Accessible URLs: 14,891 (97%)
- Recent Additions: 234 (last 7 days)

Top Domains:
1. github.com (1,250 bookmarks)
2. stackoverflow.com (890 bookmarks)
3. medium.com (567 bookmarks)

Top Tags:
1. programming (2,340 uses)
2. development (1,890 uses)
3. tutorial (1,456 uses)
```

---

### 🧹 purge
Delete all bookmarks from the database

**Usage:** `goku [--user <user>] purge [options]`

**Options:**
- `--force`: Force purge without confirmation

**Examples:**
```bash
# Interactive purge with confirmation
goku purge

# Force purge without prompt
goku purge --force
```

---

### 🔄 fetch
Fetch or update metadata for existing bookmarks

**Usage:** `goku [--user <user>] fetch [options]`

**Options:**
- `--id`: Fetch metadata for a specific bookmark ID
- `--all`: Fetch metadata for all bookmarks
- `--limit`: Number of bookmarks to process per batch (default: 10)
- `--skip-internal`: Skip URLs with internal IP addresses

**Examples:**
```bash
# Update specific bookmark
goku fetch --id 42

# Update all bookmarks
goku fetch --all

# Batch update with limit
goku fetch --all --limit 50

# Skip internal URLs
goku fetch --all --skip-internal
```

---

## 👥 Multi-User Profile System

Goku CLI supports complete user profile isolation with separate databases and configurations.

### User Profile Features
- **Isolated Databases**: Each user has separate bookmark, cache, and statistics databases
- **Environment Variables**: Per-user database path configuration
- **Automatic Creation**: Profiles are created automatically on first use
- **Complete Separation**: No data sharing between profiles

### Profile Usage Examples
```bash
# Work profile for professional bookmarks
goku --user work add --url "https://company-docs.com"
goku --user work import --file work-bookmarks.html

# Personal profile for personal bookmarks
goku --user personal add --url "https://recipes.com"
goku --user personal list

# Research profile for academic/research bookmarks
goku --user research import --file research-papers.json --bulk-mode
goku --user research stats

# OSINT profile for intelligence gathering
goku --user osint add --url "https://osint-tool.com" --tags "osint,investigation"
```

### Environment Variables
```bash
# Custom database paths per user
export GOKU_DB_PATH_WORK="/data/work-bookmarks.db"
export GOKU_CACHE_DB_PATH_WORK="/data/work-cache.db"

# Default user
export GOKU_USER="personal"
```

---

## 🔧 Advanced Usage Patterns

### Large Dataset Import Workflow
```bash
# Step 1: Prepare for bulk import
goku --user research import --file huge-dataset.json \
  --bulk-mode \
  --domain-delay 3s \
  --fetch-timeout 45s \
  --max-concurrent-domains 3 \
  --resume-file research-progress.txt

# Step 2: Monitor progress (in another terminal)
tail -f goku.log

# Step 3: If interrupted, resume
goku --user research import --file huge-dataset.json \
  --bulk-mode \
  --resume-file research-progress.txt
```

### MQTT Event Streaming Setup
```bash
# Real-time bookmark events for integration
goku import --file daily-bookmarks.html \
  --mqtt-broker mqtt.company.com \
  --mqtt-port 8883 \
  --mqtt-username goku-service \
  --mqtt-password $(cat mqtt-secret) \
  --mqtt-topic "data/bookmarks/imported" \
  --mqtt-qos 2
```

### Performance Optimization
```bash
# High-throughput import for data migration
goku import --file migration-data.json \
  --workers 20 \
  --fetch \
  --bulk-mode \
  --domain-delay 1s \
  --max-concurrent-domains 10
```

---

## 📈 Performance Characteristics

### Import Performance
- **Small datasets** (<1k): ~1000 bookmarks/minute
- **Medium datasets** (1k-10k): ~800 bookmarks/minute  
- **Large datasets** (10k-100k): ~500 bookmarks/minute (bulk mode)
- **Enterprise datasets** (100k+): ~200-400 bookmarks/minute (with proper rate limiting)

### Search Performance
- **Small databases** (<10k): <10ms
- **Medium databases** (10k-100k): <50ms
- **Large databases** (100k+): <100ms

### Memory Usage
- **Regular import**: ~50MB for 10k bookmarks
- **Bulk import**: ~100MB for 100k bookmarks
- **Database**: SQLite with efficient indexing

---

For more information about Goku CLI architecture and features, see the [main README](../README.md).