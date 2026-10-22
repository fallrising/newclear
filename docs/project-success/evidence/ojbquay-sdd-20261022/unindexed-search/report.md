STATUS: DONE

# T-451 — unindexed active repository SDD search

Desk task: T-0368. Worker task: T-451. Scope: read-only provenance search in `fallrising/Zircon-Godot` and `fallrising/magpie` only. Snapshot: 2026-10-22 05:52–05:54 UTC.

## Summary

Neither repository contains an Ojbquay/ddmq normative SDD in the complete default-branch path inventory or the selected documentation corpus. This conclusion comes from GitHub REST tree/blob reads, not empty connector search results. Both recursive trees returned `truncated: false`. Every selected documentation blob was fetched successfully, checked against its Git blob SHA-1, hashed with SHA-256, and scanned in full for all six search terms.

| Repository | Default branch and complete commit SHA | Tree entries / blobs | Documents searched | Text bytes | Path / content hits |
| --- | --- | --- | --- | --- | --- |
| `fallrising/Zircon-Godot` | `master` / `14ad6768ee6dcdffd55ffda89b76f7f1b9bc9c1e` | 2,416 / 2,245 | 171 | 3,259,218 | 0 / 0 |
| `fallrising/magpie` | `main` / `e297a8ab27461ed32b03ce8be0f9bf957a2e754d` | 5,277 / 4,950 | 29 | 910,413 | 0 / 0 |

Zircon-Godot is a Legend of Mir 3 Godot/C# client and server. Its `README.md`, `docs/README.md`, and `docs/PROJECT_MAP.md` describe game/client/server architecture. Magpie is a local model gateway and agent configuration application. Its `README.md` and `docs/subsystems/README.md` describe provider/account, gateway, plugin, session, GUI, and backup subsystems. Their text does not describe Ojbquay. No unrelated acronym hits required classification: there were no hits at all.

## Search method and exact examined paths

Queries: case-insensitive literal alternatives `ojbquay`, `ddmq`, `SDD`, `ProduceDelay`, `retryIntervals`, `__ojbk.delay.inbox`. All paths in each complete recursive tree were scanned. Content candidates were every blob with `.md`, `.markdown`, `.rst`, `.txt`, or `.adoc` suffix, plus extensionless `README`, `AGENTS`, `SDD`, `specification`, or `requirements` basenames. This includes all first-party Markdown docs/specs, READMEs, task and historical design text present at the snapshot, together with incidental text fixtures and licenses. It excludes code, binary assets, and arbitrary configuration files. Neither tree has PDF, DOC, DOCX, ODT, Pages, or RTF files.

Every examined path, exact blob API endpoint, source URL, byte count, Git blob SHA, SHA-256, request result, and matching line list is recorded in `<repo>/document-search.json`. `<repo>/document-candidates.json` records candidate selection; `<repo>/path-hits.json` records the empty path matches. Complete tree responses are `<repo>/tree.json`. Purpose/architecture opening excerpts appear in `document-search.json`; irrelevant runtime locations were not copied. Document hashes describe original complete source bytes, not shortened excerpts.

Exact source refs:

- [Zircon-Godot default snapshot](https://github.com/fallrising/Zircon-Godot/tree/14ad6768ee6dcdffd55ffda89b76f7f1b9bc9c1e), commit tree `465c3ed90ff31a8ada977ba0aa3be7cfd1f37fc5`.
- [Zircon-Godot README](https://github.com/fallrising/Zircon-Godot/blob/14ad6768ee6dcdffd55ffda89b76f7f1b9bc9c1e/README.md), [documentation router](https://github.com/fallrising/Zircon-Godot/blob/14ad6768ee6dcdffd55ffda89b76f7f1b9bc9c1e/docs/README.md), [project map](https://github.com/fallrising/Zircon-Godot/blob/14ad6768ee6dcdffd55ffda89b76f7f1b9bc9c1e/docs/PROJECT_MAP.md).
- [Magpie default snapshot](https://github.com/fallrising/magpie/tree/e297a8ab27461ed32b03ce8be0f9bf957a2e754d), commit tree `62ad299d3381ce2c6a428305bd9a4691225451e8`.
- [Magpie README](https://github.com/fallrising/magpie/blob/e297a8ab27461ed32b03ce8be0f9bf957a2e754d/README.md), [subsystem references](https://github.com/fallrising/magpie/blob/e297a8ab27461ed32b03ce8be0f9bf957a2e754d/docs/subsystems/README.md).

Requests used `gh api` read-only GET. Metadata/ref/tree/commit endpoints are recorded verbatim in each `metadata.json`; each blob endpoint is recorded verbatim in `document-search.json`. Representative exact commands:

```sh
gh api repos/fallrising/Zircon-Godot/git/ref/heads/master
gh api 'repos/fallrising/Zircon-Godot/git/trees/14ad6768ee6dcdffd55ffda89b76f7f1b9bc9c1e?recursive=1'
gh api repos/fallrising/Zircon-Godot/git/commits/14ad6768ee6dcdffd55ffda89b76f7f1b9bc9c1e
gh api repos/fallrising/magpie/git/ref/heads/main
gh api 'repos/fallrising/magpie/git/trees/e297a8ab27461ed32b03ce8be0f9bf957a2e754d?recursive=1'
gh api repos/fallrising/magpie/git/commits/e297a8ab27461ed32b03ce8be0f9bf957a2e754d
```

## Verification

- Both repository/ref/recursive-tree/commit GET sequences succeeded; `archived: false`, full commit and tree SHAs recorded — passed
- Both complete trees have `truncated: false`; counts recomputed from stored responses match metadata — passed
- All 200 selected document GETs succeeded on the first attempt; full byte lengths and Git blob SHA-1 identities verified — passed
- All six terms were scanned over every tree path and each selected document's complete decoded contents; zero hits; result lists and SHA-256 digests saved — passed
- `verification.json` records Python assertion results for tree completeness, candidate/read counts, byte lengths, Git blob SHA-1, and empty hit lists — passed
- `artifact-digests.json` records the saved JSON evidence artifact checksums; final checksum/content validation recorded in `final-validation.json` — passed

## Documentation

Only this evidence directory was written. No product code, tests, acceptance contracts, ledger state, other workers' files, or existing repair worktree was changed. No commit, push, PR, tag, deployment, runtime service, paid model call, or remote mutation occurred. Required worker report is this `report.md`, because the bounded task authorizes only this evidence directory.

## Risks and Follow-ups

This is a complete default-branch path scan and complete selected-document content scan at the specified SHAs. It is not an exhaustive historical/other-branch search, a scan of arbitrary code/configuration contents, an OCR scan of images, or proof that no deleted/unreachable/external source ever existed. No binary assets were downloaded. The parent combines these two results with the other active-repository searches and earlier archived Ojbquay history investigation before stating the broader conclusion.

The initial local read command failed because the sandbox could not configure its loopback interface (`bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`). The same bounded read was retried using a specifically approved escalated command and succeeded. GitHub API reads had no failures or retries. There are no failed or skipped required search checks. Product runtime validation is outside this read-only task and this evidence does not alter any prior retry failure or usable-version qualification.

API accounting for this worker: 210 GitHub GET requests (2 preliminary metadata reads, 6 metadata/ref/tree collection reads, 2 commit-tree resolution reads, 200 document blob reads), 0 API retries. Provider/model request count is unknown; no provider count is inferred from these API requests. No child agents were started.
