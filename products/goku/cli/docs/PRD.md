# Comprehensive Product Requirements Document: Goku CLI

## 1. Introduction

Goku CLI is a command-line interface application for managing bookmarks, inspired by the open-source project Buku. It aims to provide a powerful, flexible, and user-friendly tool for organizing and searching web bookmarks directly from the terminal, with advanced import capabilities and efficient data management.

## 2. Objectives

- Create a fast and efficient bookmark management system
- Provide a user-friendly CLI interface using the gum library
- Offer advanced features such as content analysis, similarity search, and web crawling
- Ensure data privacy by keeping all data local
- Support multiple import and export formats for easy migration
- Enable high-performance, parallel importing of bookmarks

## 3. Target Users

- Command-line enthusiasts
- Developers and system administrators
- Privacy-conscious internet users
- Users who prefer keyboard-based navigation and management
- Users with large bookmark collections requiring efficient import and management

## 4. Key Features

### 4.1 Bookmark Management
- Add new bookmarks with URL, title, tags, and description
  - Automatically fetch title, tags, and description from the target website
- Update existing bookmarks
- Delete bookmarks
  - Delete a single bookmark
  - Delete a range of bookmarks
  - Delete all bookmarks
- Search bookmarks by various criteria (URL, title, tags, content)
- List and print bookmarks
  - Print all bookmarks
  - Print bookmarks by ID or range
  - Print with specific fields filtered out

### 4.2 Tag Management
- Add tags to bookmarks
- Remove tags from bookmarks
- List all tags
- Search bookmarks by tags
- Suggest similar tags based on existing bookmarks
- Replace existing tags with new tags
- Show a list of unique tags in the database

### 4.3 Import and Export
- Import bookmarks from various formats:
  - HTML (Firefox, Chrome, IE)
  - JSON (Firefox)
  - CSV
  - Markdown
  - Orgfile
  - XBEL
  - RSS feeds
  - Another Goku database
- Export bookmarks to various formats:
  - HTML (Firefox compatible)
  - JSON
  - CSV
  - Markdown
  - Orgfile
  - XBEL
  - RSS feed
  - Another Goku database
- Parallel import capability via dedicated import server
- Auto-import from browsers:
  - Firefox
  - Chrome
  - Chromium
  - Vivaldi
  - Microsoft Edge

### 4.4 Content Analysis
- Automatically fetch and store webpage metadata
- Extract keywords and generate tag suggestions
- Summarize webpage content

### 4.5 Similarity Search
- Find similar bookmarks based on content or metadata

### 4.6 Web Crawling
- Crawl bookmarked pages to extract additional information
- Discover and suggest related links

### 4.7 Translation
- Translate bookmark titles and descriptions
- Support both API-based and local LLM-based translation

### 4.8 Browser Integration
- Open bookmarks in the default browser by ID or range
- Open a random bookmark
- Open a cached version of a bookmark from the Wayback Machine

### 4.9 Database Management
- Use SQLite for local storage in CLI
- Use DuckDB for persistent storage in import server
- Support database merging for synchronization
- Provide database backup and restore functionality

### 4.10 Additional Features
- Encryption/Decryption: Securely encrypt the bookmark database for privacy
- URL Shortening/Expanding: Shorten or expand URLs using the tny.im service
- Clipboard Integration: Copy bookmark URLs to the system clipboard
- Version Checking: Check for the latest upstream release version

## 5. Technical Specifications

### 5.1 Technology Stack
- Primary Programming Language: Go
- Secondary Programming Language: Python (for specific components)
- CLI Interface: gum library (Go)
- CLI Database: SQLite
- Import Server Database: DuckDB
- Testing: Go testing framework and Python unittest
- Required Python libraries:
  - urllib3 for HTTP requests
  - BeautifulSoup for HTML parsing
  - cryptography for encryption (optional)

### 5.2 Application Structure
- Follow a modular architecture (as outlined in the project structure)
- Use interfaces for flexibility and easier testing
- Implement a plugin system for extensibility

### 5.3 Performance Requirements
- Fast search and retrieval (< 100ms for most operations)
- Efficient handling of large numbers of bookmarks (1,000,000+)
- Minimal memory footprint

### 5.4 Security and Privacy
- All data stored locally
- Option for database encryption
- No tracking or data collection

### 5.5 Import Server
- Support HTTP server and Unix domain socket for communication
- Implement parallel processing for high-performance importing
- Use a set data structure to ensure URL uniqueness
- Provide detailed error logging for monitoring and debugging
- Persist import data and state using DuckDB

## 6. User Interface

### 6.1 Command Structure
- `goku add`: Add a new bookmark (with automatic metadata fetching)
- `goku search`: Search bookmarks
- `goku update`: Update a bookmark
- `goku delete`: Delete a bookmark
- `goku export`: Export bookmarks
- `goku import`: Import bookmarks (can use local or server-based import)
- `goku tags`: Manage tags
- `goku similar`: Find similar bookmarks
- `goku crawl`: Crawl a bookmarked page
- `goku server`: Start the import server
- Additional commands for browser integration, encryption, and other features

### 6.2 Interactive Elements
- Use gum for interactive prompts and selections
- Implement autocomplete for tags and URLs
- Provide colorized output for better readability
- Support piped input from other programs

## 7. Data Model

### 7.1 Bookmark
- URL (required, unique)
- Title (automatically fetched)
- Description (automatically fetched)
- Tags (array of strings, partially auto-generated)
- Created timestamp
- Updated timestamp
- Metadata (JSON blob)

## 8. Import Server Specifications

### 8.1 Server Modes
- HTTP server mode
- Unix domain socket mode

### 8.2 Parallel Processing
- Support multiple Goku CLI instances importing simultaneously
- Use goroutines for parallel processing of import requests

### 8.3 Data Management
- Use DuckDB for persistent storage of import data and state
- Implement a set data structure to ensure URL uniqueness across imports

### 8.4 Logging and Monitoring
- Detailed error logging for failed imports
- Performance metrics logging
- Support for external monitoring tools

### 8.5 Debug Mode
- Verbose logging option for debugging
- Endpoint for querying server state and import progress

## 9. Detailed Feature Implementations

### 9.1 Bookmark Management Functions
- `add_rec()`: Adds a new bookmark to the database
- `edit_at_prompt()`: Opens an editor to add a new bookmark
- `update_rec()`: Updates an existing bookmark's URL, title, tags, description, and immutability
- `refreshdb()`: Refreshes the title and description of bookmarks from the web
- `delete_rec()`: Deletes a single bookmark or a range of bookmarks
- `delete_resultset()`: Deletes a set of search results
- `delete_rec_all()`: Deletes all bookmarks from the database
- `cleardb()`: Drops the bookmark table, effectively deleting all bookmarks
- `get_rec_all()`: Retrieves all bookmarks from the database
- `get_rec_by_id()`: Retrieves a bookmark by its ID
- `get_rec_all_by_ids()`: Retrieves multiple bookmarks by their IDs
- `print_rec()`: Prints bookmark details to the console
- `print_rec_with_filter()`: Prints records with specific fields filtered out
- `print_single_rec()`: Prints a single bookmark record

### 9.2 Search Functions
- `searchdb()`: Searches bookmarks by keyword in URL, title, tags, or description
- `search_by_tag()`: Searches for bookmarks with specific tags
- `search_keywords_and_filter_by_tags()`: Combines keyword search with tag filtering
- `exclude_results_from_search()`: Excludes specific keywords from search results

### 9.3 Tag Management Functions
- `append_tag_at_index()`: Appends tags to a bookmark's existing tag set
- `delete_tag_at_index()`: Removes tags from a bookmark's existing tag set
- `get_tag_all()`: Retrieves a list of unique tags and their usage count
- `suggest_similar_tag()`: Suggests similar tags based on existing bookmarks
- `replace_tag()`: Replaces an existing tag with a new tag
- `get_tagstr_from_taglist()`: Constructs a comma-separated string of tags from a list
- `set_tag()`: Appends, overwrites, or removes tags from specific bookmarks
- `show_taglist()`: Displays a list of unique tags in the database

### 9.4 Browser Integration Functions
- `browse_by_index()`: Opens a bookmark in the browser by ID or range
- `browse()`: Opens a URL in the default browser
- `auto_import_from_browser()`: Imports bookmarks from Firefox, Chrome, Vivaldi, and Edge
- `load_chrome_database()`: Imports bookmarks from Chrome's JSON database
- `load_firefox_database()`: Imports bookmarks from Firefox's SQLite database
- `load_edge_database()`: Imports bookmarks from Edge's JSON database
- `browse_cached_url()`: Opens a cached version of a bookmark from the Wayback Machine

### 9.5 Import/Export Functions
- `importdb()`: Imports bookmarks from various file formats
- `mergedb()`: Merges bookmarks from another Goku database file
- `import_md()`: Parses a Markdown file for bookmark data
- `import_org()`: Parses an Orgfile for bookmark data
- `import_rss()`: Parses an RSS feed for bookmark data
- `import_firefox_json()`: Parses a JSON file exported from Firefox for bookmark data
- `import_xbel()`: Parses an XBEL file for bookmark data
- `import_html()`: Parses an HTML file for bookmark data
- `exportdb()`: Exports bookmarks to various file formats
- `convert_bookmark_set()`: Converts bookmark data into various formats for export

### 9.6 Encryption/Decryption Functions
- `GokuCrypt.encrypt_file()`: Encrypts the Goku database file
- `GokuCrypt.decrypt_file()`: Decrypts the Goku database file

### 9.7 URL Management Functions
- `tnyfy_url()`: Shortens or expands a URL using the tny.im service

### 9.8 Clipboard Functions
- `copy_to_clipboard()`: Copies a URL to the system clipboard

### 9.9 Version Management Functions
- `check_upstream_release()`: Checks for the latest upstream release version

## 10. Helper Functions

- `is_bad_url()`: Checks for malformed URLs
- `is_nongeneric_url()`: Identifies non-HTTP and non-generic URLs
- `is_ignored_mime()`: Checks if a URL links to a MIME type that should be skipped during fetching
- `is_unusual_tag()`: Identifies unusual tag strings
- `parse_decoded_page()`: Extracts title, description, and keywords from a decoded HTML page
- `get_data_from_page()`: Detects encoding and extracts data from an HTTP response
- `gen_headers()`: Generates headers for network requests
- `get_PoolManager()`: Creates a pool manager for HTTP requests with proxy support
- `fetch_data()`: Handles server connections and redirects for fetching page data
- `parse_tags()`: Formats and cleanses a list of tags into a comma-separated string
- `prep_tag_search()`: Prepares a list of tags for search and determines the search operator
- `gen_auto_tag()`: Generates a tag in YYYYMonDD format
- `edit_rec()`: Opens an editor to edit a bookmark record
- `to_temp_file_content()`: Generates content for the temporary file used by the editor
- `parse_temp_file_content()`: Parses the content of the temporary file edited by the user
- `get_system_editor()`: Retrieves the default system editor from the environment
- `is_editor_valid()`: Checks for a valid editor string
- `regexp()`: Performs a regular expression search
- `delim_wrap()`: Wraps a string in delimiter characters
- `read_in()`: Handles user input with interrupts disabled
- `sigint_handler()`: Custom handler for SIGINT (Ctrl+C)
- `disable_sigint_handler()`: Disables the custom SIGINT handler
- `enable_sigint_handler()`: Enables the custom SIGINT handler
- `setup_logger()`: Sets up logging with colored output
- `piped_input()`: Handles input piped from another program
- `setcolors()`: Configures color output
- `unwrap()`: Unwraps text by removing line breaks
- `check_stdout_encoding()`: Ensures stdout encoding is UTF-8
- `monkeypatch_textwrap_for_cjk()`: Patches the textwrap module for handling CJK wide characters
- `parse_range()`: Parses a string containing comma-separated indices and ranges
- `get_firefox_profile_names()`: Lists Firefox profiles and detects default profiles

## 11. Future Enhancements

- Implement a TUI (Text User Interface) for a more visual experience
- Add support for bookmark sharing and collaboration
- Integrate with browser extensions for easier bookmarking
- Implement full-text search capabilities
- Add support for bookmark categories or folders
- Develop a distributed version for enterprise use
- Improve user experience with better interactive prompts and feedback
- Implement more sophisticated tag management features, such as tag hierarchies
- Add support for cloud synchronization of bookmarks
- Integrate with other command-line tools and workflows

## 12. Success Metrics

- Number of active users
- User retention rate
- Number of bookmarks managed per user
- Performance metrics (speed of operations, import throughput)
- Community engagement (contributions, issues raised, feature requests)
- User feedback and satisfaction

## 13. Development Roadmap

- Phase 1 (MVP): Core bookmark management features
- Phase 2: Advanced features (content analysis, similarity search)
- Phase 3: Import server implementation and DuckDB integration
- Phase 4: Translation and web crawling capabilities
- Phase 5: Performance optimizations and scaling improvements

## 14. Risks and Mitigations

- Performance issues with large datasets: Implement efficient indexing and caching, leverage DuckDB's performance
- User adoption: Ensure excellent documentation and ease of use
- Data loss: Implement robust backup and restore features
- Privacy concerns: Emphasize local-only storage and optional encryption
- Import server bottlenecks: Implement careful performance monitoring and optimization

This comprehensive PRD combines all the information from both original documents, maintaining the full level of detail and adding structure for easy reference during development. It serves as a complete guide for the Goku CLI project and can be updated as the project evolves.
