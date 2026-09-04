SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
.NOTPARALLEL:

CARGO ?= cargo
NODE ?= node
NPM ?= npm
PYTHON ?= python3
RUN_MACOS_LAUNCH_SMOKE ?= true

.PHONY: help bootstrap gen-contracts check-contracts check-boundaries \
	verify-sdd rust-ci frontend-ci check-launch-entry native-ci \
	macos-launch-smoke-test macos-release macos-launch-smoke-probe \
	macos-launch-smoke \
	native-if-supported ci

help:
	@echo "Flowshot development targets"
	@echo "  make bootstrap       Install locked JavaScript and Rust dependencies"
	@echo "  make gen-contracts   Generate TypeScript contracts from Rust"
	@echo "  make check-contracts Verify deterministic contracts and frozen lock"
	@echo "  make check-launch-entry  Verify IPC starts before the React chunk"
	@echo "  make macos-launch-smoke-test  Test launch-probe timing logic"
	@echo "  make macos-release      Build the optimized macOS binary"
	@echo "  make macos-launch-smoke  Prove a visible release window starts in budget"
	@echo "  make ci              Run every gate supported by this host"

bootstrap:
	$(NPM) ci --no-audit --no-fund
	$(CARGO) fetch --locked

gen-contracts:
	$(CARGO) run --locked -p flowshot-xtask -- contracts

check-contracts:
	$(CARGO) run --locked -p flowshot-xtask -- contracts --check-determinism --check

check-boundaries:
	$(CARGO) run --locked -p flowshot-xtask -- check-boundaries

verify-sdd:
	$(PYTHON) scripts/sdd.py verify

rust-ci:
	$(CARGO) fmt --all --check
	$(CARGO) test --workspace --exclude flowshot-tauri
	$(CARGO) clippy --workspace --all-targets --exclude flowshot-tauri -- -D warnings

frontend-ci:
	$(NPM) run lint
	$(NPM) run test
	$(NPM) run build
	$(MAKE) check-launch-entry

check-launch-entry:
	$(NODE) scripts/check-launch-entry.mjs

native-ci:
	$(CARGO) test -p flowshot-tauri
	$(CARGO) clippy -p flowshot-tauri --all-targets -- -D warnings
	$(NPM) run tauri -- build --debug --no-bundle --ci

macos-launch-smoke-test:
	$(NODE) --test scripts/macos-launch-smoke.node.mjs

macos-release:
	@if [[ "$$(uname -s)" != "Darwin" ]]; then \
		echo "macos-release: requires macOS"; \
		exit 1; \
	fi
	$(NPM) run tauri -- build --no-bundle --ci

macos-launch-smoke-probe:
	@if [[ "$$(uname -s)" != "Darwin" ]]; then \
		echo "macos-launch-smoke-probe: requires macOS"; \
		exit 1; \
	fi
	node scripts/macos-launch-smoke.mjs

macos-launch-smoke: macos-release macos-launch-smoke-probe

native-if-supported:
	@if [[ "$(RUN_MACOS_LAUNCH_SMOKE)" != "true" && "$(RUN_MACOS_LAUNCH_SMOKE)" != "false" ]]; then \
		echo "RUN_MACOS_LAUNCH_SMOKE must be true or false"; \
		exit 2; \
	fi
	@if [[ "$$(uname -s)" == "Darwin" ]]; then \
		$(MAKE) native-ci || exit $$?; \
		if [[ "$(RUN_MACOS_LAUNCH_SMOKE)" == "true" ]]; then \
			$(MAKE) macos-launch-smoke; \
		else \
			echo "macos-launch-smoke: deferred to the hosted diagnostic step"; \
		fi; \
	elif command -v pkg-config >/dev/null && pkg-config --exists webkit2gtk-4.1; then \
		$(MAKE) native-ci; \
	else \
		echo "native-ci: skipped; install the documented Tauri platform prerequisites"; \
	fi

ci: verify-sdd check-contracts check-boundaries rust-ci frontend-ci \
	macos-launch-smoke-test native-if-supported
	@echo "Flowshot CI passed"
