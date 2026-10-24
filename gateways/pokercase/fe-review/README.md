# fe-review — pokercase

Original Round2 M1–M4 are delivered via [PR603](https://github.com/fallrising/newclear/pull/603), with R31 ACCEPT, both required CI checks passed and fetched scoped equality confirmed. This is scoped frontend evidence, not full Round3 or gateway mainline acceptance.

- [Report](tasks/round2/report.md): exact results, failures, limits and source-specific coverage.
- [Machine result](tasks/round2/result.json), [source hashes](tasks/round2/source-manifest.json), [private artifact inventory](tasks/round2/artifact-manifest.json), [publication provenance](tasks/round2/publication-provenance.json).
- [RUNNER](RUNNER.md): explicit parent modes and private-state requirements.
- [DESIGN](DESIGN.md): approved historical scope; [REVIEW](REVIEW.md) and [PROMPT](PROMPT.md): current guidance.
- [targets](targets.json): qualified metadata only; actual auth/edit-ID targets are generated privately.

Current coverage:18affected Web views+6unchanged shared views,14real journeys,12source-qualified terminal captures. Native127tests and focused5renderer subset pass.13contrast-incomplete sets remain;520computed pairs include a separately corrected desktop observation. All original failures remain preserved. No raw PNG/ANSI/state is committed.
