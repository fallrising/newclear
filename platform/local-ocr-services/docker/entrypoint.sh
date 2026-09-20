#!/bin/sh
set -eu

if [ ! -s "${OCR_ARTIFACT_MANIFEST}" ]; then
    echo "OCR artifact manifest is missing or empty" >&2
    exit 1
fi

sha256sum --check --quiet "${OCR_ARTIFACT_MANIFEST}"
exec "$@"
