# AGENTS.md

The parent `/home/ckc/test/codex/AGENTS.md` applies. This file records repository facts.

## Project facts

- Python 3.11 service code lives under `src/ocr_service`.
- All engines implement the protocol in `src/ocr_service/backends/base.py`.
- Optional engine imports must remain lazy so base tests do not install model runtimes.
- `POST /v1/ocr` accepts raw image bytes, not URLs or multipart forms.
- Engine images must remain independent and use one Uvicorn worker per container.
- Never add a runtime model download fallback. Model acquisition belongs to image build.
- Never commit `.env`, API keys, model caches, generated artifacts, or OCR input data.

## Repository-native checks

- `make test` builds and runs the isolated contract-test image.
- `make compile` checks Python syntax without writing bytecode to the worktree.
- `make compose-check` renders every Compose profile.
- `make check` runs all three gates.
