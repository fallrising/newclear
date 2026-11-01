"""Opt in to the verified local explicit-vector SDK patch; stock SDK stays intact."""
import importlib.metadata
import importlib.util
import json
from pathlib import Path
import sys
from prepare_semantic_sdk import ROOT, BUILD, ARCHIVE_SHA, BUILD_LOCK_SHA, HNSW_SHA, PATCH_ID, digest

WRAPPER_SHA = "c5910e0027af00d52c0bb26fd8697cdf3938f70b940168571b7fc093d319bdf2"


def activate():
    if "memvid_sdk" in sys.modules or "memvid_sdk._lib" in sys.modules:
        raise RuntimeError("Select patched SDK before importing memvid_sdk")
    manifest = json.loads((BUILD / "manifest.json").read_text())
    library = BUILD / "overlay/_lib.abi3.so"
    if (manifest.get("patch") != PATCH_ID or manifest.get("archive_sha256") != ARCHIVE_SHA
            or manifest.get("hnsw_archive_sha256") != HNSW_SHA
            or manifest.get("preparer_sha256") != digest(ROOT / "prepare_semantic_sdk.py")
            or manifest.get("cargo_lock_sha256") != BUILD_LOCK_SHA
            or manifest.get("lock_patch_sha256") != digest(ROOT / "semantic-sdk-lock.patch")
            or manifest.get("patch_sha256") != digest(ROOT / "semantic-sdk.patch")
            or manifest.get("library_sha256") != digest(library)):
        raise ValueError("Prepared semantic SDK identity/checksum mismatch")
    distribution = importlib.metadata.distribution("memvid-sdk")
    wrapper = Path(distribution.locate_file("memvid_sdk/__init__.py"))
    if distribution.version != "2.0.160" or digest(wrapper) != WRAPPER_SHA:
        raise ValueError("Expected pinned SDK Python wrapper")
    spec = importlib.util.spec_from_file_location("memvid_sdk", wrapper,
              submodule_search_locations=[str(library.parent), str(wrapper.parent)])
    module = importlib.util.module_from_spec(spec)
    previous_modules = set(sys.modules)
    sys.modules["memvid_sdk"] = module
    try:
        spec.loader.exec_module(module)
        if Path(sys.modules["memvid_sdk._lib"].__file__).resolve() != library.resolve():
            raise RuntimeError("Patched SDK was not loaded")
    except BaseException:
        for name in set(sys.modules) - previous_modules:
            if name == "memvid_sdk" or name.startswith("memvid_sdk."):
                sys.modules.pop(name, None)
        raise
    return manifest
