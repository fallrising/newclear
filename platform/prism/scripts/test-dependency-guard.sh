#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
prism_root="$(cd -- "$script_dir/.." && pwd)"
go_bin="${GO:-go}"
temporary_parent="${TMPDIR:-/tmp}"
suite_root="$(mktemp -d "$temporary_parent/prism-dependency-guard.XXXXXX")"

cleanup() {
	if [[ "$suite_root" == "$temporary_parent"/prism-dependency-guard.* ]]; then
		rm -rf -- "$suite_root"
	else
		printf 'dependency guard self-test: refusing to remove unexpected path %s\n' "$suite_root" >&2
	fi
}
trap cleanup EXIT

export GOFLAGS="${GOFLAGS:--mod=readonly}"
module_path="$(cd -- "$prism_root" && "$go_bin" list -m -f '{{.Path}}')"

copy_case() {
	local case_name="$1"
	local case_root="$suite_root/$case_name"
	mkdir -p -- "$case_root"
	cp -R -- "$prism_root/." "$case_root/"
	printf '%s\n' "$case_root"
}

expect_guard_failure() {
	local case_name="$1"
	local case_root="$2"
	local expected="$3"
	local output

	if output="$(cd -- "$case_root" && bash scripts/check-dependencies.sh 2>&1)"; then
		printf 'dependency guard self-test %s: expected failure, got success\n' "$case_name" >&2
		exit 1
	fi
	if [[ "$output" != *"$expected"* ]]; then
		printf 'dependency guard self-test %s: missing expected diagnostic %q\n%s\n' "$case_name" "$expected" "$output" >&2
		exit 1
	fi
	printf 'dependency guard self-test %s: PASS\n' "$case_name"
}

bash "$prism_root/scripts/check-dependencies.sh"

case_root="$(copy_case pkg-to-driver)"
cat >"$case_root/pkg/spi/conformance/dependency_guard_violation.go" <<EOF
package conformance

import _ "$module_path/drivers/memory"
EOF
expect_guard_failure pkg-to-driver "$case_root" 'pkg must not depend on drivers'

case_root="$(copy_case driver-to-internal)"
mkdir -p -- "$case_root/internal/guardfixture"
cat >"$case_root/internal/guardfixture/fixture.go" <<'EOF'
package guardfixture
EOF
cat >"$case_root/drivers/memory/dependency_guard_violation.go" <<EOF
package memory

import _ "$module_path/internal/guardfixture"
EOF
expect_guard_failure driver-to-internal "$case_root" 'must not depend on internal'

case_root="$(copy_case driver-to-driver)"
mkdir -p -- "$case_root/drivers/guardfixture"
cat >"$case_root/drivers/guardfixture/fixture.go" <<'EOF'
package guardfixture
EOF
cat >"$case_root/drivers/memory/dependency_guard_violation.go" <<EOF
package memory

import _ "$module_path/drivers/guardfixture"
EOF
expect_guard_failure driver-to-driver "$case_root" 'must not depend on another driver'

case_root="$(copy_case compat-to-driver)"
mkdir -p -- "$case_root/internal/compat/guardfixture"
cat >"$case_root/internal/compat/guardfixture/dependency_guard_violation.go" <<EOF
package guardfixture

import _ "$module_path/drivers/memory"
EOF
expect_guard_failure compat-to-driver "$case_root" 'must not depend on drivers'

case_root="$(copy_case agpl-import)"
mkdir -p -- "$case_root/agpl-fixture" "$case_root/internal/guardagpl"
cat >"$case_root/agpl-fixture/go.mod" <<'EOF'
module github.com/grafana/loki

go 1.23.0
EOF
cat >"$case_root/agpl-fixture/loki.go" <<'EOF'
package loki
EOF
(
	cd -- "$case_root"
	"$go_bin" mod edit -require=github.com/grafana/loki@v0.0.0
	"$go_bin" mod edit -replace=github.com/grafana/loki=./agpl-fixture
)
cat >"$case_root/internal/guardagpl/dependency_guard_violation.go" <<'EOF'
package guardagpl

import _ "github.com/grafana/loki"
EOF
expect_guard_failure agpl-import "$case_root" 'AGPL import is forbidden'

printf 'dependency guard self-test: PASS\n'
