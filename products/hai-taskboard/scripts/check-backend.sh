#!/usr/bin/env bash
set -euo pipefail

component_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export GOTOOLCHAIN=local
bash "$component_dir/scripts/check-ci-pins.sh" backend
cd -- "$component_dir/backend"

# Race coverage requires CGO and a working C compiler; fail before downloads otherwise.
export CGO_ENABLED=1
compiler="$(go env CC)"
read -r -a compiler_command <<< "$compiler"
command -v "${compiler_command[0]}" >/dev/null || {
  printf 'Backend race gate requires a C compiler: %s\n' "$compiler" >&2
  exit 1
}

go mod download
go mod verify
unformatted="$(gofmt -l .)"
if [[ -n "$unformatted" ]]; then
  printf 'Go formatting differences:\n%s\n' "$unformatted" >&2
  exit 1
fi
go vet ./...
go test -count=1 ./...
go test -race -count=1 ./...
# This is a compile gate, not a release artifact; VCS stamping is unnecessary.
go build -buildvcs=false ./...
