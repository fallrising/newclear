"""Local-only study bundle exporter; intentionally no provider or Git hooks."""
from __future__ import annotations

import argparse
import json
import sys

from .study_export import StudyBundle, StudyExportError, export_study, load_json_file
from .study_publisher import (
    StudyGithubResult,
    StudyPublishError,
    StudyPublishResult,
    publish_github,
    publish_local,
    target_contract_digest,
)


def _output(bundle: StudyBundle) -> str:
    value = {
        "artifact_count": bundle.artifact_count,
        "bundle_id": bundle.bundle_id,
        "bundle_name": bundle.bundle_name,
        "manifest_sha256": bundle.manifest_sha256,
    }
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
    ) + "\n"


def _publish_output(result: StudyPublishResult) -> str:
    return json.dumps({
        "base_commit": result.base_commit,
        "bundle_digest": result.bundle_digest,
        "changed_paths": list(result.changed_paths),
        "diff_sha256": result.diff_sha256,
        "diff": result.diff,
        "operation": result.operation,
        "target_contract_digest": result.target_contract_digest,
    }, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"


def _github_output(result: StudyGithubResult) -> str:
    return json.dumps({
        "base_branch": result.base_branch,
        "base_commit": result.base_commit,
        "branch": result.branch,
        "bundle_digest": result.bundle_digest,
        "changed_paths": list(result.changed_paths),
        "command_exit_classes": list(result.command_exit_classes),
        "commit_sha": result.commit_sha,
        "diff_sha256": result.diff_sha256,
        "draft": result.draft,
        "operation": result.operation,
        "pr_number": result.pr_number,
        "pr_url": result.pr_url,
        "pushed_sha": result.pushed_sha,
        "remote_url": result.remote_url,
        "repository": result.repository,
        "tree_sha256": result.tree_sha256,
    }, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="study", add_help=True)
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export")
    export.add_argument("--request", required=True)
    export.add_argument("--evidence", required=True)
    export.add_argument("--state-root", required=True)
    export.add_argument("--config")
    publish = commands.add_parser("publish-local")
    publish.add_argument("--bundle", required=True)
    publish.add_argument("--base", required=True)
    publish.add_argument("--staging-root", required=True)
    publish.add_argument("--expected-base", required=True)
    publish.add_argument("--expected-bundle", required=True)
    publish.add_argument("--expected-contract", required=True)
    publish.add_argument("--expected-repository", required=True)
    publish.add_argument("--apply", action="store_true")
    contract = commands.add_parser("target-contract")
    contract.add_argument("--base", required=True)
    contract.add_argument("--expected-base", required=True)
    contract.add_argument("--expected-repository", required=True)
    github = commands.add_parser("publish-github")
    github.add_argument("--staging-checkout", required=True)
    github.add_argument("--bundle", required=True)
    github.add_argument("--expected-base", required=True)
    github.add_argument("--expected-contract", required=True)
    github.add_argument("--expected-bundle", required=True)
    github.add_argument("--config")
    github.add_argument("--publish", action="store_true")
    try:
        args = parser.parse_args(argv)
        if args.command == "export":
            request = load_json_file(args.request)
            evidence = load_json_file(args.evidence)
            bundle = export_study(
                request, evidence, args.state_root, config_path=args.config,
            )
            sys.stdout.write(_output(bundle))
        elif args.command == "publish-local":
            result = publish_local(
                args.bundle, args.base, args.staging_root, args.expected_base,
                args.expected_contract, args.expected_bundle,
                args.expected_repository,
                apply=args.apply,
            )
            sys.stdout.write(_publish_output(result))
        elif args.command == "target-contract":
            digest = target_contract_digest(
                args.base, args.expected_repository, args.expected_base,
            )
            sys.stdout.write(json.dumps(
                {"base_commit": args.expected_base, "target_contract_digest": digest},
                sort_keys=True, separators=(",", ":"), ensure_ascii=True,
            ) + "\n")
        else:
            result = publish_github(
                args.staging_checkout, args.bundle, args.expected_base,
                args.expected_contract, args.expected_bundle,
                publish=args.publish, config_path=args.config,
            )
            sys.stdout.write(_github_output(result))
        return 0
    except (OSError, ValueError, StudyExportError, StudyPublishError):
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
