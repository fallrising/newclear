# Phase 6 Verification

- Date: 2026-09-03 (Europe/Berlin)
- Status: `CODE_COMPLETE_EXTERNAL_PENDING`
- Specification: `SDD-0006`, FR-1 through FR-6

## Deterministic local evidence

- `PYTHONPATH=src python3 -m unittest tests.test_publication -v` — passed,
  seven manifest, assembly, cross-reference, bibliography, and renderer tests.
- `PYTHONPATH=src python3 -m unittest tests.test_publication_build -v` — passed,
  eight descriptor-pinning, confinement, collision, and atomicity tests.
- `PYTHONPATH=src python3 -m unittest tests.test_publication_e2e -v` — passed,
  two clean two-book rebuild and shared-source failure tests.
- `make check` — passed; repository policy plus 160 offline tests.
- `git diff --check` and
  `sha256sum -c docs/execution/sdd-source.sha256` — passed.

Both tracked manifests reuse the same explicitly synthetic pattern. Deleting
only `.ice-maker/publications` and rebuilding produces byte-identical Markdown
and HTML carrying the caller-supplied source commit and both exact chunk
citations. An unrelated runtime-state sentinel survives cleanup and source
failure. Generated output is ignored and is not a publication input.

## External evidence pending

| Gate | Status |
|---|---|
| Source-by-source rights and privacy review | external-pending |
| Production curator/critic/human approvals | external-pending |
| Signing identity and signature verification | external-pending |
| Authorized publishing target and public release | external-pending |

The local compiler does not grant publication rights, prove a production
corpus, sign artifacts, publish externally, merge, or deploy.
