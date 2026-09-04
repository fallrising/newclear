# Goku API

Goku API is a web server for managing bookmarks. It provides CRUD operations for bookmarks and is designed to work alongside the Goku Consumer.

## Prerequisites

- Go 1.19 or later
- Docker (optional, for containerized deployment)

## Building and Running

### As a Binary

1. Clone the repository:
   ```
   git clone https://github.com/fallrising/goku-api.git
   cd goku-api
   ```

2. Build the binary:
   ```
   go build -o goku-api ./cmd/api
   ```

3. Set up environment variables:
   ```
   export PORT=8080
   export DB_PATH=/path/to/your/bookmarks.db
   ```

4. Run the binary:
   ```
   ./goku-api
   ```

The server will start and listen on the specified port (default 8080).

### As a Docker Container

You have two options for running Goku API as a Docker container:

#### Option 1: Use the pre-built image from Docker Hub

1. Pull the image from Docker Hub:
   ```
   docker pull kccy/goku-api:latest
   ```

2. Run the Docker container:
   ```
   docker run -p 8080:8080 -e PORT=8080 -e DB_PATH=/data/bookmarks.db -v /path/to/your/data:/data kccy/goku-api:latest
   ```

   Replace `/path/to/your/data` with the actual path where you want to store the SQLite database file.

#### Option 2: Build the Docker image yourself

1. Build the Docker image:
   ```
   docker build -t goku-api .
   ```

2. Run the Docker container:
   ```
   docker run -p 8080:8080 -e PORT=8080 -e DB_PATH=/data/bookmarks.db -v /path/to/your/data:/data goku-api
   ```

   Replace `/path/to/your/data` with the actual path where you want to store the SQLite database file.

## API Endpoints

- `POST /upload`: Upload new bookmarks
- `GET /bookmarks`: Retrieve all bookmarks
- `GET /bookmark?url=...`: Retrieve a specific bookmark by URL
- `PUT /bookmark`: Update an existing bookmark
- `DELETE /bookmark/:id`: Delete a bookmark by ID

## Configuration

The following environment variables can be used to configure the application:

- `PORT`: The port on which the server will listen (default: 8080)
- `DB_PATH`: The path to the SQLite database file

## Deploying to a Server

1. Build the binary for your target system (if different from your development machine):
   ```
   GOOS=linux GOARCH=amd64 go build -o goku-api ./cmd/api
   ```

2. Transfer the binary to your server.

3. On the server, set up the necessary environment variables and run the binary.

Alternatively, if using Docker:

1. Pull the pre-built image from Docker Hub or build the image yourself.
2. On your server, run the Docker container with the appropriate environment variables and volume mounting.

## Contributing

Please read CONTRIBUTING.md for details on our code of conduct, and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the LICENSE file for details.