OUTPUT ?= .artifacts/docker-smoke

.PHONY: check test lint format preflight docker-smoke

check: lint test

test:
	python -m unittest discover -s tests -v

lint:
	ruff check src tests
	ruff format --check src tests

format:
	ruff format src tests
	ruff check --fix src tests

preflight:
	agent-platform-m0 preflight

docker-smoke:
	agent-platform-m0 docker-smoke --output "$(OUTPUT)"
