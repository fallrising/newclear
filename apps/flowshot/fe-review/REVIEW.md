# Flowshot FE review — current R2 evidence

Approved [DESIGN](DESIGN.md) M1–M2 is implemented as review-only preload and owned browser driver. [flowshot-001](runs/flowshot-001/capture.json) actually passed 19 state/viewport/preference captures, exact loaded `/` identity, synthetic metadata/alert checks, external HTTP/WS refusal and owned browser/server/listener cleanup. Root controls namespace and container removal. Pair native/CI/publication closeout remains in [report](tasks/round2/report.md); targets promotion must match those actual gates.

The source uses the existing `__FLOWSHOT_BUILD_INFO_PROMISE__` before eager import; pending resolves/rejects only after loading is observed. No production adapter, renderer/workspace wiring, Rust/generated contract or launch timing changed. Real launch-module source and actual locked SDK paths are covered by focused review tests. Missing/late/colliding fixture or unknown native use fails closed.

## Retained findings and limits

- All 19 axe scans report color-contrast incomplete: loading/error 5 nodes each, ready and long-ready 10 each. Zero violations does not close these checks or establish full Round3 accessibility.
- No measured horizontal overflow in the 19 captures. Manual spot review inspected long-ready mobile and error tablet; it is not a claim every pixel/state received a full Round3 audit. Long metadata is ellipsized as designed and remains complete in DOM.
- Both preferences render the existing fixed palette; no theme feature was added.
- Native window/WebView IPC, filesystem/DB persistence, reader/annotation journeys and target Mac <1500ms remain outside this Web evidence. SUCCESS stays mainline incomplete/usable none; original native/Mac gaps remain.

## Historical evidence

Initial fixture tests intentionally failed before implementation, then passed. Root's first native npm test encountered review node:test/Vitest discovery collision despite original tests passing; review files were renamed *.node.mjs without changing product tests/config. Runtime was already green before that filename-only manifest update, whose exact hash reconstruction is in [artifact audit](tasks/round2/evidence/flowshot-artifact-audit.json). Do not overwrite either failed logs or the runtime manifest. Original first-round design approvals are retained in DESIGN and central acceptance, not inferred from runtime success.

Post-runtime source note: after the filename rename, the paired runtime gained a `unit === 'loom'`-only Vite5 hash-pinned config loader. Flowshot options/behavior are unchanged. [Exact delta](tasks/round2/evidence/post-runtime-loom-loader-delta.json) and the artifact audit reconstruct the original runtime hash; green Flowshot browser evidence was not rerun.
