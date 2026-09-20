# Study publication

This workflow preserves one reviewed Ice Maker analysis in the native
`fallrising/doc_analysis_study` layout. Export, local staging, and GitHub are
three separate capability boundaries. The parser/upload service has no import,
credential, executable, or call path to this publisher.

The safe default ends after a local dry-run. Only the final `--publish` action
may contact GitHub, create one study branch, push that exact branch, and request
one draft pull request. It cannot push `main`, force, delete refs, create a
repository, mark a PR ready, merge, release, deploy, or edit workflows.

## 1. Export one approved study bundle

One bundle represents one coherent historical-system analysis, not necessarily
one upload batch. Select only source IDs and extracted chunk evidence relevant
to the study. The canonical request and evidence ledger must include exact
source/config/tool digests, source and chunk IDs, claims and citations, QA
dispositions, and artifact-level publication approvals. Rights must be
confirmed; Prohibited material cannot be exported.

```sh
install -d -m 0700 /absolute/private/study-bundles
PYTHONPATH=src python3 -m ice_maker.study_cli export \
  --request /absolute/private/reviewed-export-request.json \
  --evidence /absolute/private/reviewed-evidence-ledger.json \
  --state-root /absolute/private/study-bundles \
  --config /absolute/ice-maker/config/study-publication.json
```

The command returns canonical JSON containing `bundle_id`, `bundle_name`,
`manifest_sha256`, and an artifact count of six. Set these variables from the
reviewed output; do not derive or edit a bundle by hand:

```sh
BUNDLE_DIGEST=<64-lowercase-hex-bundle-id>
BUNDLE=/absolute/private/study-bundles/<returned-bundle-name>
```

The immutable bundle contains only:

- `manifest.json`;
- `registry-row.md`;
- `studies/<slug>/README.md`;
- `studies/<slug>/progress.md`;
- `studies/<slug>/sources.md`;
- `studies/<slug>/analysis/overview.md`;
- `studies/<slug>/analysis/qa-review.md`.

The six-artifact count excludes `manifest.json`. Raw documents, full extracted
text, absolute host paths, credentials, and unapproved content are forbidden.

## 2. Prepare a clean base without touching an existing checkout

Never point this workflow at `<doc-analysis-study-checkout>` or any
other working checkout. Create a dedicated clone in a private operator-owned
directory, verify the allowlisted remote, and detach it at the reviewed current
`origin/main` commit:

```sh
install -d -m 0700 /absolute/private/study-publication
git clone git@github.com:fallrising/doc_analysis_study.git \
  /absolute/private/study-publication/base
git -C /absolute/private/study-publication/base fetch --no-tags origin main
git -C /absolute/private/study-publication/base checkout --detach origin/main
git -C /absolute/private/study-publication/base status --short
git -C /absolute/private/study-publication/base remote get-url origin
BASE_COMMIT=$(git -C /absolute/private/study-publication/base rev-parse HEAD)
```

The status output must be empty and the remote must resolve exactly to
`fallrising/doc_analysis_study`. The publisher rejects an attached branch,
dirty tree, shallow clone, alternates, replace refs, submodules, extra
worktrees, custom hooks, filters, credential helpers, URL rewrites, or changed
target templates/validator contract.

Measure the exact target contract:

```sh
PYTHONPATH=src python3 -m ice_maker.study_cli target-contract \
  --base /absolute/private/study-publication/base \
  --expected-base "$BASE_COMMIT" \
  --expected-repository fallrising/doc_analysis_study
```

Record the returned value:

```sh
TARGET_CONTRACT=<64-lowercase-hex-target-contract-digest>
install -d -m 0700 /absolute/private/study-publication/staging
```

## 3. Preview and retain the isolated local checkout

First render and validate an exact diff without retaining it:

```sh
PYTHONPATH=src python3 -m ice_maker.study_cli publish-local \
  --bundle "$BUNDLE" \
  --base /absolute/private/study-publication/base \
  --staging-root /absolute/private/study-publication/staging \
  --expected-base "$BASE_COMMIT" \
  --expected-contract "$TARGET_CONTRACT" \
  --expected-bundle "$BUNDLE_DIGEST" \
  --expected-repository fallrising/doc_analysis_study
```

Review the bounded `diff` and exact six-item `changed_paths`. Then repeat with
`--apply` to atomically retain the isolated checkout:

```sh
PYTHONPATH=src python3 -m ice_maker.study_cli publish-local \
  --bundle "$BUNDLE" \
  --base /absolute/private/study-publication/base \
  --staging-root /absolute/private/study-publication/staging \
  --expected-base "$BASE_COMMIT" \
  --expected-contract "$TARGET_CONTRACT" \
  --expected-bundle "$BUNDLE_DIGEST" \
  --expected-repository fallrising/doc_analysis_study \
  --apply
```

The retained checkout is:

```sh
STAGING_CHECKOUT="/absolute/private/study-publication/staging/study-$BUNDLE_DIGEST"
```

It remains at the true base commit with only the exact approved diff staged.
The target-native `scripts/validate_repository.py` must pass before retention.
The marker `.git/ice-maker-study.json` binds base, target contract, bundle,
paths, and diff digest.

## 4. GitHub credential preflight

Use a dedicated SSH key/agent that can push branches only as broadly as the
repository permits. The `gh` identity needs access to the private repository
and permission to create pull requests; a fine-grained token should be limited
to this repository with Contents read/write and Pull requests read/write. Do
not put tokens in command arguments, environment variables, repository files,
shell history, or bundle evidence.

```sh
ssh-add -l
gh auth status --hostname github.com
gh repo view fallrising/doc_analysis_study --json nameWithOwner,isPrivate
```

Stop if authentication is invalid, the repository identity differs, or the
account has broader access than intended. The publisher invokes fixed absolute
`/usr/bin/git` and `/usr/bin/gh`, disables helpers/hooks/signing/pagers/aliases/
filters/replace refs, forwards no token environment variable, and records no
command output. Git authentication therefore relies on the already-reviewed
SSH agent; `gh` reads its normal host configuration only during the explicit
GitHub step.

## 5. Dry-run, then explicit publish

The shell entry point always executes and prints a full dry-run first. With no
mode argument it performs no GitHub network or remote mutation:

```sh
scripts/publish-study.sh \
  --staging-checkout "$STAGING_CHECKOUT" \
  --bundle "$BUNDLE" \
  --expected-base "$BASE_COMMIT" \
  --expected-contract "$TARGET_CONTRACT" \
  --expected-bundle "$BUNDLE_DIGEST"
```

Review the exact repository, base branch/commit, deterministic
`study/<slug>-<bundle-prefix>` branch, bundle/diff/tree digests, and six changed
paths in the JSON. Then opt in explicitly:

```sh
scripts/publish-study.sh \
  --staging-checkout "$STAGING_CHECKOUT" \
  --bundle "$BUNDLE" \
  --expected-base "$BASE_COMMIT" \
  --expected-contract "$TARGET_CONTRACT" \
  --expected-bundle "$BUNDLE_DIGEST" \
  --publish
```

Before mutation the publisher fetches and requires remote `main` to equal the
reviewed base. It creates one deterministic local commit, refuses a conflicting
remote branch, pushes only the full study-branch-to-study-branch refspec without
force or tags, and requests a draft PR with exact head/base/repository flags.
It then verifies the remote SHA and PR number, URL, head SHA, base, open state,
and draft state.

Successful bounded evidence is retained under the isolated checkout:

- `.git/ice-maker-study.json`: T-036 local staging identity;
- `.git/ice-maker-github-prepared.json`: deterministic local branch/commit,
  exact paths and digests; retained across push or PR failure;
- `.git/ice-maker-github.json`: verified remote branch SHA and draft-PR
  identity, with stable command exit classes and no credential/output text.

## Review, abort, retry, and recovery

- Before `--publish`, abort by retaining the immutable bundle and discarding
  only the dedicated staging checkout through an operator-reviewed cleanup.
- If fetch, push, or PR creation fails, do not edit the checkout, branch,
  bundle, or marker. Correct authentication/connectivity and rerun the exact
  command. A matching remote branch and draft PR are verified and reused.
- A conflicting branch, multiple PRs, changed remote `main`, changed artifact,
  dirty checkout, missing/partial marker, non-draft PR, or different pushed SHA
  fails closed. Investigate it; the publisher never overwrites or deletes it.
- The publisher never deletes the local bundle or base. A failed GitHub step
  cannot erase analysis evidence.
- Abort of an already pushed branch/PR is a human repository-administration
  decision. Close the draft PR or delete the branch in the GitHub UI only after
  confirming its exact identity; no cleanup authority is built into this tool.
- Merge remains a separate manual review action in GitHub. There is no merge,
  auto-merge, ready-for-review, release, deployment, or workflow path here.

All fake-remote tests are offline control evidence. They do not prove current
GitHub authentication, branch protection, organization policy, or successful
Internet connectivity. No real publication is part of repository verification.
