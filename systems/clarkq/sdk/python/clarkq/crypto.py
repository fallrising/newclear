"""Client-side crypto helpers for clarkQ encryption modes."""

from __future__ import annotations

import os
import base64
from typing import Dict, Optional, Tuple

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "clarkq crypto helpers require the 'cryptography' package: pip install cryptography"
    ) from exc


def generate_aes256_key() -> bytes:
    return os.urandom(32)


def encrypt_client_aes(key: bytes, plaintext: bytes, key_id: str = "client-key") -> Tuple[str, Dict[str, str]]:
    if len(key) != 32:
        raise ValueError("AES-256 key must be 32 bytes")
    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plaintext, None)
    meta = {
        "mode": "client",
        "algorithm": "aes-256-gcm",
        "key_id": key_id,
        "nonce": base64.b64encode(nonce).decode("ascii"),
    }
    return base64.b64encode(ct).decode("ascii"), meta


def decrypt_client_aes(key: bytes, body: str, meta: Dict[str, str]) -> bytes:
    if len(key) != 32:
        raise ValueError("AES-256 key must be 32 bytes")
    nonce = base64.b64decode(meta["nonce"])
    ct = base64.b64decode(body)
    return AESGCM(key).decrypt(nonce, ct, None)


def load_rsa_private_key(pem_data: bytes):
    return serialization.load_pem_private_key(pem_data, password=None)


def load_rsa_private_key_file(path: str):
    with open(path, "rb") as f:
        return load_rsa_private_key(f.read())


def decrypt_server_rsa(private_key, body: str, meta: Dict[str, str]) -> bytes:
    enc_dek = base64.b64decode(meta["encrypted_key"])
    nonce = base64.b64decode(meta["nonce"])
    ct = base64.b64decode(body)
    dek = private_key.decrypt(
        enc_dek,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return AESGCM(dek).decrypt(nonce, ct, None)
