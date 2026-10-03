# First real-document attempt: blocked at runtime preflight

Observation date: 2026-10-03 (UTC).

## Outcome

The owner-selected PDF was acquired intact (676,301 bytes) and its SHA-256 was
recorded in the private task evidence. The current study registry and source
inventories contained no matching document. Raw bytes, source-account details,
and full extraction text are not published here.

The real-document workflow did **not** reach ingestion. No batch, OCR result,
provenance index, readable result, citation-backed candidate, or knowledge PR
was produced. This is a blocked attempt, not a successful real-corpus pilot.
Machine-readable task evidence is in [first-real-result.json](first-real-result.json).

## Defect and fix

The doctor reported all three installed Poppler tools as unavailable. It passed
`--version` to every tool; the installed `pdfinfo`, `pdftotext`, and `pdftoppm`
accept `-v` instead. Direct probes returned Poppler 24.02.0 successfully.

A regression with executables that enforce the real flag contract failed before
the fix: three `false` tool observations instead of `true`. The minimal fix makes
the version flag explicit for Poppler and retains `--version` for Tesseract.
A second regression confirms a nonzero version probe remains unavailable.
Docker, language, package, and isolation checks have not been bypassed.

## Verification

Commands below run from the component root unless noted. Check output summaries
are retained in the JSON evidence; local logs containing temporary paths stay
outside Git.

| Check | Exit | Observed result |
| --- | ---: | --- |
| New strict version-flag regression, before fix | 1 | Expected RED: all three Poppler observations were false |
| `PYTHONPATH=src python3 -m unittest tests.test_document_ingestion_doctor -v` | 0 | 10 tests pass |
| `DOCTOR_OCR_LANGUAGES=eng scripts/document-ingestion-doctor.sh --json` | 2 | Poppler and English OCR detected; host remains unsupported |
| `scripts/run-document-service.sh <private-data-directory> 18080` | 77 | `run as a non-root operator`; no service started |
| `make check` at unchanged base `7b29dceac92fb5e62490662f78b0f630d66423d0` | 2 | 303 run: 293 pass, 3 failures, 2 errors, 5 skips |
| `make check` after fix | 2 | 305 run: 295 pass, same 3 failures, 2 errors, 5 skips |
| `PYTHONPATH=src python3 -m unittest tests.test_hardening_e2e tests.test_publication_e2e -v` | 0 | 3 tests pass; synthetic control evidence only |
| `PYTHONPATH=src python3 scripts/check_repo.py` | 0 | Policy/schema/source/secret-pattern gate passes |
| `sha256sum -c docs/execution/sdd-source.sha256` | 0 | All immutable source-pack hashes match |
| `bash -n scripts/document-ingestion-doctor.sh` | 0 | Shell syntax passes |
| `python3 -m compileall -q src tests` | 0 | Compilation passes |
| `git diff --check` | 0 | No whitespace errors |

The five unchanged failing/erroring cases are:

- `test_red_signature_codec_digest_and_decode_limits`: assumes Pillow is absent
  and expects `image codec unavailable`; with Pillow installed the deliberately
  invalid image correctly fails with `image decode failed`.
- `test_github_command_timeout_and_partial_evidence_are_stable`
- `test_github_fake_remote_publish_and_replay_are_exact`
- `test_github_dry_run_and_script_do_not_mutate_checkout_or_remote`
- `test_github_stale_remote_collision_and_pr_retry_preserve_local_evidence`

The four publication cases encounter the configured executable-identity gate
because `gh` is absent. These tests were not weakened or relabelled as passing.
Three container/relay tests skip because filesystem Unix sockets are forbidden;
two HTTP tests skip because service extras are absent. The full verification
gate remains unresolved even though the focused doctor regression is green.

## External gates and resumption

After the fix, the real host doctor still reports Docker unreachable and missing
service packages. The runner is root, and the existing startup script rejects
it before starting any container. Default `eng,chi_tra` probing also reports
the missing Traditional Chinese language; explicit `eng` probing succeeds for
this English sample without changing the tracked defaults.

Resume on a supported non-root operator host using the existing
[production ingestion runbook](../runbooks/production-document-ingestion.md).
Recheck source identity and study duplication, run doctor, build the pinned
image, verify parser isolation, and run the real upload/status/readable journey.
Then verify page/chunk provenance and content quality, test deterministic reuse,
and prepare the cited knowledge candidate. Do not replace the missing runtime
with synthetic extraction or an unisolated alternate pipeline.

No merge, deployment, production-readiness assertion, or knowledge promotion
was performed. The pending full-suite environment and test-portability issues
must be resolved or explicitly assessed on that supported host.
