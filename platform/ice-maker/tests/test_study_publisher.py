import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

from ice_maker import study_publisher
from ice_maker.study_cli import main as study_main
from ice_maker.study_export import export_study
from ice_maker.study_publisher import (
    StudyPublishError,
    load_github_publication_config,
    publish_github,
    publish_local,
    target_contract_digest,
)
from tests.test_study_export import fixture


IDENTITY = "fallrising/doc_analysis_study"


VALIDATOR = '''#!/usr/bin/env python3
import sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
required = ("README.md", "progress.md", "sources.md", "analysis/overview.md", "analysis/qa-review.md")
studies = sorted(path for path in (root / "studies").iterdir() if path.is_dir())
bad = not studies
for study in studies:
    bad = bad or any(not (study / name).is_file() for name in required)
    bad = bad or f"studies/{study.name}/README.md" not in (root / "README.md").read_text()
    bad = bad or "## Publication approvals" not in (study / "sources.md").read_text()
if bad:
    print("VALIDATION FAILED")
    raise SystemExit(1)
count = sum(1 for path in root.rglob("*.md") if ".git" not in path.parts)
print(f"VALIDATION PASSED: studies={len(studies)}, markdown_files={count}")
'''


class StudyPublisherTests(unittest.TestCase):
    def git(self, root, *arguments, check=True):
        return subprocess.run(
            ["git", *arguments], cwd=root, check=check, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        ).stdout.strip()

    def target(self, root, *, validator=VALIDATOR, remote=None, attached=False):
        root = Path(root).resolve()
        (root / "studies").mkdir(parents=True)
        (root / "docs").mkdir()
        (root / "templates/study/analysis").mkdir(parents=True)
        (root / "scripts").mkdir()
        (root / "README.md").write_text(
            "# Studies\n\n| Study | Status | Source types | Sensitivity | Updated |\n"
            "| --- | --- | --- | --- | --- |\n"
        )
        (root / "docs/methodology.md").write_text("# Methodology\n")
        (root / "docs/repository-structure.md").write_text("# Repository structure\n")
        for name in ("README.md", "progress.md", "sources.md"):
            (root / "templates/study" / name).write_text("# Template\n")
        for name in ("overview.md", "qa-review.md"):
            (root / "templates/study/analysis" / name).write_text("# Template\n")
        (root / "scripts/validate_repository.py").write_text(validator)
        self.git(root, "init", "--quiet")
        self.git(root, "config", "user.email", "test@example.invalid")
        self.git(root, "config", "user.name", "Test")
        self.git(
            root, "remote", "add", "origin",
            remote or "https://github.com/fallrising/doc_analysis_study.git",
        )
        self.git(root, "add", ".")
        self.git(root, "commit", "--quiet", "-m", "base")
        commit = self.git(root, "rev-parse", "HEAD")
        self.git(root, "branch", "-M", "main")
        if not attached:
            self.git(root, "checkout", "--quiet", "--detach", commit)
        return commit

    def bundle(self, root):
        request, evidence, _ = fixture()
        result = export_study(request, evidence, Path(root).resolve())
        return Path(root).resolve() / result.bundle_name, result.bundle_id

    def inputs(self, root, **target_options):
        root = Path(root).resolve()
        base = root / "base"
        base.mkdir()
        commit = self.target(base, **target_options)
        bundle, digest = self.bundle(root / "bundles")
        staging = root / "staging"
        staging.mkdir(mode=0o700)
        contract = target_contract_digest(base, IDENTITY, commit)
        return base, commit, bundle, digest, staging, contract

    def publish(self, values, **overrides):
        base, commit, bundle, digest, staging, contract = values
        arguments = {
            "bundle_root": bundle,
            "base": base,
            "staging_root": staging,
            "expected_base": commit,
            "expected_contract": contract,
            "expected_bundle": digest,
            "expected_repository": IDENTITY,
        }
        arguments.update(overrides)
        return publish_local(**arguments)

    def test_preview_apply_idempotent_preserves_base_commit_and_exact_diff(self):
        with tempfile.TemporaryDirectory() as directory:
            values = self.inputs(directory)
            base, commit, _bundle, digest, staging, contract = values
            base_status = self.git(base, "status", "--porcelain=v1", "--untracked-files=all")
            preview = self.publish(values)
            self.assertEqual(preview.operation, "preview")
            self.assertFalse(list(staging.iterdir()))
            self.assertEqual(preview.bundle_digest, digest)
            self.assertEqual(preview.target_contract_digest, contract)
            self.assertEqual(preview.diff_sha256, hashlib.sha256(preview.diff.encode()).hexdigest())
            self.assertIn("studies/one-study/README.md", preview.diff)
            applied = self.publish(values, apply=True)
            self.assertEqual(applied.operation, "apply")
            destination = staging / ("study-" + digest)
            self.assertEqual(self.git(destination, "rev-parse", "HEAD"), commit)
            self.assertEqual(
                tuple(self.git(destination, "diff", "--cached", "--name-only").splitlines()),
                applied.changed_paths,
            )
            self.assertEqual(self.publish(values, apply=True), applied)
            self.assertEqual(self.git(base, "status", "--porcelain=v1", "--untracked-files=all"), base_status)

    def test_bundle_aggregate_tree_hash_and_link_attacks_fail_before_staging(self):
        cases = ("aggregate", "artifact", "extra", "link")
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                values = self.inputs(directory)
                _base, _commit, bundle, _digest, staging, _contract = values
                if case == "aggregate":
                    manifest = json.loads((bundle / "manifest.json").read_text())
                    manifest["source_ids"] = ["SRC-999"]
                    (bundle / "manifest.json").write_text(
                        json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n"
                    )
                elif case == "artifact":
                    (bundle / "studies/one-study/README.md").write_text("changed\n")
                elif case == "extra":
                    (bundle / "extra.txt").write_text("extra\n")
                else:
                    original = bundle / "studies/one-study/progress.md"
                    original.unlink()
                    original.symlink_to(bundle / "registry-row.md")
                with self.assertRaises(StudyPublishError):
                    self.publish(values)
                self.assertFalse(list(staging.iterdir()))

    def test_dirty_attached_wrong_remote_contract_and_unsafe_config_are_rejected(self):
        mutations = ("dirty", "attached", "remote", "contract", "config", "hook")
        for mutation in mutations:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                values = self.inputs(directory)
                base = values[0]
                if mutation == "dirty":
                    (base / "dirty.txt").write_text("dirty")
                elif mutation == "attached":
                    self.git(base, "switch", "--quiet", "-c", "unsafe")
                elif mutation == "remote":
                    self.git(base, "remote", "set-url", "origin", "https://github.com/other/repository.git")
                elif mutation == "config":
                    self.git(base, "config", "credential.helper", "store")
                elif mutation == "hook":
                    (base / ".git/hooks/post-checkout").write_text("#!/bin/sh\nexit 0\n")
                overrides = {"expected_contract": "0" * 64} if mutation == "contract" else {}
                with self.assertRaises(StudyPublishError):
                    self.publish(values, **overrides)
                self.assertFalse(list(values[4].iterdir()))

    def test_validator_failure_warning_and_out_of_scope_change_cleanup(self):
        validators = (
            "import sys\nprint('VALIDATION FAILED')\nsys.exit(1)\n",
            VALIDATOR + "print('warning')\n",
        )
        for validator in validators:
            with self.subTest(validator=validator[-20:]), tempfile.TemporaryDirectory() as directory:
                values = self.inputs(directory, validator=validator)
                with self.assertRaises(StudyPublishError):
                    self.publish(values)
                self.assertFalse(list(values[4].iterdir()))

        with tempfile.TemporaryDirectory() as directory:
            values = self.inputs(directory)
            original = study_publisher._apply

            def escaped(*arguments):
                allowed = original(*arguments)
                (arguments[0] / "outside.txt").write_text("outside\n")
                return allowed

            with mock.patch.object(study_publisher, "_apply", side_effect=escaped):
                with self.assertRaises(StudyPublishError):
                    self.publish(values)
            self.assertFalse(list(values[4].iterdir()))

    def test_base_mutation_partial_write_and_destination_tamper_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            values = self.inputs(directory)
            base, _commit, _bundle, digest, staging, _contract = values
            original = study_publisher._snapshot

            def mutate(*arguments):
                original(*arguments)
                (base / "race.txt").write_text("race\n")

            with mock.patch.object(study_publisher, "_snapshot", side_effect=mutate):
                with self.assertRaises(StudyPublishError):
                    self.publish(values)
            self.assertFalse(list(staging.iterdir()))

        with tempfile.TemporaryDirectory() as directory:
            values = self.inputs(directory)
            with mock.patch.object(study_publisher, "_write", side_effect=OSError("partial")):
                with self.assertRaises(OSError):
                    self.publish(values)
            self.assertFalse(list(values[4].iterdir()))

        with tempfile.TemporaryDirectory() as directory:
            values = self.inputs(directory)
            result = self.publish(values, apply=True)
            destination = values[4] / ("study-" + result.bundle_digest)
            (destination / "studies/one-study/README.md").write_text("tampered\n")
            with self.assertRaises(StudyPublishError):
                self.publish(values, apply=True)

    def test_collision_does_not_replace_unrelated_staging_content(self):
        with tempfile.TemporaryDirectory() as directory:
            values = self.inputs(directory)
            destination = values[4] / ("study-" + values[3])
            destination.mkdir()
            sentinel = destination / "sentinel"
            sentinel.write_text("keep\n")
            with self.assertRaises(StudyPublishError):
                self.publish(values, apply=True)
            self.assertEqual(sentinel.read_text(), "keep\n")

    def test_identity_admin_and_linked_destination_guards(self):
        for mutation in ("base", "bundle", "repository", "alternates", "replace", "worktree"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                values = self.inputs(directory)
                base = values[0]
                overrides = {}
                if mutation == "base":
                    overrides["expected_base"] = "0" * 40
                elif mutation == "bundle":
                    overrides["expected_bundle"] = "0" * 64
                elif mutation == "repository":
                    overrides["expected_repository"] = "other/repository"
                elif mutation == "alternates":
                    alternate = base / ".git/objects/info/alternates"
                    alternate.write_text("/nonexistent/objects\n")
                elif mutation == "replace":
                    replace = base / ".git/refs/replace"
                    replace.mkdir(parents=True)
                    (replace / ("0" * 40)).write_text("0" * 40 + "\n")
                else:
                    extra = Path(directory) / "extra-worktree"
                    self.git(base, "worktree", "add", "--quiet", "--detach", str(extra), "HEAD")
                with self.assertRaises(StudyPublishError):
                    self.publish(values, **overrides)
                self.assertFalse(list(values[4].iterdir()))

        with tempfile.TemporaryDirectory() as directory:
            values = self.inputs(directory)
            destination = values[4] / ("study-" + values[3])
            outside = Path(directory) / "outside"
            outside.mkdir()
            (outside / "sentinel").write_text("keep\n")
            destination.symlink_to(outside, target_is_directory=True)
            with self.assertRaises(StudyPublishError):
                self.publish(values, apply=True)
            self.assertEqual((outside / "sentinel").read_text(), "keep\n")

    def test_cli_measures_contract_and_emits_bounded_relative_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            values = self.inputs(directory)
            base, commit, bundle, digest, staging, contract = values
            output, error = StringIO(), StringIO()
            with redirect_stdout(output), redirect_stderr(error):
                status = study_main([
                    "target-contract", "--base", str(base),
                    "--expected-base", commit, "--expected-repository", IDENTITY,
                ])
            self.assertEqual(status, 0)
            self.assertEqual(json.loads(output.getvalue())["target_contract_digest"], contract)
            output = StringIO()
            with redirect_stdout(output), redirect_stderr(error):
                status = study_main([
                    "publish-local", "--bundle", str(bundle), "--base", str(base),
                    "--staging-root", str(staging), "--expected-base", commit,
                    "--expected-contract", contract, "--expected-bundle", digest,
                    "--expected-repository", IDENTITY,
                ])
            self.assertEqual(status, 0)
            result = json.loads(output.getvalue())
            self.assertEqual(result["operation"], "preview")
            self.assertEqual(result["changed_paths"][0], "README.md")
            self.assertNotIn(str(Path(directory).resolve()), output.getvalue())
            self.assertLess(len(output.getvalue()), 2 * 1024 * 1024)
            self.assertEqual(error.getvalue(), "")

    def test_git_timeout_and_nonzero_are_stable_errors(self):
        completed = subprocess.CompletedProcess(["git"], 1, b"", b"")
        for effect in (subprocess.TimeoutExpired(["git"], 20), completed):
            with self.subTest(effect=type(effect).__name__):
                patcher = (
                    mock.patch("subprocess.run", side_effect=effect)
                    if isinstance(effect, BaseException)
                    else mock.patch("subprocess.run", return_value=effect)
                )
                with patcher, self.assertRaises(StudyPublishError):
                    study_publisher._git("/usr/bin/git", Path.cwd(), ["status"])

    def github_inputs(self, directory):
        values = self.inputs(directory)
        local = self.publish(values, apply=True)
        checkout = values[4] / ("study-" + local.bundle_digest)
        remote = Path(directory) / "remote.git"
        subprocess.run(
            ["git", "clone", "--quiet", "--bare", str(values[0]), str(remote)],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        return values, checkout, remote

    def fake_github(self, checkout, calls, *, fail_create=False):
        pull_requests = []

        def invoke(_config, _cwd, arguments):
            args = tuple(arguments)
            calls.append(args)
            if args[:2] == ("pr", "list"):
                return json.dumps(pull_requests, sort_keys=True).encode()
            if args[:2] == ("pr", "create"):
                if fail_create:
                    raise StudyPublishError("publication command was rejected")
                commit = self.git(checkout, "rev-parse", "HEAD")
                branch = args[args.index("--head") + 1]
                value = {
                    "baseRefName": "main",
                    "headRefName": branch,
                    "headRefOid": commit,
                    "isDraft": True,
                    "number": 7,
                    "state": "OPEN",
                    "url": "https://github.com/fallrising/doc_analysis_study/pull/7",
                }
                pull_requests.append(value)
                return (value["url"] + "\n").encode()
            if args[:2] == ("pr", "view") and len(pull_requests) == 1:
                return json.dumps(pull_requests[0], sort_keys=True).encode()
            raise AssertionError(args)

        return invoke, pull_requests

    def test_github_fake_remote_publish_and_replay_are_exact(self):
        with tempfile.TemporaryDirectory() as directory:
            values, checkout, remote = self.github_inputs(directory)
            _base, base_commit, bundle, digest, _staging, contract = values
            calls = []
            git_calls = []
            fake, pulls = self.fake_github(checkout, calls)
            original_git = study_publisher._publication_git

            def record_git(*arguments, **keywords):
                git_calls.append(tuple(arguments[2]))
                return original_git(*arguments, **keywords)

            with mock.patch.object(study_publisher, "_github_cli", side_effect=fake), \
                    mock.patch.object(study_publisher, "_publication_git", side_effect=record_git):
                result = publish_github(
                    checkout, bundle, base_commit, contract, digest,
                    publish=True, _test_transport=remote,
                )
                replay = publish_github(
                    checkout, bundle, base_commit, contract, digest,
                    publish=True, _test_transport=remote,
                )
            branch = "study/one-study-" + digest[:12]
            self.assertEqual(result.operation, "publish")
            self.assertEqual(replay.operation, "reuse")
            self.assertEqual(result.branch, branch)
            self.assertEqual(result.commit_sha, replay.commit_sha)
            self.assertEqual(result.commit_sha, result.pushed_sha)
            self.assertEqual(result.pr_number, 7)
            self.assertTrue(result.draft)
            self.assertEqual(len(pulls), 1)
            self.assertEqual(
                self.git(remote, "rev-parse", "refs/heads/main"), base_commit,
            )
            self.assertEqual(
                self.git(remote, "rev-parse", "refs/heads/" + branch),
                result.commit_sha,
            )
            self.assertEqual(
                tuple(
                    self.git(
                        checkout, "diff-tree", "--no-commit-id", "--name-only",
                        "-r", result.commit_sha,
                    ).splitlines()
                ),
                result.changed_paths,
            )
            creates = [args for args in calls if args[:2] == ("pr", "create")]
            self.assertEqual(len(creates), 1)
            pushes = [args for args in git_calls if args[0] == "push"]
            self.assertEqual(
                pushes,
                [("push", "--porcelain", "--no-verify", str(remote),
                  f"refs/heads/{branch}:refs/heads/{branch}")],
            )
            self.assertIn("--draft", creates[0])
            self.assertNotIn("--fill", creates[0])
            forbidden = {"--force", "--delete", "--tags", "merge", "ready", "repo"}
            self.assertFalse(any(forbidden.intersection(args) for args in calls))
            evidence = json.loads(
                (checkout / ".git/ice-maker-github.json").read_text()
            )
            self.assertEqual(evidence["commit_sha"], result.commit_sha)
            self.assertNotIn(str(Path(directory).resolve()), json.dumps(evidence))
            evidence["draft"] = False
            (checkout / ".git/ice-maker-github.json").write_text(
                json.dumps(evidence, sort_keys=True, separators=(",", ":")) + "\n"
            )
            with self.assertRaises(StudyPublishError):
                publish_github(checkout, bundle, base_commit, contract, digest)

    def test_github_dry_run_and_script_do_not_mutate_checkout_or_remote(self):
        with tempfile.TemporaryDirectory() as directory:
            values, checkout, remote = self.github_inputs(directory)
            _base, base_commit, bundle, digest, _staging, contract = values
            before_head = self.git(checkout, "rev-parse", "HEAD")
            before_status = self.git(
                checkout, "status", "--porcelain=v1", "--untracked-files=all",
            )
            output, error = StringIO(), StringIO()
            with redirect_stdout(output), redirect_stderr(error):
                status = study_main([
                    "publish-github", "--staging-checkout", str(checkout),
                    "--bundle", str(bundle), "--expected-base", base_commit,
                    "--expected-contract", contract, "--expected-bundle", digest,
                ])
            self.assertEqual(status, 0)
            result = json.loads(output.getvalue())
            self.assertEqual(result["operation"], "dry-run")
            self.assertEqual(result["repository"], IDENTITY)
            self.assertEqual(result["base_branch"], "main")
            self.assertEqual(len(result["changed_paths"]), 6)
            self.assertIsNone(result["commit_sha"])
            self.assertEqual(error.getvalue(), "")
            self.assertEqual(self.git(checkout, "rev-parse", "HEAD"), before_head)
            self.assertEqual(
                self.git(checkout, "status", "--porcelain=v1", "--untracked-files=all"),
                before_status,
            )
            self.assertEqual(
                self.git(remote, "for-each-ref", "--format=%(refname)", "refs/heads").splitlines(),
                ["refs/heads/main"],
            )

            script = Path(__file__).parents[1] / "scripts/publish-study.sh"
            completed = subprocess.run(
                [
                    str(script), "--staging-checkout", str(checkout),
                    "--bundle", str(bundle), "--expected-base", base_commit,
                    "--expected-contract", contract, "--expected-bundle", digest,
                ],
                cwd=Path(__file__).parents[1], check=False, text=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(json.loads(completed.stdout)["operation"], "dry-run")
            self.assertFalse((checkout / ".git/ice-maker-github-prepared.json").exists())

    def test_github_config_and_staging_identity_fail_closed(self):
        source = Path(__file__).parents[1] / "config/study-github-publication.json"
        original = json.loads(source.read_text())
        for field, value in (
            ("remote_repository", "other/repository"),
            ("base_branch", "develop"),
            ("branch_prefix", "unsafe/"),
            ("git_executable", "/bin/false"),
            ("timeout_seconds", 61),
            ("max_output_bytes", 1048577),
        ):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                config = dict(original)
                config[field] = value
                path = Path(directory) / "config.json"
                path.write_text(json.dumps(config, sort_keys=True, separators=(",", ":")) + "\n")
                with self.assertRaises(StudyPublishError):
                    load_github_publication_config(path.resolve())

        for mutation in ("base", "contract", "bundle", "artifact", "secret", "extra"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                values, checkout, _remote = self.github_inputs(directory)
                _base, base_commit, bundle, digest, _staging, contract = values
                arguments = [checkout, bundle, base_commit, contract, digest]
                if mutation == "base":
                    arguments[2] = "0" * 40
                elif mutation == "contract":
                    arguments[3] = "0" * 64
                elif mutation == "bundle":
                    arguments[4] = "0" * 64
                elif mutation == "artifact":
                    (checkout / "studies/one-study/progress.md").write_text("changed\n")
                elif mutation == "secret":
                    (checkout / "studies/one-study/progress.md").write_text(
                        "ghp_abcdefghijklmnopqrstuvwxyz123456\n"  # SYNTHETIC_TEST_SECRET
                    )
                else:
                    (checkout / "outside.txt").write_text("outside\n")
                with self.assertRaises(StudyPublishError):
                    publish_github(*arguments)

    def test_github_stale_remote_collision_and_pr_retry_preserve_local_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            values, checkout, remote = self.github_inputs(directory)
            base, base_commit, bundle, digest, _staging, contract = values
            self.git(base, "checkout", "--quiet", "main")
            (base / "stale.txt").write_text("remote advanced\n")
            self.git(base, "add", "stale.txt")
            self.git(base, "commit", "--quiet", "-m", "remote advanced")
            self.git(base, "push", "--quiet", str(remote), "main:main")
            with self.assertRaises(StudyPublishError):
                publish_github(
                    checkout, bundle, base_commit, contract, digest,
                    publish=True, _test_transport=remote,
                )
            self.assertEqual(self.git(checkout, "rev-parse", "HEAD"), base_commit)

        with tempfile.TemporaryDirectory() as directory:
            values, checkout, remote = self.github_inputs(directory)
            _base, base_commit, bundle, digest, _staging, contract = values
            branch = "study/one-study-" + digest[:12]
            self.git(remote, "update-ref", "refs/heads/" + branch, base_commit)
            calls = []
            fake, _pulls = self.fake_github(checkout, calls)
            with mock.patch.object(study_publisher, "_github_cli", side_effect=fake):
                with self.assertRaises(StudyPublishError):
                    publish_github(
                        checkout, bundle, base_commit, contract, digest,
                        publish=True, _test_transport=remote,
                    )
            self.assertTrue((checkout / ".git/ice-maker-github-prepared.json").is_file())
            self.assertFalse(calls)

        with tempfile.TemporaryDirectory() as directory:
            values, checkout, remote = self.github_inputs(directory)
            _base, base_commit, bundle, digest, _staging, contract = values
            calls = []
            failing, _pulls = self.fake_github(checkout, calls, fail_create=True)
            with mock.patch.object(study_publisher, "_github_cli", side_effect=failing):
                with self.assertRaises(StudyPublishError):
                    publish_github(
                        checkout, bundle, base_commit, contract, digest,
                        publish=True, _test_transport=remote,
                    )
            prepared = checkout / ".git/ice-maker-github-prepared.json"
            self.assertTrue(prepared.is_file())
            branch = json.loads(prepared.read_text())["branch"]
            pushed = self.git(remote, "rev-parse", "refs/heads/" + branch)
            retry_calls = []
            succeeding, pulls = self.fake_github(checkout, retry_calls)
            with mock.patch.object(study_publisher, "_github_cli", side_effect=succeeding):
                result = publish_github(
                    checkout, bundle, base_commit, contract, digest,
                    publish=True, _test_transport=remote,
                )
            self.assertEqual(result.commit_sha, pushed)
            self.assertEqual(len(pulls), 1)

        with tempfile.TemporaryDirectory() as directory:
            values, checkout, remote = self.github_inputs(directory)
            _base, base_commit, bundle, digest, _staging, contract = values
            original_git = study_publisher._publication_git

            def fail_push(*arguments, **keywords):
                if tuple(arguments[2])[0] == "push":
                    raise StudyPublishError("publication command was rejected")
                return original_git(*arguments, **keywords)

            with mock.patch.object(
                study_publisher, "_publication_git", side_effect=fail_push,
            ), mock.patch.object(study_publisher, "_github_cli") as github:
                with self.assertRaises(StudyPublishError):
                    publish_github(
                        checkout, bundle, base_commit, contract, digest,
                        publish=True, _test_transport=remote,
                    )
            self.assertFalse(github.called)
            self.assertTrue((checkout / ".git/ice-maker-github-prepared.json").is_file())
            branch = "study/one-study-" + digest[:12]
            self.assertNotIn(
                "refs/heads/" + branch,
                self.git(remote, "for-each-ref", "--format=%(refname)", "refs/heads"),
            )

        with tempfile.TemporaryDirectory() as directory:
            values, checkout, remote = self.github_inputs(directory)
            _base, base_commit, bundle, digest, _staging, contract = values

            def collision(_config, _cwd, arguments):
                args = tuple(arguments)
                if args[:2] != ("pr", "list"):
                    raise AssertionError(args)
                branch = args[args.index("--head") + 1]
                commit = self.git(checkout, "rev-parse", "HEAD")
                value = {
                    "baseRefName": "main", "headRefName": branch,
                    "headRefOid": commit, "isDraft": True, "number": 7,
                    "state": "OPEN",
                    "url": "https://github.com/fallrising/doc_analysis_study/pull/7",
                }
                return json.dumps([value, {**value, "number": 8,
                    "url": "https://github.com/fallrising/doc_analysis_study/pull/8"}]).encode()

            with mock.patch.object(
                study_publisher, "_github_cli", side_effect=collision,
            ), self.assertRaisesRegex(StudyPublishError, "pull request collision"):
                publish_github(
                    checkout, bundle, base_commit, contract, digest,
                    publish=True, _test_transport=remote,
                )
            self.assertTrue((checkout / ".git/ice-maker-github-prepared.json").is_file())
            self.assertFalse((checkout / ".git/ice-maker-github.json").exists())

    def test_github_command_timeout_and_partial_evidence_are_stable(self):
        config = load_github_publication_config()
        with mock.patch(
            "subprocess.run", side_effect=subprocess.TimeoutExpired(["git"], 60),
        ), self.assertRaisesRegex(StudyPublishError, "publication command failed"):
            study_publisher._publication_git(config, Path.cwd(), ["status"])

        secret = subprocess.CompletedProcess(
            ["git"], 0,
            b"ghp_abcdefghijklmnopqrstuvwxyz123456\n",  # SYNTHETIC_TEST_SECRET
            b"",
        )
        with mock.patch("subprocess.run", return_value=secret), \
                self.assertRaisesRegex(StudyPublishError, "publication command was rejected"):
            study_publisher._publication_git(config, Path.cwd(), ["status"])

        with tempfile.TemporaryDirectory() as directory:
            values, checkout, _remote = self.github_inputs(directory)
            _base, base_commit, bundle, digest, _staging, contract = values
            (checkout / ".git/ice-maker-github.json").write_text("{}\n")
            with self.assertRaises(StudyPublishError):
                publish_github(checkout, bundle, base_commit, contract, digest)

        service_source = (
            Path(__file__).parents[1] / "src/ice_maker/document_service.py"
        ).read_text()
        self.assertNotIn("study_publisher", service_source)
        self.assertNotIn("publish_github", service_source)


if __name__ == "__main__":
    unittest.main()
