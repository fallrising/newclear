# Ice Maker

> **Portfolio doc tier: A (active)** — Runnable entry: [docs/quickstart.md](docs/quickstart.md). Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md). Investment notes: [PORTFOLIO.md](../../PORTFOLIO.md).


Ice Maker is a local-first Personal Engineering Knowledge Compiler. It combines
deterministic spec-driven development, bounded multi-provider agent adapters,
provenance-preserving knowledge ingestion, and reproducible Markdown/HTML
publication.

The implementation follows the immutable source design pack in `docs/sdd/`.
Development completed on `build/full-sdd` and PR #1 was merged into `main` on
2026-09-03 at merge commit `ed3da350`. The merge CI passed. No production
deployment or sensitive-data processing is part of this build.

The Phase 0–7 local implementation is `DEVELOPMENT_COMPLETE`. It is not
`PRODUCTION_READY`: real runner/VPS, identity, egress, restore, rotation,
telemetry/cost-alert, compromised-runner, and human approval evidence remains
external-pending. Current execution evidence lives in `.team/PLAN.md`,
`specs/active/full-build/verification.md`, and `docs/verification/`.

## SDD lifecycle

From a source checkout, run `PYTHONPATH=src python3 -m ice_maker init`, then
`PYTHONPATH=src python3 -m ice_maker new --slug example --id SDD-0001 --title
"Example feature" --owner human --component ice_maker`. Validate one SDD with
`PYTHONPATH=src python3 -m ice_maker validate example` or all active SDDs with
`... validate --all`; inspect deterministic JSON with `... status --json`.

`init` is idempotent, preflights all existing configuration/templates before
writing, and refuses divergent or symlinked repository paths.
`new` creates all four governed files in a temporary sibling before Linux's
atomic no-replace publication; if that kernel primitive is unavailable it fails
closed. It refuses existing, symlinked, absolute, or traversal targets. The
commands are offline and use only the Python standard library.

## What you can use today

Run the supported commands from a source checkout with Python 3.11 or newer.
The SDD lifecycle remains available:

```sh
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

The four-stage local knowledge CLI can ingest, extract, index, and propose from
the deliberately marked synthetic PDF/PBM fixtures supported by the MVP. Each
stage prints canonical JSON; pass its `manifest_id`, `extraction_id`, or
`index_id` to the next stage:

```sh
PYTHONPATH=src python3 -m ice_maker.knowledge_cli ingest example.pdf \
  --rights confirmed --data-class internal
PYTHONPATH=src python3 -m ice_maker.knowledge_cli extract \
  --manifest <manifest-id>
PYTHONPATH=src python3 -m ice_maker.knowledge_cli index \
  --manifest <manifest-id> --extraction <extraction-id>
PYTHONPATH=src python3 -m ice_maker.knowledge_cli propose \
  --manifest <manifest-id> --index <index-id> \
  --query idempotency --destination concepts/idempotency \
  --conclusion "local evidence"
```

For ordinary PDF, PNG, JPEG, and WebP batches, first assess the host and start
the pinned local parser/OCR service:

```sh
scripts/document-ingestion-doctor.sh --json
install -d -m 0700 /absolute/private/ice-maker-data
scripts/build-document-service.sh
scripts/run-document-service.sh /absolute/private/ice-maker-data 18080
curl --fail --silent --show-error http://127.0.0.1:18080/healthz
```

Then open `http://127.0.0.1:18080/` and upload up to 100 files. The service is
loopback-only, keeps the parser network-disabled, stores raw and derived data
only under the selected private directory, and resumes from validated local
evidence after restart. It supports native/scanned/mixed PDFs, long-image OCR,
local FTS5 search evidence, per-file policy metadata, duplicate reuse, and
isolated item failures. Exact upload/status/stop/resume commands, the
10-document pilot, and the 100-document benchmark are in
`docs/runbooks/production-document-ingestion.md`.

For completed batches, that runbook also documents the local browser flow and
status, processed-document listing, escaped preview, and Markdown download
endpoints. Readable results are bounded, provenance-rich local reconstruction;
they are not summaries, layout-perfect table recovery, or an OCR-accuracy
claim.

Reviewed results can be exported as a content-addressed six-artifact study
bundle and previewed/applied to a new isolated staging checkout for
`fallrising/doc_analysis_study`. The existing owner checkout is never mutated
by that workflow. A separate host-side command defaults to a GitHub dry-run and
requires `--publish` before it can push one unique study branch and request a
draft PR; it has no main/force/merge/deploy authority and is never available to
the parser service. See `study --help` and
`docs/runbooks/study-publication.md`.

Rebuild either tracked example book as a byte-stable Markdown/HTML pair into
the ignored local runtime directory:

```sh
PYTHONPATH=src python3 -m ice_maker.publication_cli \
  --repository-root . \
  --manifest books/system-design.json \
  --output-root .ice-maker/publications \
  --source-commit "$(git rev-parse HEAD)"
```

The output is written to
`.ice-maker/publications/system-design/{book.md,book.html}`. Publication is
no-replace: follow `docs/runbooks/publication.md` before rebuilding an existing
output directory.

The generated 70-PDF/30-image journey is deterministic control evidence, not a
real-corpus OCR-quality result. Before relying on the system, the owner must run
the documented representative pilot and attest languages, rights/data classes,
quality thresholds, and rootless/network-disabled sandbox behavior. No parsing
command invokes a provider or publishes externally, and the system is
`DEVELOPMENT_COMPLETE`, not `PRODUCTION_READY`.

## Local verification

Run the repository policy, schema, secret-pattern, source-integrity, and full
offline test gate:

```sh
make check
```

Run the two cross-component journeys directly with:

```sh
PYTHONPATH=src python3 -m unittest tests.test_hardening_e2e -v
PYTHONPATH=src python3 -m unittest tests.test_publication_e2e -v
sha256sum -c docs/execution/sdd-source.sha256
```

Operational response and rebuild procedures are in `docs/runbooks/`. Generated
runtime state under `.ice-maker/` is disposable and ignored; tracked specs,
manifests, knowledge records, and configuration are the rebuild inputs.
