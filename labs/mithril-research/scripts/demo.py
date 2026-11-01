"""Exercise the real CLI against synthetic data in a new private local scope."""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import stat
import subprocess
import sys


@contextmanager
def private_output(raw, source_root):
    # Path.absolute() preserves '..'; reject it before any filesystem mutation.
    if ".." in Path(raw).parts:
        raise ValueError("parent traversal is unsupported")
    output = Path(os.path.abspath(raw))
    if source_root in output.parents or output == source_root or output == Path("/"):
        raise ValueError("output must be outside source")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    parentfd = os.open("/", flags)
    outputfd = None
    try:
        for part in output.parts[1:-1]:
            childfd = os.open(part, flags, dir_fd=parentfd)
            os.close(parentfd)
            parentfd = childfd
        # mkdir is exclusive; an existing directory or symlink is never reused.
        os.mkdir(output.name, mode=0o700, dir_fd=parentfd)
        outputfd = os.open(output.name, flags, dir_fd=parentfd)
        info = os.fstat(outputfd)
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise ValueError("output must be private and owned")
        yield output, outputfd
    finally:
        if outputfd is not None:
            os.close(outputfd)
        os.close(parentfd)


def verify_acceptance(smoke, report):
    if (smoke.get("result") != "simulated-pass" or report.get("observation") != "owned"
            or report.get("synthetic_resources") != 0 or report.get("uncertain_operations") != 0
            or report.get("smoke") != "simulated-pass"):
        raise RuntimeError("local fixture acceptance incomplete")


def run_demo(component, output, outputfd):

    def save(name, value):
        fd = os.open(name, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW,
                     0o600, dir_fd=outputfd)
        with os.fdopen(fd, "w") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")

    inventory = json.loads((component / "examples/inventory.example.json").read_text())
    inventory["access_policy_revision"] = "synthetic-local-fixture"
    save("inventory.json", inventory)
    receipts = []
    cli = component / "scripts/labctl.py"

    def invoke(arguments):
        argv = [sys.executable, str(cli), *arguments]
        result = subprocess.run(argv, capture_output=True, text=True, timeout=30)
        receipts.append({"argv": argv, "exit_code": result.returncode,
                         "stdout": result.stdout, "stderr": result.stderr})
        if result.returncode:
            save("private-receipts.json", receipts)
            raise RuntimeError("local fixture command failed; inspect private receipts")
        value = json.loads(result.stdout)
        if value.get("lane") != "local-fixture" or value.get("remote_execution_supported") is not False:
            raise RuntimeError("fixture evidence lane mismatch")
        return value

    plan = invoke(["plan", "--inventory", str(output / "inventory.json"),
                   "--runtime-lock", str(component / "runtime.lock.json")])
    save("plan.json", plan)
    binding = ["--plan", str(output / "plan.json"), "--expected-digest", plan["plan_sha256"],
               "--state-root", str(output / "state")]
    first = invoke(["fixture", "up", *binding])
    first_marker = first["retained_marker"]
    first_ids = {item["id"] for item in first["resources"]}
    smoke = invoke(["fixture", "smoke", *binding])
    invoke(["fixture", "down", *binding])
    second = invoke(["fixture", "up", *binding])
    second_ids = {item["id"] for item in second["resources"]}
    if second["retained_marker"] != first_marker or first_ids & second_ids:
        raise RuntimeError("retained-data/process-recreation mismatch")
    second_smoke = invoke(["fixture", "smoke", *binding])
    invoke(["fixture", "down", *binding])
    report = invoke(["fixture", "report", *binding])
    save("private-receipts.json", receipts)
    verify_acceptance(smoke, report)
    verify_acceptance(second_smoke, report)
    summary = {"lane": "local-fixture", "remote_execution_supported": False,
               "result": "simulated-pass", "cli_commands": len(receipts),
               "retained_marker_verified": True, "process_instances_recreated": True,
               "synthetic_checks": smoke["checks"], "report": report,
               "remote_runtime": "UNEXECUTED"}
    save("report.json", summary)
    print(json.dumps(summary, sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="New private directory outside source")
    args = parser.parse_args()
    component = Path(__file__).resolve().parents[1]
    source_root = component.parents[1]
    try:
        with private_output(args.output, source_root) as (output, outputfd):
            run_demo(component, output, outputfd)
    except (OSError, ValueError):
        parser.error("output must be a new private directory outside source, without symlinks or traversal")


if __name__ == "__main__":
    main()
