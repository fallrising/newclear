"""Broker readiness must distinguish a TCP proxy from authenticated TLS."""

from __future__ import annotations

import shutil
import socket
import ssl
import subprocess
import threading
from pathlib import Path

import pytest
from tests.integration import conftest as integration


@pytest.fixture
def certificates(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    shutil.copy2(integration.ROOT / "scripts/generate_dev_certs.sh", scripts)
    subprocess.run(  # noqa: S603 - fixed repository script copied to this test's own directory
        ["bash", str(scripts / "generate_dev_certs.sh")],  # noqa: S607
        check=True,
        capture_output=True,
        timeout=30,
    )
    certs = tmp_path / "certs"
    monkeypatch.setattr(integration, "CERTS", certs)
    return certs


@pytest.mark.parametrize("tls_ready", [False, True])
def test_ac05_tcp_proxy_is_not_authenticated_broker_readiness(
    certificates: Path, tls_ready: bool
) -> None:
    errors: list[Exception] = []
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        listener.settimeout(5)
        port = listener.getsockname()[1]

        def serve() -> None:
            try:
                with listener.accept()[0] as connection:
                    if tls_ready:
                        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                        context.load_cert_chain(
                            certificates / "server.pem", certificates / "server.key"
                        )
                        context.load_verify_locations(certificates / "ca.pem")
                        context.verify_mode = ssl.CERT_REQUIRED
                        with context.wrap_socket(connection, server_side=True):
                            pass
                    # A pre-ready Docker proxy accepts TCP then closes without TLS.
            except Exception as exc:
                errors.append(exc)

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        try:
            assert integration.emqx_available("127.0.0.1", port) is tls_ready
        finally:
            thread.join(timeout=6)
        assert not thread.is_alive()
        assert not errors
