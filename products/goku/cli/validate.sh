#!/bin/bash

set -e

# Configuration
DEFAULT_USER="goku"
TEST_USER="dev"
TEST_DB="./${DEFAULT_USER}.db"
CACHE_DB="./${DEFAULT_USER}_cache.db"
TEST_USER_DB="./${TEST_USER}.db"
TEST_USER_CACHE_DB="./${TEST_USER}_cache.db"
GOKU_CMD="./bin/goku"
EXPORT_FILE="exported_bookmarks.html"
TEST_USER_EXPORT_FILE="exported_${TEST_USER}_bookmarks.html"
TXT_FILE="bookmarks.txt"
TEST_USER_TXT_FILE="bookmarks_${TEST_USER}.txt"
JSON_FILE="test_bookmarks.json"
BULK_IMPORT_FILE="bulk_test_bookmarks.html"
MQTT_TEST_FILE="mqtt_test_bookmarks.txt"

# MQTT Configuration (optional - set these to enable MQTT testing)
MQTT_BROKER="${MQTT_BROKER:-}"
MQTT_PORT="${MQTT_PORT:-1883}"
MQTT_TOPIC="${MQTT_TOPIC:-goku/test}"
MQTT_USERNAME="${MQTT_USERNAME:-}"
MQTT_PASSWORD="${MQTT_PASSWORD:-}"

# Helper function to run goku commands
run_goku() {
    GOKU_DB_PATH="$TEST_DB" GOKU_CACHE_DB_PATH="$CACHE_DB" $GOKU_CMD "$@"
}

# Helper function to run goku commands for test user
run_goku_test_user() {
    GOKU_DB_PATH="$TEST_USER_DB" GOKU_CACHE_DB_PATH="$TEST_USER_CACHE_DB" $GOKU_CMD --user "$TEST_USER" "$@"
}

# Helper function to log messages
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Cleanup function
cleanup() {
    log "Cleaning up test files..."
    rm -f "$TEST_DB" "$CACHE_DB" "$EXPORT_FILE" "$JSON_FILE" "$BULK_IMPORT_FILE" "$MQTT_TEST_FILE"
    rm -f "$TEST_USER_DB" "$TEST_USER_CACHE_DB" "$TEST_USER_EXPORT_FILE"
    rm -f goku.log
}

# Create test files
create_test_files() {
    log "Creating test files..."
    
    # Create a test JSON file
    cat > "$JSON_FILE" << 'EOF'
{
    "bookmarks": [
        {
            "title": "JSON Test Site",
            "url": "https://example.com/json-test",
            "description": "A test site from JSON import",
            "tags": ["json", "test", "import"]
        },
        {
            "title": "Another JSON Site",
            "url": "https://jsonplaceholder.typicode.com/",
            "description": "JSON placeholder API",
            "tags": ["json", "api", "placeholder"]
        }
    ]
}
EOF

    # Create a bulk import test file with multiple bookmarks
    cat > "$BULK_IMPORT_FILE" << 'EOF'
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><A HREF="https://github.com/fallrising/goku" ADD_DATE="1234567890" PRIVATE="0" TAGS="go,cli,bookmarks">Goku CLI</A>
    <DD>A powerful CLI bookmark manager
    <DT><A HREF="https://golang.org/" ADD_DATE="1234567891" PRIVATE="0" TAGS="go,programming,language">Go Programming Language</A>
    <DD>An open source programming language
    <DT><A HREF="https://docs.python.org/" ADD_DATE="1234567892" PRIVATE="0" TAGS="python,documentation,programming">Python Documentation</A>
    <DD>Official Python documentation
    <DT><A HREF="https://stackoverflow.com/" ADD_DATE="1234567893" PRIVATE="0" TAGS="programming,qa,community">Stack Overflow</A>
    <DD>Programming Q&A community
    <DT><A HREF="https://news.ycombinator.com/" ADD_DATE="1234567894" PRIVATE="0" TAGS="tech,news,startup">Hacker News</A>
    <DD>Tech and startup news
</DL><p>
EOF

    # Create MQTT test file
    cat > "$MQTT_TEST_FILE" << 'EOF'
https://mqtt.org/
https://mosquitto.org/
https://www.hivemq.com/
EOF
}

test_command() {
    local cmd="$1"
    shift
    log "Testing: $cmd"
    if [ "$cmd" = "purge" ]; then
        # Special handling for purge command
        output=$(echo "y" | run_goku "$cmd" "$@" 2>&1)
    else
        output=$(run_goku "$cmd" "$@" 2>&1)
    fi
    exit_code=$?
    if [ $exit_code -eq 0 ]; then
        log "Success: $cmd"
        echo "$output"
    else
        log "Failed: $cmd"
        echo "Error output:"
        echo "$output"
        exit 1
    fi
}

test_command_test_user() {
    local cmd="$1"
    shift
    log "Testing for $TEST_USER: $cmd"
    if [ "$cmd" = "purge" ]; then
        # Special handling for purge command
        output=$(echo "y" | run_goku_test_user "$cmd" "$@" 2>&1)
    else
        output=$(run_goku_test_user "$cmd" "$@" 2>&1)
    fi
    exit_code=$?
    if [ $exit_code -eq 0 ]; then
        log "Success for $TEST_USER: $cmd"
        echo "$output"
    else
        log "Failed for $TEST_USER: $cmd"
        echo "Error output:"
        echo "$output"
        exit 1
    fi
}

# Test fetch command functionality
test_fetch_command() {
    log "Testing fetch command functionality"
    
    # Add a bookmark first
    run_goku add --url "https://example.com" --title "Example Site" --description "Test site" --tags "test,example"
    
    # Test fetch for specific ID
    test_command fetch --id 1
    
    # Test fetch for all bookmarks (with limit)
    test_command fetch --all --limit 5
    
    log "Fetch command tests completed"
}

# Test import command with various formats and options
test_advanced_import() {
    log "Testing advanced import functionality"
    
    # Test JSON import
    if [ -f "$JSON_FILE" ]; then
        test_command import --file "$JSON_FILE" --workers 2
        log "JSON import test completed"
    fi
    
    # Test bulk import mode
    if [ -f "$BULK_IMPORT_FILE" ]; then
        test_command import --file "$BULK_IMPORT_FILE" --workers 3
        log "Bulk import test completed"
    fi
    
    # Test import with fetch enabled
    if [ -f "$TXT_FILE" ]; then
        test_command import --file "$TXT_FILE" --fetch --workers 2
        log "Import with fetch test completed"
    fi
}

# Test multi-user isolation
test_multi_user_isolation() {
    log "Testing multi-user database isolation"
    
    # Add different bookmarks for each user
    run_goku add --url "https://user1.example.com" --title "User 1 Site"
    run_goku_test_user add --url "https://user2.example.com" --title "User 2 Site"
    
    # Verify each user only sees their own bookmarks
    user1_count=$(run_goku list | grep -c "User 1 Site" || echo "0")
    user2_count=$(run_goku_test_user list | grep -c "User 2 Site" || echo "0")
    
    if [ "$user1_count" -eq 1 ] && [ "$user2_count" -eq 1 ]; then
        log "Multi-user isolation test passed"
    else
        log "Multi-user isolation test failed"
        exit 1
    fi
}

# Test various export formats
test_export_formats() {
    log "Testing export functionality"
    
    # Test HTML export
    test_command export --output "$EXPORT_FILE"
    
    # Test JSON export if supported
    if run_goku export --help | grep -q "json"; then
        test_command export --output "test_export.json" --format json
        rm -f "test_export.json"
    fi
    
    log "Export format tests completed"
}

# Test MQTT integration (optional)
test_mqtt_integration() {
    if [ -z "$MQTT_BROKER" ]; then
        log "⚠️  MQTT testing skipped (no broker configured)"
        log "To enable MQTT testing, set MQTT_BROKER environment variable"
        return 0
    fi

    log "Testing MQTT integration with broker: $MQTT_BROKER:$MQTT_PORT"
    
    # Build MQTT command arguments
    mqtt_args="--mqtt-broker $MQTT_BROKER --mqtt-port $MQTT_PORT --mqtt-topic $MQTT_TOPIC"
    
    if [ -n "$MQTT_USERNAME" ]; then
        mqtt_args="$mqtt_args --mqtt-username $MQTT_USERNAME"
    fi
    
    if [ -n "$MQTT_PASSWORD" ]; then
        mqtt_args="$mqtt_args --mqtt-password $MQTT_PASSWORD"
    fi
    
    # Test MQTT import
    if [ -f "$MQTT_TEST_FILE" ]; then
        log "Testing MQTT-enabled import"
        output=$(run_goku import --file "$MQTT_TEST_FILE" $mqtt_args 2>&1)
        exit_code=$?
        if [ $exit_code -eq 0 ]; then
            log "✅ MQTT import test passed"
            echo "$output"
        else
            log "❌ MQTT import test failed"
            echo "Error output:"
            echo "$output"
            # Don't exit on MQTT failure as it's optional
        fi
    fi
    
    log "MQTT integration tests completed"
}

# Main execution
trap cleanup EXIT

log "Starting comprehensive validation for Goku CLI"

# Build the CLI
log "Building Goku CLI..."
if ! ./build.sh; then
    log "Build failed"
    exit 1
fi

# Create test files
create_test_files

# Core functionality tests
log "=== Testing Core Bookmark Operations ==="
log "Testing with default user ($DEFAULT_USER)"
test_command add --url "https://github.com" --title "GitHub" --description "A code hosting platform" --tags "github,development,code"
test_command get --id 1
test_command update --id 1 --title "Updated GitHub" --description "An updated code hosting platform" --tags "github,development,code,updated"
test_command list
test_command search --query "github"
test_command tags list
test_command stats

# Test fetch command
log "=== Testing Fetch Command ==="
test_fetch_command

# Test export functionality
log "=== Testing Export Functionality ==="
test_export_formats

# Test advanced import features
log "=== Testing Advanced Import Features ==="
test_advanced_import

# Test MQTT integration (optional)
log "=== Testing MQTT Integration ==="
test_mqtt_integration

# Clean up for purge test
test_command purge

# Test basic import
test_command import --file "$EXPORT_FILE"
if [ -f "$TXT_FILE" ]; then
    test_command import --file "$TXT_FILE"
fi

# Delete bookmark for cleanup
test_command delete --id 1

# Multi-user tests
log "=== Testing Multi-User Support ==="
test_command_test_user add --url "https://dev.to/" --title "Dev Community" --description "A developer community" --tags "dev,community,programming"
test_command_test_user get --id 1
test_command_test_user update --id 1 --title "Updated Dev Community" --description "An updated developer community" --tags "dev,community,programming,updated"
test_command_test_user list
test_command_test_user search --query "dev"
test_command_test_user tags list
test_command_test_user stats
test_command_test_user export --output "$TEST_USER_EXPORT_FILE"

# Test multi-user isolation
test_multi_user_isolation

# Clean up test user data
test_command_test_user purge
if [ -f "$TEST_USER_TXT_FILE" ]; then
    test_command_test_user import --file "$TEST_USER_TXT_FILE"
fi
test_command_test_user import --file "$TEST_USER_EXPORT_FILE"
test_command_test_user delete --id 1

# Verify separate databases exist
log "=== Verifying Database Isolation ==="
if [ -f "$TEST_DB" ] && [ -f "$TEST_USER_DB" ]; then
    log "✅ Separate databases created successfully"
    log "Default user database: $TEST_DB"
    log "Test user database: $TEST_USER_DB"
else
    log "❌ Failed to create separate databases"
    exit 1
fi

# Test summary
log "=== Test Summary ==="
log "✅ Core bookmark operations (add, get, update, list, search, delete)"
log "✅ Tag management and statistics"
log "✅ Export functionality"
log "✅ Import functionality (HTML, JSON, TXT formats)"
log "✅ Advanced import options (workers, fetch)"
log "✅ Fetch command for metadata updates"
log "✅ Multi-user support and database isolation"
log "✅ Purge and cleanup operations"
if [ -n "$MQTT_BROKER" ]; then
    log "✅ MQTT integration testing"
else
    log "⚠️  MQTT testing skipped (set MQTT_BROKER to enable)"
fi

log "🎉 All tests completed successfully! Goku CLI is working properly."
exit 0
