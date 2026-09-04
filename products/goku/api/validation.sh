#!/bin/bash

# Set the base URL for your API
PORT=8090
BASE_URL="http://localhost:$PORT/api/v1"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored output
print_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}[SUCCESS]${NC} $2"
    else
        echo -e "${RED}[FAILED]${NC} $2"
    fi
}

# Function to check if the server is running
is_server_running() {
    curl -s -o /dev/null -w "%{http_code}" $BASE_URL/health
}

# Function to find PID using lsof
find_pid_lsof() {
    lsof -ti:$PORT 2>/dev/null
}

# Function to find PID using netstat
find_pid_netstat() {
    netstat -tlnp 2>/dev/null | awk '$4 ~ /:'"$PORT"'$/ {split($NF,a,"/"); print a[1]}'
}

# Function to find PID using ss
find_pid_ss() {
    ss -tlnp 2>/dev/null | awk '$4 ~ /:'"$PORT"'$/ {split($NF,a,","); print a[2]}' | sed 's/pid=//'
}

# Function to find and kill the process using the specified port
kill_server() {
    echo "Stopping the server..."
    PID=$(find_pid_lsof || find_pid_netstat || find_pid_ss)
    if [ ! -z "$PID" ]; then
        echo "Killing process $PID using port $PORT"
        kill -15 $PID
        sleep 2
        if kill -0 $PID 2>/dev/null; then
            echo "Process did not stop gracefully. Forcing kill..."
            kill -9 $PID
        fi
    else
        echo "No process found using port $PORT"
    fi
}

# Function to start the server
start_server() {
    echo "Starting the server..."
    go run cmd/api/main.go &

    # Wait for the server to start (timeout after 30 seconds)
    for i in {1..30}; do
        if [ "$(is_server_running)" == "200" ]; then
            echo "Server started successfully."
            return 0
        fi
        sleep 1
    done

    echo "Failed to start server within 30 seconds."
    return 1
}

# Ensure any existing server is stopped
kill_server

# Start the server
start_server
if [ $? -ne 0 ]; then
    echo "Failed to start server. Exiting tests."
    exit 1
fi

# Ensure server is stopped on script exit
trap kill_server EXIT

# Test POST /upload
echo "Testing POST /upload"
UPLOAD_RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" -d '[
    {"url":"https://example.com", "title":"Example Website", "description":"An example website", "tags":["example", "test"]},
    {"url":"https://github.com", "title":"GitHub", "description":"Where the world builds software", "tags":["git", "development"]}
]' $BASE_URL/upload)
echo $UPLOAD_RESPONSE | jq .
print_result $? "POST /upload"

# Test GET /bookmarks
echo "Testing GET /bookmarks"
GET_ALL_RESPONSE=$(curl -s -X GET $BASE_URL/bookmarks)
echo $GET_ALL_RESPONSE | jq .
print_result $? "GET /bookmarks"

# Test GET /bookmark?url=...
echo "Testing GET /bookmark?url=..."
GET_BY_URL_RESPONSE=$(curl -s -X GET "$BASE_URL/bookmark?url=https://example.com")
echo $GET_BY_URL_RESPONSE | jq .
print_result $? "GET /bookmark?url=..."

# Test PUT /bookmark
echo "Testing PUT /bookmark"
UPDATE_RESPONSE=$(curl -s -X PUT -H "Content-Type: application/json" -d '{
    "id": 1,
    "url": "https://example.com",
    "title": "Updated Example Website",
    "description": "An updated example website",
    "tags": ["example", "test", "updated"]
}' $BASE_URL/bookmark)
echo $UPDATE_RESPONSE | jq .
print_result $? "PUT /bookmark"

# Test DELETE /bookmark/:id
echo "Testing DELETE /bookmark/:id"
DELETE_RESPONSE=$(curl -s -X DELETE $BASE_URL/bookmark/2)
echo $DELETE_RESPONSE | jq .
print_result $? "DELETE /bookmark/:id"

# Final GET to verify changes
echo "Final GET to verify changes"
FINAL_GET_RESPONSE=$(curl -s -X GET $BASE_URL/bookmarks)
echo $FINAL_GET_RESPONSE | jq .
print_result $? "Final GET /bookmarks"

echo "API testing completed."