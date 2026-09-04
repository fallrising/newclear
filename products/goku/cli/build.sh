#!/bin/bash
# Build script for Goku CLI

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
OUTPUT_DIR="bin"                    # Directory to store built binaries
IMAGE_NAME="goku-builder"           # Name for the Docker build image
LDFLAGS_STR="-s -w"                 # Linker flags to strip binary
MAIN_PACKAGE="./cmd/goku/"          # Path to the main Go package

# --- Help Function ---
show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Build script for Goku CLI bookmark manager"
    echo ""
    echo "OPTIONS:"
    echo "  -h, --help       Show this help message"
    echo "  -d, --docker     Build Docker image only"
    echo "  -b, --binary     Build native binary only" 
    echo "  -q, --quick      Build optimized binary to bin/goku (fastest)"
    echo "  -a, --all        Build both Docker and binary (default)"
    echo "  -o, --output DIR Specify output directory (default: bin)"
    echo ""
    echo "Examples:"
    echo "  $0                    # Build both Docker and binary"
    echo "  $0 --docker           # Build Docker image only"
    echo "  $0 --binary           # Build native binary only"
    echo "  $0 --quick            # Quick optimized build to bin/goku"
    echo "  $0 --all --output dist # Build both to 'dist' directory"
    echo ""
}

# --- Parse Command Line Arguments ---
BUILD_DOCKER=false
BUILD_BINARY=false
BUILD_ALL=false
BUILD_QUICK=false

# Set default behavior if no flags provided
if [ $# -eq 0 ]; then
    BUILD_ALL=true
fi

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -d|--docker)
            BUILD_DOCKER=true
            BUILD_ALL=false
            shift
            ;;
        -b|--binary)
            BUILD_BINARY=true
            BUILD_ALL=false
            shift
            ;;
        -q|--quick)
            BUILD_QUICK=true
            BUILD_ALL=false
            shift
            ;;
        -a|--all)
            BUILD_ALL=true
            shift
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Set build flags based on user choice
if [ "$BUILD_ALL" = true ]; then
    BUILD_DOCKER=true
    BUILD_BINARY=true
fi

# Handle quick build option
if [ "$BUILD_QUICK" = true ]; then
    echo "=== Quick Build Mode ==="
    echo "Building optimized binary to ${OUTPUT_DIR}/goku..."
    mkdir -p "${OUTPUT_DIR}"
    go build -ldflags="${LDFLAGS_STR}" -o "${OUTPUT_DIR}/goku" "${MAIN_PACKAGE}"
    echo "Quick build complete!"
    echo "Binary location: ${OUTPUT_DIR}/goku"
    ls -lh "${OUTPUT_DIR}/goku"
    exit 0
fi

# Validate that at least one build type is selected
if [ "$BUILD_DOCKER" = false ] && [ "$BUILD_BINARY" = false ]; then
    echo "Error: No build type selected. Use --help for options."
    exit 1
fi

echo "=== Goku CLI Build Script ==="
echo "Output directory: ${OUTPUT_DIR}"
echo "Build Docker: ${BUILD_DOCKER}"
echo "Build Binary: ${BUILD_BINARY}"
echo "============================="

# --- Ensure Output Directory Exists ---
echo "Creating output directory: ${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

# --- Build Linux Binary using Docker ---
if [ "$BUILD_DOCKER" = true ]; then
    echo "--- Building Linux Binary (via Docker) ---"

    echo "Building Docker image ${IMAGE_NAME}..."
    # Build the Docker image using the Dockerfile in the current directory
    # Assumes Dockerfile uses a Debian base as per previous recommendation
    docker build -t ${IMAGE_NAME} .

    echo "Running Docker container to build Linux binary..."
    # Run the container to copy the built binary via volume mount
    docker run --rm \
      -v "$(pwd)/${OUTPUT_DIR}:/app/bin" \
      ${IMAGE_NAME} \
      echo "Linux binary build complete (occurred during image build), copied via volume mount."

    echo "Linux build process finished."
    echo "----------------------------------------"
else
    echo "Skipping Docker build (not requested)"
    echo "----------------------------------------"
fi


# --- Build macOS Binary Natively (for Host Architecture) ---
if [ "$BUILD_BINARY" = true ]; then
    # These commands run directly on the host machine (your Mac)
    # Requires Go and Xcode Command Line Tools to be installed locally
    echo "--- Building macOS Binary (Natively for Host Architecture) ---"

    # Check if running on macOS
    if [ "$(uname)" == "Darwin" ]; then
        # Detect host architecture
        HOST_ARCH=$(uname -m)
        TARGET_GOARCH=""
        OUTPUT_SUFFIX=""

        # Determine GOARCH and filename suffix based on host architecture
        if [ "${HOST_ARCH}" = "x86_64" ]; then
            TARGET_GOARCH="amd64"
            OUTPUT_SUFFIX="amd64"
            echo "Detected Intel Mac (x86_64), setting GOARCH=amd64"
        elif [ "${HOST_ARCH}" = "arm64" ]; then
            TARGET_GOARCH="arm64"
            OUTPUT_SUFFIX="arm64"
            echo "Detected Apple Silicon Mac (arm64), setting GOARCH=arm64"
        else
            echo "Warning: Unsupported macOS architecture detected: ${HOST_ARCH}. Skipping native macOS build."
            # Skip the build by not setting TARGET_GOARCH
        fi

        # Only proceed if a supported architecture was detected
        if [ -n "${TARGET_GOARCH}" ]; then
            echo "Building for macOS ${TARGET_GOARCH}..."
            # Ensure CGO is enabled
            # Add -v for verbose output, helpful for debugging Cgo issues
            CGO_ENABLED=1 GOOS=darwin GOARCH=${TARGET_GOARCH} go build -v -ldflags="${LDFLAGS_STR}" -o "${OUTPUT_DIR}/goku-darwin-${OUTPUT_SUFFIX}" "${MAIN_PACKAGE}"
            echo "Finished native macOS ${TARGET_GOARCH} build."
        fi
    else
        echo "Not running on macOS, skipping native macOS build."
    fi
    echo "----------------------------------------"
else
    echo "Skipping native binary build (not requested)"
    echo "----------------------------------------"
fi


# --- Build Windows Binary (Placeholder) ---
# CGO cross-compilation from macOS to Windows is non-trivial.
# This section remains commented out as it requires specific setup (e.g., mingw-w64).
# echo "--- Building Windows Binary (Natively - Requires Setup) ---"
# echo "Building for Windows amd64 (requires mingw-w64 or similar)..."
# CGO_ENABLED=1 GOOS=windows GOARCH=amd64 CC=x86_64-w64-mingw32-gcc go build -v -ldflags="${LDFLAGS_STR}" -o "${OUTPUT_DIR}/goku-windows-amd64.exe" "${MAIN_PACKAGE}"
# echo "----------------------------------------"


# --- Summary ---
echo "Build script finished."
echo "Binaries are located in: ${OUTPUT_DIR}/"
ls -lh "${OUTPUT_DIR}/"