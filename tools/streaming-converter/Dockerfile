# Dockerfile
FROM ubuntu:20.04

# Install dependencies
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    inotify-tools \
    jq \
    bc \
    && rm -rf /var/lib/apt/lists/*

# Set up directories
WORKDIR /app
COPY . /app

# Ensure scripts are executable
RUN chmod +x /app/scripts/*.sh

# Entrypoint
ENTRYPOINT ["/app/control.sh", "watch"]

