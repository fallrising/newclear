# Quickstart — Ice Maker

> Portfolio doc tier **A**. Full narrative remains in the component [README](../README.md).
> Policy: [portfolio-doc-tiers.md](../../../docs/portfolio-doc-tiers.md).

## Prerequisites

- Python **3.11+**
- Run commands from `platform/ice-maker`

## Minimal path (SDD lifecycle)

```sh
cd platform/ice-maker
PYTHONPATH=src python3 -m ice_maker init
PYTHONPATH=src python3 -m ice_maker new \
  --slug example \
  --id SDD-0001 \
  --title "Example feature" \
  --owner human \
  --component ice_maker
PYTHONPATH=src python3 -m ice_maker validate example
PYTHONPATH=src python3 -m ice_maker status --json
```

## Verify

```sh
cd platform/ice-maker
make check
```

## Optional: document ingestion service

Host assessment and pinned local parser/OCR service:

```sh
scripts/document-ingestion-doctor.sh --json
# then build/run scripts as described in the component README
```

Requires an absolute private data directory; do not commit runtime data.

## Authoritative longer docs

- [README](../README.md)
- `docs/sdd/`, `docs/verification/`, `docs/runbooks/`
