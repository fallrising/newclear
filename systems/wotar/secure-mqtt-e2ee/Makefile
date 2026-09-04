.PHONY: install dev lint format typecheck test test-unit test-security test-integration coverage audit doctor build clean

VENV := .venv
PYTHON := $(VENV)/bin/python
PIP := $(VENV)/bin/pip

install:
	uv venv $(VENV) --python 3.12
	uv pip install -e ".[dev]" --python $(PYTHON)

dev: install

lint:
	$(VENV)/bin/ruff check src tests
	$(VENV)/bin/ruff format --check src tests

format:
	$(VENV)/bin/ruff format src tests
	$(VENV)/bin/ruff check --fix src tests

typecheck:
	$(VENV)/bin/mypy src

test:
	$(VENV)/bin/pytest tests/ -m "not integration and not public_smoke"

test-unit:
	$(VENV)/bin/pytest tests/unit tests/property tests/security -m "not integration and not public_smoke"

test-security:
	$(VENV)/bin/pytest tests/security -v

test-integration:
	$(VENV)/bin/pytest tests/integration -m integration -v

coverage:
	$(VENV)/bin/pytest tests/ -m "not integration and not public_smoke" --cov=secure_mqtt --cov-report=term-missing --cov-report=html

audit:
	$(VENV)/bin/pip-audit

doctor:
	$(PYTHON) -m secure_mqtt.cli doctor

build:
	$(PYTHON) -m build

clean:
	rm -rf .venv dist build .pytest_cache .mypy_cache .ruff_cache htmlcov .coverage *.egg-info