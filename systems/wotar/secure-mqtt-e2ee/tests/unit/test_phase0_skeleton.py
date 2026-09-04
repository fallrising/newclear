"""Phase 0: verify package import and tooling."""

import importlib
import ssl
import sys
from pathlib import Path


def test_package_imports() -> None:
    pkg = importlib.import_module("secure_mqtt")
    assert pkg.__version__ == "0.1.0"


def test_python_version() -> None:
    assert sys.version_info >= (3, 12)


def test_aesgcm_siv_available() -> None:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCMSIV

    key = b"\x00" * 32
    nonce = b"\x00" * 12
    aead = AESGCMSIV(key)
    ct = aead.encrypt(nonce, b"test", b"aad")
    assert aead.decrypt(nonce, ct, b"aad") == b"test"


def test_openssl_version() -> None:
    assert ssl.OPENSSL_VERSION


def test_project_layout() -> None:
    root = Path(__file__).resolve().parents[2]
    assert (root / "pyproject.toml").exists()
    assert (root / "src" / "secure_mqtt" / "__init__.py").exists()
    assert (root / "docs" / "assumptions.md").exists()
