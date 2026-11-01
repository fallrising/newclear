"""Prepare/build an explicit local patch of the hash-pinned Memvid SDK source."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "work/semantic-sdk"
URL = "https://files.pythonhosted.org/packages/7e/1a/709899b6757e1d1fde0bbe7e97fd814411931ab6c8c68b876305404b7a83/memvid_sdk-2.0.160.tar.gz"
ARCHIVE_SIZE = 9880521
ARCHIVE_SHA = "8eab5aec9a30eb459f553ed091038b6916d02a2f33569b32a7aee1b556820243"
BINDING_SHA = "1a00d3813b09c1e61378a3bd5e8f6caca35144490d80d672260f6bb29e894b52"
LOCK_SHA = "43cbd08f2ea7ee24b6dac987e14a8880fa6dec2fb20c772a27746e758dc4127d"
BUILD_LOCK_SHA = "f3270621bd0e67786a8d21363d3f038c9accbc80069fe11627581d7f92e795e1"
CORE_VEC_SHA = "702f3c3ef98b64f0a86b173d1c046eb4b7d96121f41dc603091adb70f224cf90"
HNSW_SHA = "2b9740ebf8769ec4ad6762cc951ba18f39bba6dfbc2fbbe46285f7539af79752"
PATCH_ID = "explicit-vector-batch-v3-hnsw"


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def prepare_hnsw(source):
    archive = BUILD / "hnsw-0.11.0.crate"
    if not archive.exists():
        url = "https://static.crates.io/crates/hnsw/hnsw-0.11.0.crate"
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read(26781)
        if len(data) != 26780 or hashlib.sha256(data).hexdigest() != HNSW_SHA:
            raise ValueError("HNSW archive differs from existing dependency pin")
        with archive.open("xb") as stream:
            stream.write(data)
    if digest(archive) != HNSW_SHA:
        raise ValueError("HNSW archive differs from existing dependency pin")
    vendor = source / "vendor"
    vendor.mkdir()
    with tarfile.open(archive) as packed:
        packed.extractall(vendor, filter="data")
    (vendor / "hnsw-0.11.0").rename(vendor / "hnsw")
    implementation = vendor / "hnsw/src/hnsw/hnsw_const.rs"
    data = implementation.read_bytes()
    old = b"dest.copy_from_slice(&searcher.nearest[..found]);"
    if data.count(old) != 2:
        raise ValueError("HNSW short-result fix does not match pinned source")
    implementation.write_bytes(data.replace(old, b"dest[..found].copy_from_slice(&searcher.nearest[..found]);"))


def prepare(archive=None):
    BUILD.mkdir(parents=True, exist_ok=True)
    if archive is None:
        archive = BUILD / "source.tar.gz"
        if not archive.exists():
            with urllib.request.urlopen(URL, timeout=60) as response:
                data = response.read(ARCHIVE_SIZE + 1)
            if len(data) != ARCHIVE_SIZE or hashlib.sha256(data).hexdigest() != ARCHIVE_SHA:
                raise ValueError("SDK source archive differs from pin")
            with archive.open("xb") as stream:
                stream.write(data)
    if archive.stat().st_size != ARCHIVE_SIZE or digest(archive) != ARCHIVE_SHA:
        raise ValueError("SDK source archive differs from pin")
    target = BUILD / "source"
    with tempfile.TemporaryDirectory(dir=BUILD) as temporary:
        with tarfile.open(archive) as packed:
            packed.extractall(temporary, filter="data")
        source = Path(temporary) / "memvid_sdk-2.0.160"
        binding = source / "bindings/python/src/lib.rs"
        if (digest(binding) != BINDING_SHA or digest(source / "Cargo.lock") != LOCK_SHA
                or digest(source / "crates/memvid-core/src/vec.rs") != CORE_VEC_SHA):
            raise ValueError("SDK source/lock identity mismatch")
        subprocess.run(["patch", "--batch", "--fuzz=0", "-p1", "-i", str(ROOT / "semantic-sdk.patch")],
                       cwd=source, check=True, timeout=30)
        subprocess.run(["patch", "--batch", "--fuzz=0", "-p1", "-i", str(ROOT / "semantic-sdk-lock.patch")],
                       cwd=source, check=True, timeout=30)
        if digest(source / "Cargo.lock") != BUILD_LOCK_SHA:
            raise ValueError("Reconciled lock differs from pin")
        prepare_hnsw(source)
        if target.exists():
            files = lambda p: {str(f.relative_to(p)): digest(f) for f in p.rglob("*") if f.is_file()}
            if files(target) != files(source):
                raise ValueError("Existing SDK source changed; not overwritten")
        else:
            shutil.move(str(source), target)
    return target


def build(source):
    subprocess.run(["cargo", "+1.90.0", "build", "--locked", "--release", "--manifest-path",
                    str(source / "bindings/python/Cargo.toml"), "--target-dir", str(BUILD / "target")],
                   check=True, timeout=1200)
    native = BUILD / "target/release/libmemvid_sdk.so"
    overlay = BUILD / "overlay"
    overlay.mkdir(exist_ok=True)
    library = overlay / "_lib.abi3.so"
    if library.exists() and digest(library) != digest(native):
        raise ValueError("Existing overlay differs; preserve it before rebuilding")
    if not library.exists():
        shutil.copyfile(native, library)
    manifest = {"patch": PATCH_ID, "sdk": "2.0.160", "core": "2.0.140", "archive_sha256": ARCHIVE_SHA,
                "patch_sha256": digest(ROOT / "semantic-sdk.patch"), "original_cargo_lock_sha256": LOCK_SHA, "cargo_lock_sha256": BUILD_LOCK_SHA,
                "lock_patch_sha256": digest(ROOT / "semantic-sdk-lock.patch"),
                "binding_sha256": digest(source / "bindings/python/src/lib.rs"),
                "core_vec_sha256": digest(source / "crates/memvid-core/src/vec.rs"),
                "hnsw_archive_sha256": HNSW_SHA,
                "hnsw_source_sha256": digest(source / "vendor/hnsw/src/hnsw/hnsw_const.rs"),
                "preparer_sha256": digest(ROOT / "prepare_semantic_sdk.py"), "library_sha256": digest(library),
                "toolchain": "1.90.0", "features": "pinned SDK default features", "runtime": "explicit opt-in overlay"}
    (BUILD / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--build", action="store_true")
    args = parser.parse_args()
    source = prepare(args.archive)
    if args.build:
        build(source)
