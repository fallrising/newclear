# T-0380 Ice Maker R2 M1–M4

STATUS: PARTIAL — original R2 M1–M4 implementation and required local evidence are complete; R20 independent acceptance passed; exact-head CI and normal merge/readback remain pending.

## Summary

Only the approved inline upload page and fixed escaped-Markdown HTML envelope changed. The page has language/viewport/system colors, stacked controls, visible focus and wrapped output. Upload/poll failures use literal text, stop polling and restore busy controls. OCR languages are trimmed, empty entries removed and sorted. A 30-minute deadline starts after acceptance; it stops only UI polling and tells the user that backend processing may continue. API, state machine, SQLite, OCR, CLI, runtime dependencies and CI are unchanged.

The review-only fixture runs the real FastAPI application and durable batch service with the existing synthetic extractor. It owns service shutdown, preloads short/long PDFs and never edits the database directly. Stable batch/source identities were observed across real service restarts and two fresh in-process states.

## Verification

- Focused RED: `PYTHONPATH=src:tests .venv/bin/python -m unittest -v test_document_service.DocumentServiceHttpTests.test_health_browser_page_multipart_202_and_status test_readable_results` — 10 tests, 2 intended failures for absent language/envelope markup.
- Affected modules: `PYTHONPATH=src:tests .venv/bin/python -m unittest -v test_document_service test_readable_results` — 32 passed. After explicit closing-head and byte-boundary additions, `test_readable_results` alone passed all 9 tests.
- `PYTHONPATH=src .venv/bin/python fe-review/test_fixture.py` — 2 passed, including real injected failed batch and identities across fresh states/restarts. `node --check fe-review/verify-browser.mjs` passed.
- Native [receipt](evidence/native.json): Phase 0 passed; full 320-test execution had one existing publisher test fail because inherited invalid `SSH_AUTH_SOCK` triggered its security precheck before the mocked timeout. That exact test passed with the variable removed. Original failure remains visible; this is composite local evidence, not a single green full-suite run. Full current-head CI remains required.
- Shared `--dry-run` / `--start`: [18 capture records](../../runs/20261024T092845634Z/shared/capture.json), three pages × desktop/tablet/mobile × light/dark, all HTTP 200, page/console/request errors 0, overflow 0. [Runtime01](../../runs/20261024T092845634Z/result.json) also recorded 18 axe scans, 0 violations and 0 incomplete results, and actual repeat-start identity equality.
- Runtime01 then failed a harness assertion: completed text appeared before the awaited document-list response and button restoration. No product fix was needed. Original result and 19 PNGs remain retained. The corrected driver waits for busy restoration; its distinct hash is recorded in [runtime02](../../runs/20261024T093013489Z/result.json).
- Runtime02 used fresh isolated state and `FE_REVIEW_FLOW_ONLY=1`, skipping the green matrix. It passed 10 steps and 10 screenshots: real held upload/running/busy, normalized languages, completion, real preview and byte-identical Markdown (231 bytes); actual runner failure and actual invalid-metadata HTTP 400; controlled literal-400, polling 404/409/network/invalid response; controlled clock fast-forward of the 30-minute cap. Error branches observed no further GET over 1.2 seconds; the clock case advanced another 2 seconds.
- Final [runtime03](../../runs/20261024T093302993Z/result.json), fresh-state completed-only supplement, passed 3 steps/3 screenshots in 3.343 seconds. Before navigation, completed counts were 1/0/0/0, busy was false, the download link existed and GET count stayed unchanged for 1200ms. Only then did it navigate to the real preview and compare Markdown. This fills the completed-page stop-poll evidence gap without repeating matrix or error scenarios.
- Every fixture shutdown recorded `serviceClosed: true`, uvicorn shutdown completion and positive listener absence. All three owned containers were removed. First outer attempt exited 1 in 21.429 seconds; second exited 0 in 11.458 seconds; final supplement exited 0 in 3.343 seconds. SIGTERM is not accepted without those positive shutdown checks.
- Fixed envelope grew from 378 to 913 bytes for the same empty body: +535 bytes. Escaping remains before interpolation; final `MAX_HTML_BYTES` stays 262144. Boundary regression accepts the exact rendered byte length and rejects one byte below it. Existing hostile-markup and bounds tests passed.

## Evidence and limits

Reproduction and environment boundaries: [RUNNER.md](../../RUNNER.md). Structured evidence index: [result.json](result.json). Python 3.12.3, FastAPI 0.141.1, uvicorn 0.52.4, Pillow 12.3.0, multipart 0.0.32; Node 24.18.0, external Playwright 1.63 / Chromium 153.0.8010.12 and axe 4.13. The component has no new frontend dependencies.

Shared matrix health was clean. Interaction HTTP 400/404/409 and failed request were expected actual-invalid-input or explicitly controlled faults; no page errors occurred. Mobile dark long-result and mobile light literal-error screenshots were manually inspected: readable wrapping and literal HTML-like text, no image execution. PNGs, raw logs and service state remain ignored/local. Public data contains only synthetic text, hashes and summaries.

This covers approved R2 M1–M4 only. Full R3, real OCR/providers, production relay/isolation, 200% zoom and complete manual keyboard/assistive-technology review are not claimed. Product AC-04 and usable-tag status remain unchanged. Aggregated active time, provider requests and pre-compaction tool counts are unknown; outer runtimes above are measured, not worker-budget estimates.

Parent final staged validation: `PYTHONPATH=platform/ice-maker/src platform/ice-maker/.venv/bin/python platform/ice-maker/scripts/check_repo.py` passed with new review files now staged; `python3 scripts/check_project_success.py` passed42 contracts; staged whitespace check passed. R20 independently verified eight source hashes, four manifests,32PNG hashes,18 matrix keys and36 local links, with no P1/P2. This does not replace the remaining full current-head CI.
