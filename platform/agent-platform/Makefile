OUTPUT ?= .artifacts/docker-smoke

.PHONY: check test lint format preflight docker-smoke platform-test platform-check web-check browser-test

check: lint test

test:
	python -m unittest discover -s tests -v

lint:
	ruff check src tests tests_platform scripts/*.py
	ruff format --check src tests tests_platform scripts/*.py

format:
	ruff format src tests tests_platform scripts/*.py
	ruff check --fix src tests tests_platform scripts/*.py

platform-test:
	@if [ -n "$$TEST_DATABASE_URL" ]; then \
		python -m unittest discover -s tests_platform -v; \
	else \
		python scripts/test-postgres.py; \
	fi

platform-check: check platform-test

web-check:
	npm --prefix web run check
	npm --prefix web run build

preflight:
	agent-platform-m0 preflight

docker-smoke:
	agent-platform-m0 docker-smoke --output "$(OUTPUT)"

browser-test:
	@if [ -n "$$TEST_DATABASE_URL" ]; then \
		npm --prefix web run test:e2e; \
	else \
		python scripts/test-postgres.py npm --prefix web run test:e2e; \
	fi
