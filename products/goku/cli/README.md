# Goku CLI

🔖 **Enterprise-ready bookmark manager with advanced import/export, real-time MQTT integration, and intelligent web crawling capabilities.**

Goku CLI is a powerful, enterprise-ready command-line bookmark manager with advanced import/export capabilities, real-time event publishing, and sophisticated metadata extraction features. Inspired by Buku but built with modern Go architecture for performance and scalability.

## ✨ Key Features

### 📚 **Bookmark Management**
- **Multi-format Import/Export**: HTML, JSON (Firefox), and plain text support
- **Bulk Import Optimization**: Handle 100k+ bookmarks with rate limiting and resumable imports
- **Automatic Metadata Extraction**: Fetch titles, descriptions, and tags from web pages
- **Wayback Machine Integration**: Fallback to archived versions for inaccessible sites
- **Smart Deduplication**: Automatic URL deduplication during imports

### 🔍 **Search & Discovery**
- **Full-text Search**: Search across URLs, titles, descriptions, and tags
- **Advanced Filtering**: Pagination, sorting, and flexible query matching
- **Tag Management**: Hierarchical tag organization and analytics
- **Statistics Dashboard**: Comprehensive analytics on bookmarks and domains

### 🌐 **Web Crawling & Fetching**
- **Intelligent Rate Limiting**: Domain-based delays and concurrent request limits
- **Circuit Breaker Pattern**: Automatic failure handling with cooldown periods
- **User-Agent Configuration**: Proper web crawling etiquette
- **Security Features**: Internal IP detection and URL validation
- **Metadata Extraction**: Support for Open Graph, meta tags, and site-specific parsing

### 📡 **Real-time Integration**
- **MQTT Publishing**: Real-time bookmark events with configurable QoS
- **Event Streaming**: Import, add, update, delete event notifications
- **Authentication Support**: Username/password MQTT authentication
- **Custom Topics**: Flexible topic configuration for event routing

### 🏗️ **Enterprise Features**
- **Multi-user Support**: Isolated user profiles with separate databases
- **Resumable Operations**: Large import/export operations with progress saving
- **Concurrent Processing**: Configurable worker pools for optimal performance
- **Database Architecture**: SQLite with caching layer for performance
- **Progress Tracking**: Real-time operation monitoring and reporting

### ⚡ **Performance & Reliability**
- **Bulk Import Mode**: Optimized settings for large datasets (100k+ bookmarks)
- **Memory Optimization**: Efficient processing of large bookmark collections
- **Error Recovery**: Comprehensive error handling and retry mechanisms
- **Transaction Safety**: ACID compliance for data integrity
- **Connection Pooling**: Optimized database and HTTP connections

## 🚀 Quick Start

### Installation

```bash
# Build from source
git clone https://github.com/fallrising/goku.git
cd goku
go build -o bin/goku ./cmd/goku

# Or use the build script
./build.sh --binary
```

### Basic Usage

```bash
# Add a bookmark
goku add --url "https://github.com" --title "GitHub" --tags "development,git"

# Import bookmarks from browser export
goku import --file bookmarks.html

# Bulk import with optimization (100k+ bookmarks)
goku import --file large-bookmarks.json --bulk-mode --domain-delay 2s

# Search bookmarks
goku search --query "golang programming"

# List all bookmarks
goku list --limit 20

# Export bookmarks
goku export --output my-bookmarks.html

# View statistics
goku stats
```

### Multi-user Support

```bash
# Use different profiles for different contexts
goku --user work add --url "https://company.com"
goku --user personal list
goku --user research import --file research-links.txt
```

## 📖 Documentation

- **[Command Reference](./cmd/goku/README.md)** - Detailed command documentation
- **[Import Formats](#import-formats)** - Supported import/export formats
- **[Bulk Import Guide](#bulk-import)** - Optimizing large dataset imports
- **[MQTT Integration](#mqtt-integration)** - Real-time event publishing setup

### Import Formats

Goku supports multiple bookmark formats:

- **HTML**: Browser exports (Chrome, Firefox, Safari, Edge)
- **JSON**: Firefox JSON format with folder hierarchy
- **Text**: Plain URL lists (one per line)

### Bulk Import

For large datasets (100k+ bookmarks), use bulk import mode:

```bash
goku import --file large-bookmarks.json \
  --bulk-mode \
  --domain-delay 2s \
  --fetch-timeout 30s \
  --max-concurrent-domains 5 \
  --resume-file progress.txt
```

**Key Settings:**
- `--domain-delay`: Wait time between requests to same domain
- `--fetch-timeout`: HTTP timeout for metadata fetching
- `--max-concurrent-domains`: Limit concurrent domains
- `--resume-file`: Save progress for resumable imports

### MQTT Integration

Enable real-time bookmark events:

```bash
goku import --file bookmarks.html \
  --mqtt-broker localhost \
  --mqtt-port 1883 \
  --mqtt-topic "bookmarks/imported" \
  --mqtt-username user \
  --mqtt-password pass
```

## 🏗️ Architecture

Goku is built with a modern, modular architecture:

```
cmd/goku/          # CLI interface and commands
internal/bookmarks/ # Core bookmark management
internal/database/  # SQLite with caching layer
internal/fetcher/   # Web content fetching
internal/mqtt/      # Real-time event publishing
pkg/models/         # Data models and types
```

**Key Components:**
- **Repository Pattern**: Clean data access abstraction
- **Worker Pools**: Concurrent processing for imports
- **Circuit Breakers**: Failure handling for web requests
- **Event Streaming**: MQTT-based real-time notifications
- **Caching Layer**: Performance optimization for large datasets

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📊 Performance

**Tested with:**
- ✅ 100k+ bookmark imports
- ✅ Concurrent metadata fetching
- ✅ Multi-user environments
- ✅ Real-time MQTT event streaming
- ✅ Resumable large operations

**Typical Performance:**
- Regular imports: ~1000 bookmarks/minute
- Bulk mode: ~100-500 bookmarks/minute (with 2s domain delays)
- Search: <100ms for 100k bookmarks
- Export: ~5000 bookmarks/minute

## 📄 License

This project is open source. Please check the repository for license details.