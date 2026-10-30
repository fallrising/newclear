PYTHON ?= .venv/bin/python
CARGO ?= cargo
RUN_DIR := $(if $(RUN_DIR),$(RUN_DIR),work/run-$(shell date -u +%Y%m%dT%H%M%SZ))

.PHONY: setup prepare check core full notes semantic-prepare semantic-sdk semantic-native semantic-hnsw semantic

setup:
	python3 -m venv .venv
	$(PYTHON) -m pip install --require-hashes -r requirements.lock -r requirements-models.lock

prepare:
	$(PYTHON) models.py prepare --cache work/models
	$(PYTHON) native-whisper/prepare_core.py
	$(CARGO) +1.90.0 build --locked --release --manifest-path native-whisper/Cargo.toml --target-dir work/whisper-build
	$(PYTHON) native-whisper/prepare_assets.py work/whisper-assets

check:
	$(PYTHON) -m unittest discover -s tests -v
	$(PYTHON) -m py_compile lab.py offline.py scenarios.py advanced.py models.py notes_eval.py semantic_models.py diagnose_vectors.py prepare_semantic_sdk.py semantic_sdk.py semantic_eval.py tests/semantic_native.py tests/semantic_hnsw.py native-whisper/prepare_core.py native-whisper/prepare_assets.py

core:
	$(PYTHON) lab.py run --profile core --output "$(RUN_DIR)"

full:
	$(PYTHON) lab.py run --profile full --output "$(RUN_DIR)"

notes:
	$(PYTHON) notes_eval.py run --output "$(RUN_DIR)"

semantic-prepare:
	timeout 600 $(PYTHON) semantic_models.py prepare --cache work/semantic-models

semantic-sdk:
	timeout 1260 $(PYTHON) prepare_semantic_sdk.py --build

semantic-native:
	timeout 120 $(PYTHON) tests/semantic_native.py --patched --output "$(RUN_DIR)"

semantic-hnsw:
	timeout 120 $(PYTHON) tests/semantic_hnsw.py --output "$(RUN_DIR)"

semantic:
	timeout 1200 $(PYTHON) semantic_eval.py run --cache work/semantic-models --output "$(RUN_DIR)"
