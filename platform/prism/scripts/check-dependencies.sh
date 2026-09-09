#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
prism_root="$(cd -- "$script_dir/.." && pwd)"
go_bin="${GO:-go}"

export GOFLAGS="${GOFLAGS:--mod=readonly}"

cd -- "$prism_root"
module_path="$("$go_bin" list -m -f '{{.Path}}')"
failure_count=0

report_violation() {
	printf 'dependency guard: %s\n' "$1" >&2
	((failure_count += 1))
}

pkg_dependencies="$("$go_bin" list -deps -f '{{if not .Standard}}{{.ImportPath}}{{end}}' ./pkg/...)"
while IFS= read -r dependency; do
	case "$dependency" in
	"$module_path/internal" | "$module_path/internal/"*)
		report_violation "pkg must not depend on internal: $dependency"
		;;
	"$module_path/drivers" | "$module_path/drivers/"*)
		report_violation "pkg must not depend on drivers: $dependency"
		;;
	esac
done <<<"$pkg_dependencies"

driver_packages="$("$go_bin" list ./drivers/... 2>/dev/null)"
while IFS= read -r driver_package; do
	[[ -n "$driver_package" ]] || continue
	driver_relative="${driver_package#"$module_path/drivers/"}"
	driver_name="${driver_relative%%/*}"
	driver_prefix="$module_path/drivers/$driver_name"
	driver_dependencies="$("$go_bin" list -deps -f '{{if not .Standard}}{{.ImportPath}}{{end}}' "$driver_package")"
	while IFS= read -r dependency; do
		case "$dependency" in
		"$module_path/internal" | "$module_path/internal/"*)
			report_violation "$driver_package must not depend on internal: $dependency"
			;;
		"$driver_prefix" | "$driver_prefix/"*)
			;;
		"$module_path/drivers" | "$module_path/drivers/"*)
			report_violation "$driver_package must not depend on another driver: $dependency"
			;;
		esac
	done <<<"$driver_dependencies"
done <<<"$driver_packages"

compat_packages="$("$go_bin" list ./internal/compat/... 2>/dev/null)"
while IFS= read -r compat_package; do
	[[ -n "$compat_package" ]] || continue
	compat_dependencies="$("$go_bin" list -deps -f '{{if not .Standard}}{{.ImportPath}}{{end}}' "$compat_package")"
	while IFS= read -r dependency; do
		case "$dependency" in
		"$module_path/drivers" | "$module_path/drivers/"*)
			report_violation "$compat_package must not depend on drivers: $dependency"
			;;
		esac
	done <<<"$compat_dependencies"
done <<<"$compat_packages"

all_dependencies="$("$go_bin" list -deps -test -f '{{if not .Standard}}{{.ImportPath}}{{end}}' ./...)"
while IFS= read -r dependency; do
	case "$dependency" in
	github.com/grafana/loki | github.com/grafana/loki/* | \
		github.com/grafana/tempo | github.com/grafana/tempo/* | \
		github.com/grafana/grafana | github.com/grafana/grafana/*)
		report_violation "AGPL import is forbidden: $dependency"
		;;
	esac
done <<<"$all_dependencies"

if ((failure_count > 0)); then
	printf 'dependency guard: FAIL (%d violation(s))\n' "$failure_count" >&2
	exit 1
fi

printf 'dependency guard: PASS\n'
