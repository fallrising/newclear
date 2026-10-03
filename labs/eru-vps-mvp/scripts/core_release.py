"""Validate versioned Eru Core patch provenance and classify safe release transitions."""
import hashlib
import json
from pathlib import Path
import re

VERSION = re.compile(r"^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
REQUIRED_STEPS = {
    "patched-final", "calcium-tests", "lock-tests", "build",
}


def _json(path):
    return json.loads(Path(path).read_text())


def _hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _version(value):
    match = VERSION.fullmatch(value) if isinstance(value, str) else None
    if not match:
        raise ValueError("only stable vMAJOR.MINOR.PATCH release tags are supported")
    return tuple(int(part) for part in match.groups())


def validation_record(project, validation_file):
    """Load a reviewed public validation record and return its hash-bound identity."""
    project = Path(project).resolve()
    supplied = Path(validation_file)
    candidate = (project / supplied) if not supplied.is_absolute() else supplied
    path = candidate.resolve()
    patches = (project / "patches").resolve()
    if candidate.is_symlink() or not path.is_relative_to(patches) or not path.name.endswith(".validation.json"):
        raise ValueError("validation record must be a regular file under patches/")
    raw = path.read_bytes()
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("validation record must contain a JSON object")
    if type(data.get("schema_version")) is not int or data.get("schema_version") != 1:
        raise ValueError("unsupported patch validation schema")
    if data.get("repository") != "projecteru2/core":
        raise ValueError("validation record names an unexpected source repository")
    source_tag = data.get("source_tag")
    target_version = data.get("target_version")
    _version(source_tag)
    _version(target_version)
    if source_tag != target_version:
        raise ValueError("patched binaries must retain their pinned upstream core version")
    source_commit = data.get("source_commit", "")
    if not _matches(COMMIT, source_commit):
        raise ValueError("validation record has an invalid source commit")
    release_id = data.get("release_id")
    if not isinstance(release_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,95}", release_id):
        raise ValueError("validation record has an invalid release ID")
    patch_revision = data.get("patch_revision")
    if not isinstance(patch_revision, int) or isinstance(patch_revision, bool) or patch_revision < 1:
        raise ValueError("patch revision must be a positive integer")

    architecture = data.get("architecture")
    lock = _json(project / "artifacts.amd64.lock.json")
    if architecture != lock.get("architecture"):
        raise ValueError("patch artifact architecture differs from the reviewed deployment lock")
    patch_file = data.get("patch_file")
    if not isinstance(patch_file, str) or Path(patch_file).name != patch_file or not patch_file.endswith(".patch"):
        raise ValueError("patch file must be a single reviewed filename")
    patch_candidate = patches / patch_file
    patch_path = patch_candidate.resolve()
    if patch_candidate.is_symlink() or not patch_path.is_relative_to(patches) or not patch_path.is_file():
        raise ValueError("patch file must be a regular file under patches/")
    patch_sha = data.get("patch_sha256", "")
    if not _matches(SHA256, patch_sha) or _hash(patch_path) != patch_sha:
        raise ValueError("patch checksum does not match validation record")

    artifact_sha = data.get("artifact_sha256", "")
    if not _matches(SHA256, artifact_sha):
        raise ValueError("validation record has an invalid artifact checksum")
    independent = data.get("independent_runner_verification")
    if (not isinstance(independent, dict)
            or independent.get("status") != "verified-not-deployed"
            or independent.get("artifact_sha256") != artifact_sha
            or independent.get("byte_identical_to_first_build") is not True):
        raise ValueError("independent reproducible build is not verified")
    independent_steps = independent.get("steps")
    if not isinstance(independent_steps, list):
        raise ValueError("independent build steps are missing")
    independent_map = {step.get("name"): step for step in independent_steps if isinstance(step, dict)}
    if not {"regression", "calcium", "locks", "build"}.issubset(independent_map):
        raise ValueError("independent reproducible build steps are incomplete")
    if any(independent_map[name].get("exit_code") != 0
           for name in {"regression", "calcium", "locks", "build"}):
        raise ValueError("an independent build test or build step failed")
    independent_baseline = independent_map.get("baseline")
    if (not independent_baseline or independent_baseline.get("exit_code") in (None, 0)):
        raise ValueError("independent baseline did not record the expected failing tests")

    steps = data.get("steps")
    if not isinstance(steps, list):
        raise ValueError("validation steps are missing")
    if any(not isinstance(step, dict) or not isinstance(step.get("name"), str) for step in steps):
        raise ValueError("validation step records are malformed")
    step_map = {step["name"]: step for step in steps}
    if len(step_map) != len(steps):
        raise ValueError("validation step names must be unique")
    if not REQUIRED_STEPS.issubset(step_map):
        raise ValueError("required patched build steps are missing")
    if any(step_map[name].get("exit_code") != 0
           or not isinstance(step_map[name].get("argv"), list)
           or not step_map[name]["argv"] for name in REQUIRED_STEPS):
        raise ValueError("a patched test or build step is incomplete or failed")
    baseline = step_map.get("baseline-final")
    if not baseline or baseline.get("exit_code") in (None, 0) or not baseline.get("argv"):
        raise ValueError("validation did not record the expected failing baseline command")
    compatible = data.get("compatible_from_versions")
    if (not isinstance(compatible, list) or not compatible
            or any(not isinstance(version, str) for version in compatible)
            or len(set(compatible)) != len(compatible)):
        raise ValueError("compatible_from_versions must be a non-empty unique list")
    for version in compatible:
        _version(version)
    if source_tag not in compatible:
        raise ValueError("release must declare compatibility with its own upstream source version")
    for version in compatible:
        if version == source_tag:
            continue
        step = step_map.get("compatibility-from-" + version)
        if (not step or step.get("exit_code") != 0
                or not isinstance(step.get("argv"), list) or not step["argv"]):
            raise ValueError("cross-version compatibility requires a passing version-specific test step")

    toolchain = data.get("toolchain")
    if not isinstance(toolchain, dict) or toolchain.get("os") != "linux" or toolchain.get("arch") != "amd64":
        raise ValueError("toolchain platform is incomplete or unsupported")
    if not isinstance(toolchain.get("version"), str) or not re.fullmatch(
            r"go[0-9]+\.[0-9]+\.[0-9]+", toolchain["version"]):
        raise ValueError("toolchain version is invalid")
    if not _matches(SHA256, toolchain.get("sha256")):
        raise ValueError("toolchain archive checksum is invalid")
    return {
        "validation_file": str(path.relative_to(project)),
        "validation_sha256": hashlib.sha256(raw).hexdigest(),
        "release_id": release_id,
        "repository": data["repository"],
        "source_tag": source_tag,
        "target_version": target_version,
        "patch_revision": patch_revision,
        "source_commit": source_commit,
        "compatible_from_versions": compatible,
        "architecture": architecture,
        "patch_file": patch_file,
        "patch_sha256": patch_sha,
        "toolchain_version": toolchain["version"],
        "toolchain_sha256": toolchain["sha256"],
        "artifact_sha256": artifact_sha,
    }


def runtime_release(project, runtime_sha256, revision=None):
    """Resolve a running checksum to a verified and unambiguous release identity."""
    if revision is not None and not isinstance(revision, dict):
        raise ValueError("core revision record must contain a JSON object")
    if (revision and revision.get("operation") == "core-patch"
            and revision.get("artifact_sha256") != runtime_sha256):
        raise ValueError("running core checksum differs from the recorded patch revision")
    if revision and revision.get("artifact_sha256") == runtime_sha256 and revision.get("release"):
        recorded = revision["release"]
        try:
            actual = validation_record(project, recorded["validation_file"])
        except (KeyError, OSError, ValueError, json.JSONDecodeError) as exc:
            raise ValueError("installed core release provenance is no longer verifiable") from exc
        if actual != recorded or actual["artifact_sha256"] != runtime_sha256:
            raise ValueError("installed core release provenance does not match the running checksum")
        return actual

    matches = []
    for path in sorted((Path(project) / "patches").glob("*.validation.json")):
        try:
            data = _json(path)
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict) or data.get("artifact_sha256") != runtime_sha256:
            continue
        # A record that claims this exact running binary must validate completely;
        # otherwise we cannot downgrade it to an unknown baseline.
        release = validation_record(project, path)
        matches.append(release)
    if len(matches) > 1 and any(match != matches[0] for match in matches[1:]):
        raise ValueError("running core checksum maps to multiple release identities")
    if not matches and revision and revision.get("operation") == "core-patch":
        if revision.get("artifact_sha256") == runtime_sha256:
            raise ValueError("installed core patch has no valid release provenance")
    return matches[0] if matches else None


def classify_transition(current, target, baseline_version):
    """Classify an install without treating a same-version reapply as an upgrade."""
    baseline_version = baseline_version or ""
    _version(baseline_version)
    if current is None:
        if target["source_tag"] != baseline_version:
            raise ValueError("installed core version is unknown; cross-version upgrade is blocked")
        if baseline_version not in target["compatible_from_versions"]:
            raise ValueError("candidate patch does not declare compatibility with the pinned baseline")
        return {"kind": "baseline-install", "from_version": baseline_version,
                "to_version": target["target_version"], "cross_version": False}
    if current["artifact_sha256"] == target["artifact_sha256"]:
        if current["source_tag"] != target["source_tag"] or current["target_version"] != target["target_version"]:
            raise ValueError("one artifact checksum cannot identify two core versions")
        return {"kind": "same-release-reapply", "from_version": current["target_version"],
                "to_version": target["target_version"], "cross_version": False}
    current_order = _version(current["target_version"])
    target_order = _version(target["target_version"])
    if target_order < current_order:
        raise ValueError("core downgrade requires an explicit source-run rollback")
    if current["source_tag"] not in target["compatible_from_versions"]:
        raise ValueError("candidate does not declare compatibility with the installed core version")
    if target_order == current_order:
        if current["source_commit"] != target["source_commit"]:
            raise ValueError("upstream tag resolves to a different source commit")
        if target["patch_revision"] <= current["patch_revision"]:
            raise ValueError("same-version artifact change requires a higher explicit patch revision")
        return {"kind": "same-version-patch-update", "from_version": current["target_version"],
                "to_version": target["target_version"], "cross_version": False}
    return {"kind": "cross-version-upgrade", "from_version": current["target_version"],
            "to_version": target["target_version"], "cross_version": True}
