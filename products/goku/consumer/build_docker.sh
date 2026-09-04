#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Docker Hub username
DOCKER_USERNAME="kccy"

# Repository name
REPO_NAME="goku-consumer"

# Image tag
IMAGE_TAG="latest"

# Full image name
IMAGE_NAME="$DOCKER_USERNAME/$REPO_NAME:$IMAGE_TAG"

# Build the Docker image
echo "Building Docker image..."
docker build -t $IMAGE_NAME .

# Log in to Docker Hub
#echo "Logging in to Docker Hub..."
#docker login

# Push the image to Docker Hub
echo "Pushing image to Docker Hub..."
docker push $IMAGE_NAME

echo "Build and push completed successfully!"