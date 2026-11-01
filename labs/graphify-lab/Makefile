PYTHON ?= python3
VENV := .venv
RUN_DIR ?= work/run
CACHE ?=
CACHE_ARGS = $(if $(CACHE),--cache "$(CACHE)",)

.PHONY: setup prepare check scenarios full workspace-trial
setup:
	$(PYTHON) -m venv $(VENV)
	$(VENV)/bin/python -m pip install --require-hashes -r requirements.lock

prepare:
	$(VENV)/bin/python -m graphify_lab $(CACHE_ARGS) prepare

check:
	$(VENV)/bin/python -m unittest discover -s tests -v

scenarios:
	$(VENV)/bin/python -m graphify_lab.scenarios --output "$(RUN_DIR)"

full:
	$(VENV)/bin/python -m graphify_lab $(CACHE_ARGS) full --out "$(RUN_DIR)"

workspace-trial:
	$(VENV)/bin/python -m graphify_lab.workspace_trial --out "$(RUN_DIR)"
