# === Builder Stage ===
# Use a Debian-based Go image (e.g., Bookworm) for better glibc compatibility with Cgo
FROM golang:1.24-bookworm AS builder

# Set the working directory inside the container
WORKDIR /app

# Install necessary C/C++ build tools for Cgo dependencies on Debian
# gcc, g++, libc6-dev (glibc dev files), and zlib1g-dev (common dependency)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc g++ libc6-dev zlib1g-dev && \
    # Clean up apt cache to reduce image size
    rm -rf /var/lib/apt/lists/*

# Copy go.mod and go.sum first to leverage Docker layer caching
COPY go.mod go.sum ./
# Download dependencies
RUN go mod download

# Copy the entire project source code into the container
COPY . .

# Define ldflags for stripping symbols and debug info (reduces binary size)
# Passed as build argument, but can be hardcoded if preferred
ARG LDFLAGS_STR="-s -w"

# Build the Go application NATIVELY for the container's Linux environment
# No need to set GOOS/GOARCH when building for the container's native platform
RUN echo "Building natively for Debian Linux..." && \
    # Ensure CGO is enabled (usually default, but explicit is safer)
    export CGO_ENABLED=1 && \
    # The actual build command. Add -v for verbose output if needed for debugging.
    go build -ldflags="${LDFLAGS_STR}" \
    # Output the binary to a specific location within the builder stage
    -o "/build/goku-linux-$(go env GOARCH)" \
    # Specify the main package path
    ./cmd/goku/

# === Final Stage ===
# Use a minimal, compatible base image for the final artifact
FROM debian:bookworm-slim

# Set working directory in the final image
WORKDIR /app

# Copy *only* the built Linux binary from the builder stage
# Ensure the source path matches the output path in the builder stage's RUN command
COPY --from=builder /build/goku-linux-* /app/bin/

# Make the binary executable
RUN chmod +x /app/bin/goku-linux-*

# (Optional) Define runtime behavior if this image were to be run directly
# For example, setting an entrypoint:
# ENTRYPOINT ["/app/bin/goku-linux-amd64"]
# Since this Dockerfile is just for building, an entrypoint isn't strictly necessary.