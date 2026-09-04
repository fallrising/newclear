"""Minimal clarkQ HTTP client."""

from .client import APIError, Client, Message

__all__ = ["APIError", "Client", "Message"]
__version__ = "0.1.0"

# Crypto helpers are optional (require cryptography package).
try:
    from .crypto import (
        decrypt_client_aes,
        decrypt_server_rsa,
        encrypt_client_aes,
        generate_aes256_key,
        load_rsa_private_key,
        load_rsa_private_key_file,
    )

    __all__ += [
        "decrypt_client_aes",
        "decrypt_server_rsa",
        "encrypt_client_aes",
        "generate_aes256_key",
        "load_rsa_private_key",
        "load_rsa_private_key_file",
    ]
except ImportError:
    pass

