"""Publish a public patch validation manifest from two independent private builds."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import uuid

from labops import atomic_json
from core_release import validation_record

PROJECT = Path(__file__).resolve().parent.parent
SHA256 = re.compile(r"^[0-9a-f]{64}$")
VERSION = re.compile(r"^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
BUILD_STEPS = ("baseline", "regression", "calcium", "locks", "build")
PUBLIC_STEP_NAMES = {
    "baseline": "baseline-final",
    "regression": "patched-final",
    "calcium": "calcium-tests",
    "locks": "lock-tests",
    "build": "build",
}


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _read_result(project, result_file):
    project = Path(project).resolve()
    supplied = Path(result_file)
    candidate = (project / supplied) if not supplied.is_absolute() else supplied
    path = candidate.resolve()
    builds = (project / "private/builds").resolve()
    if (candidate.is_symlink() or not path.is_relative_to(builds)
            or path.name != "result.json" or not path.is_file()):
        raise ValueError("build result must be a regular result.json under private/builds/")
    raw = path.read_bytes()
    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError("build result must contain a JSON object")
    if type(result.get("schema_version")) is not int or result["schema_version"] != 1:
        raise ValueError("build result schema is unsupported")
    if result.get("status") != "verified-not-deployed":
        raise ValueError("both build runs must have completed local validation")
    if result.get("repository") != "projecteru2/core":
        raise ValueError("build result source repository is unexpected")
    if not isinstance(result.get("release_id"), str) or not isinstance(result.get("source_commit"), str):
        raise ValueError("build result release identity is incomplete")
    if (not isinstance(result.get("source_tag"), str)
            or not VERSION.fullmatch(result["source_tag"])
            or result.get("target_version") != result["source_tag"]):
        raise ValueError("build result version identity is invalid")
    if (not isinstance(result.get("patch_revision"), int) or isinstance(result["patch_revision"], bool)
            or result["patch_revision"] < 1):
        raise ValueError("build result patch revision is invalid")
    compatible = result.get("compatible_from_versions")
    if (not isinstance(compatible, list) or not compatible
            or any(not isinstance(version, str) or not VERSION.fullmatch(version) for version in compatible)
            or len(set(compatible)) != len(compatible) or result["source_tag"] not in compatible):
        raise ValueError("build result compatibility list is invalid")
    artifact_sha = result.get("artifact_sha256")
    if not isinstance(artifact_sha, str) or not SHA256.fullmatch(artifact_sha):
        raise ValueError("build result artifact checksum is invalid")
    toolchain = result.get("toolchain")
    if (not isinstance(toolchain, dict) or not isinstance(toolchain.get("version"), str)
            or not isinstance(toolchain.get("sha256"), str)
            or not SHA256.fullmatch(toolchain["sha256"])
            or toolchain.get("os") != "linux" or toolchain.get("arch") != "amd64"):
        raise ValueError("build result toolchain identity is incomplete")
    steps = result.get("steps")
    if (not isinstance(steps, list)
            or any(not isinstance(step, dict) or not isinstance(step.get("name"), str) for step in steps)):
        raise ValueError("build result steps are incomplete")
    step_map = {step["name"]: step for step in steps}
    if len(step_map) != len(steps) or not set(BUILD_STEPS).issubset(step_map):
        raise ValueError("build result is missing required steps or duplicates step names")
    if step_map["baseline"].get("exit_code") in (None, 0):
        raise ValueError("baseline must reproduce the expected regression")
    if any(step_map[name].get("exit_code") != 0 for name in BUILD_STEPS[1:]):
        raise ValueError("patched test or build step failed")
    for name in BUILD_STEPS:
        argv = step_map[name].get("argv")
        if not isinstance(argv, list) or not argv or any(not isinstance(arg, str) for arg in argv):
            raise ValueError("build result command arguments are incomplete")
    for version in compatible:
        if version == result["source_tag"]:
            continue
        step = step_map.get("compatibility-from-" + version)
        if (not step or step.get("exit_code") != 0
                or not isinstance(step.get("argv"), list) or not step["argv"]):
            raise ValueError("cross-version compatibility test is missing or failed")
    baseline_log = path.parent / "baseline.log"
    if not baseline_log.is_file() or baseline_log.is_symlink():
        raise ValueError("private baseline log is missing")
    if baseline_log.read_text(errors="replace").count("cannot create context from nil parent") < 2:
        raise ValueError("baseline log does not contain the expected regression")
    patch_file = result.get("patch_file")
    if not isinstance(patch_file, str) or Path(patch_file).name != patch_file or not patch_file.endswith(".patch"):
        raise ValueError("build result patch filename is invalid")
    patch = (project / "patches" / patch_file).resolve()
    if not patch.is_relative_to((project / "patches").resolve()) or not patch.is_file():
        raise ValueError("build result patch is outside patches/")
    patch_sha = result.get("patch_sha256")
    if not isinstance(patch_sha, str) or not SHA256.fullmatch(patch_sha) or _sha(patch.read_bytes()) != patch_sha:
        raise ValueError("build result patch checksum does not match the reviewed patch")
    return result, raw


def _public_argv(argv):
    safe = list(argv)
    safe[0] = "go"
    for index, arg in enumerate(safe):
        if arg == "-o":
            if index + 1 >= len(safe):
                raise ValueError("build output flag has no path")
            safe[index + 1] = "<private artifact>"
        elif (Path(arg).is_absolute() or "private/builds" in arg
              or any(marker in arg for marker in ("/home/", "/tmp/", "/root/"))):
            raise ValueError("private paths are not allowed in a public build summary")
    return safe


def publish(project, first_result, independent_result, output):
    project = Path(project).resolve()
    first, first_raw = _read_result(project, first_result)
    second, second_raw = _read_result(project, independent_result)
    identity = (
        "release_id", "repository", "source_tag", "target_version", "patch_revision",
        "compatible_from_versions", "architecture", "patch_file", "patch_sha256",
        "source_commit", "toolchain", "artifact_sha256",
    )
    if any(first.get(key) != second.get(key) for key in identity):
        raise ValueError("independent build identity does not match the primary build")
    output_input = Path(output)
    output_candidate = (project / output_input) if not output_input.is_absolute() else output_input
    output_path = output_candidate.resolve()
    patches = (project / "patches").resolve()
    if (output_candidate.is_symlink() or not output_path.is_relative_to(patches)
            or not output_path.name.endswith(".validation.json")):
        raise ValueError("public manifest output must be a new file under patches/")
    if output_path.exists():
        raise FileExistsError("refusing to overwrite an existing release manifest")

    first_steps = {step["name"]: step for step in first["steps"]}
    second_steps = {step["name"]: step for step in second["steps"]}
    public_steps = [
        {"name": PUBLIC_STEP_NAMES[name],
         "argv": _public_argv(first_steps[name]["argv"]),
         "exit_code": first_steps[name]["exit_code"]}
        for name in BUILD_STEPS
    ]
    for version in first["compatible_from_versions"]:
        if version == first["source_tag"]:
            continue
        name = "compatibility-from-" + version
        public_steps.append({"name": name, "argv": _public_argv(first_steps[name]["argv"]),
                             "exit_code": first_steps[name]["exit_code"]})
    report = {
        "schema_version": 1,
        "release_id": first["release_id"],
        "repository": first["repository"],
        "source_tag": first["source_tag"],
        "target_version": first["target_version"],
        "patch_revision": first["patch_revision"],
        "compatible_from_versions": first["compatible_from_versions"],
        "architecture": first["architecture"],
        "patch_file": first["patch_file"],
        "patch_sha256": first["patch_sha256"],
        "source_commit": first["source_commit"],
        "artifact_sha256": first["artifact_sha256"],
        "toolchain": first["toolchain"],
        "steps": public_steps,
        "build_result_sha256": {
            "primary": _sha(first_raw),
            "independent": _sha(second_raw),
        },
        "independent_runner_verification": {
            "status": "verified-not-deployed",
            "artifact_sha256": second["artifact_sha256"],
            "byte_identical_to_first_build": first["artifact_sha256"] == second["artifact_sha256"],
            "steps": [{"name": name, "exit_code": second_steps[name]["exit_code"]}
                      for name in BUILD_STEPS + tuple("compatibility-from-" + version
                          for version in second["compatible_from_versions"]
                          if version != second["source_tag"])],
        },
        "note": "Raw build logs and artifacts remain private; deployment state is tracked separately.",
        "status": "verified-not-deployed",
    }
    temporary = patches / ("." + output_path.name + "." + uuid.uuid4().hex + ".validation.json")
    try:
        atomic_json(temporary, report)
        validation_record(project, temporary)
        os.replace(temporary, output_path)
    except BaseException:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
        raise
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--first-result", type=Path, required=True, help="Primary private result.json")
    parser.add_argument("--independent-result", type=Path, required=True, help="Independent private result.json")
    parser.add_argument("--output", type=Path, required=True, help="New public manifest path under patches/")
    args = parser.parse_args()
    report = publish(PROJECT, args.first_result, args.independent_result, args.output)
    print(json.dumps({
        "release_id": report["release_id"],
        "source_tag": report["source_tag"],
        "artifact_sha256": report["artifact_sha256"],
        "manifest": str(args.output),
        "status": report["status"],
    }, indent=2))


if __name__ == "__main__":
    main()
