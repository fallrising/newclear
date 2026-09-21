"""Read-only KVM diagnosis; never load modules or change host networking."""

import os
import platform
import shutil
from pathlib import Path

from .contracts import OPENHANDS_IMAGE, PENDING_KVM_GATES


def cpu_capabilities(cpuinfo: str) -> dict:
    flags = set()
    for line in cpuinfo.splitlines():
        key, _, value = line.partition(":")
        if key.strip().lower() in {"flags", "features"}:
            flags.update(value.split())
    return {
        "hypervisor_present": "hypervisor" in flags,
        "x86_virtualization_exposed": bool(flags & {"vmx", "svm"}),
    }


def inspect_host():
    try:
        cpu = cpu_capabilities(Path("/proc/cpuinfo").read_text())
    except OSError:
        cpu = {"hypervisor_present": None, "x86_virtualization_exposed": None}
    reason = "device_missing"
    api_version = None
    try:
        import fcntl

        with open("/dev/kvm", "rb+", buffering=0) as device:
            api_version = fcntl.ioctl(device, 0xAE00, 0)  # KVM_GET_API_VERSION, read-only.
        reason = "ready" if api_version == 12 else "unsupported_kvm_api"
    except PermissionError:
        reason = "kvm_permission_denied"
    except FileNotFoundError:
        if platform.machine() in {"x86_64", "amd64"} and cpu["x86_virtualization_exposed"] is False:
            reason = "cpu_virtualization_not_exposed"
    except (OSError, ImportError):
        reason = "kvm_api_unavailable"
    return {
        "platform": platform.system(),
        "architecture": platform.machine(),
        **cpu,
        "kvm_present": Path("/dev/kvm").exists(),
        "kvm_accessible": os.access("/dev/kvm", os.R_OK | os.W_OK),
        "kvm_api_version": api_version,
        "kvm_ready": reason == "ready",
        "kvm_diagnosis": reason,
        "docker_cli_present": shutil.which("docker") is not None,
        "cocoon_cli_present": shutil.which("cocoon") is not None,
        "sandboxd_present": shutil.which("sandboxd") is not None,
        "openhands_image": OPENHANDS_IMAGE,
        "pending_kvm_gates": PENDING_KVM_GATES,
        "full_m0_complete": False,
    }
