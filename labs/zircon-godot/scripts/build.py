#!/usr/bin/env python3
"""Build the external pinned checkout; never start a server or acquire assets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from xml.sax.saxutils import escape

LAB = Path(__file__).resolve().parents[1]


def git(source, *args):
    return subprocess.check_output(["git", "-C", str(source), *args], text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--dotnet", type=Path, required=True)
    args = parser.parse_args()
    source = args.source.resolve()
    dotnet = str(args.dotnet.resolve())
    build = Path(os.environ["AGENT_BUILD_DIR"])
    evidence = Path(os.environ["AGENT_EVIDENCE_DIR"])
    manifest = json.loads((LAB / "sources.json").read_text())
    if git(source, "rev-parse", "HEAD") != manifest["commit"]:
        parser.error("checkout HEAD differs from sources.json; do not silently upgrade")
    if git(source, "diff", "--cached", "--name-only"):
        parser.error("checkout has staged changes")
    patch_path = LAB / "patches/0001-graceful-console-stop.patch"
    patch = patch_path.read_text().strip()
    diff = git(source, "diff", "--no-ext-diff", "--no-color", "--unified=1", "HEAD")
    if diff and diff != patch:
        parser.error("checkout changes differ from the reviewed shutdown patch")
    if git(source, "ls-files", "--others", "--exclude-standard"):
        parser.error("checkout has untracked inputs; inspect them before building")
    for item in manifest["files"]:
        blob = git(source, "rev-parse", f"HEAD:{item['path']}")
        if blob != item["blob_sha"]:
            parser.error(f"source manifest mismatch: {item['path']}")
    env = dict(os.environ, NUGET_PACKAGES=str(build.parent / "cache/nuget"),
               DOTNET_CLI_HOME=str(build.parent / "cache/dotnet-home"),
               DOTNET_CLI_TELEMETRY_OPTOUT="1", DOTNET_SKIP_FIRST_TIME_EXPERIENCE="1",
               MSBUILDDISABLENODEREUSE="1", DOTNET_CLI_USE_MSBUILD_SERVER="0")
    version = subprocess.check_output([dotnet, "--version"], env=env, text=True).strip()
    if not version.startswith("10.0."):
        parser.error("the pinned projects require .NET SDK 10.0.x")
    report = {"source_sha": manifest["commit"], "dotnet_version": version,
              "source_manifest_files": len(manifest["files"]),
              "patch_sha256": hashlib.sha256(patch_path.read_bytes()).hexdigest() if diff else None,
              "results": [], "runtime_acceptance": "not run"}
    # Godot 4.6.3 overrides the SDK artifacts layout for its intermediate files.
    # Apply this property only to that project; references keep distinct paths.
    props = build / "godot-paths.props"
    props.write_text(f'''<Project><PropertyGroup Condition="'$(MSBuildProjectName)' == 'ZirconClient'">
<BaseIntermediateOutputPath>{escape(str(build / 'godot-obj'))}/</BaseIntermediateOutputPath>
<IntermediateOutputPath>{escape(str(build / 'godot-obj'))}/$(Configuration)/</IntermediateOutputPath>
</PropertyGroup></Project>''')
    for project, config in [("ServerCore/ServerCore.csproj", "Release"),
                            ("GodotClient/ZirconClient.csproj", "Debug"),
                            ("Tests/GroundLootChecks/GroundLootChecks.csproj", "Release")]:
        name = Path(project).stem
        command = [dotnet, "build", project, "-c", config, "--disable-build-servers",
                   "--artifacts-path", str(build / "artifacts"),
                   "-o", str(build / name), "-v:minimal"]
        if name == "ZirconClient":
            command.append(f"-p:CustomBeforeDirectoryBuildProps={props}")
        with (evidence / f"{name}.log").open("w") as log:
            try:
                result = subprocess.run(command, cwd=source, env=env, stdout=log,
                                        stderr=subprocess.STDOUT, timeout=300)
                code = result.returncode
            except subprocess.TimeoutExpired:
                code = 124
        report["results"].append({"project": project, "command": command, "exit_code": code})
        print(f"{name}: exit {code}; log {evidence / (name + '.log')}", flush=True)
        (evidence / "build-results.json").write_text(json.dumps(report, indent=2) + "\n")
    hashes = {}
    for name in ("ServerCore", "ZirconClient", "GroundLootChecks"):
        for path in sorted((build / name).glob("*.dll")):
            with path.open("rb") as stream:
                hashes[str(path.relative_to(build))] = hashlib.file_digest(stream, "sha256").hexdigest()
    report["binary_sha256"] = hashes
    (evidence / "build-results.json").write_text(json.dumps(report, indent=2) + "\n")
    return int(any(item["exit_code"] for item in report["results"]))


if __name__ == "__main__":
    sys.exit(main())
