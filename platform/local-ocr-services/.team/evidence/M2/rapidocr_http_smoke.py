from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
ENGINE = {"name": "rapidocr", "version": "3.9.2", "model": "PP-OCRv6-small"}
DIMENSIONS = {
    "traditional.png": {"width": 1200, "height": 300},
    "english.png": {"width": 1600, "height": 400},
}
EXPECTED_NORMALIZED_SHA256 = {
    "traditional.png": "4a97ff6fa716e066a52b48e4a68c25564a17d6478da294f135dadfac61e68483",
    "english.png": "542fefc5052dd2afd62a8fc460074ab5cd32adf46dace6f15c284c59b875b950",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--fixture-dir", type=Path, required=True)
    parser.add_argument("--api-key-env-file", type=Path)
    parser.add_argument("--start-server", action="store_true")
    parser.add_argument("--expect-network-none", action="store_true")
    return parser.parse_args()


def api_key(args: argparse.Namespace) -> str:
    if args.api_key_env_file:
        line = args.api_key_env_file.read_text().strip()
        name, value = line.split("=", 1)
        assert name == "OCR_API_KEY"
        return value
    return os.environ["OCR_API_KEY"]


def send(
    base_url: str,
    path: str,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
):
    request = urllib.request.Request(
        base_url + path,
        data=data,
        headers=headers or {},
        method="POST" if data is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return (
                response.status,
                {key.lower(): value for key, value in response.headers.items()},
                response.read(),
            )
    except urllib.error.HTTPError as error:
        return (
            error.code,
            {key.lower(): value for key, value in error.headers.items()},
            error.read(),
        )


def unauthorized(label: str, result):
    status, headers, body = result
    payload = json.loads(body)
    assert status == 401
    assert payload["detail"]["code"] == "unauthorized"
    assert headers["www-authenticate"] == "ApiKey"
    return {
        "case": label,
        "status": status,
        "error_code": "unauthorized",
        "www_authenticate": "ApiKey",
    }


def ocr(
    base_url: str,
    fixture_dir: Path,
    key: str,
    name: str,
    request_id: str | None,
):
    image = (fixture_dir / name).read_bytes()
    headers = {"Content-Type": "image/png", "X-API-Key": key}
    if request_id:
        headers["X-Request-ID"] = request_id
    status, response_headers, body = send(
        base_url, "/v1/ocr", data=image, headers=headers
    )
    payload = json.loads(body)
    assert status == 200
    assert payload["schema_version"] == "1.0"
    assert payload["engine"] == ENGINE
    assert payload["image"] == DIMENSIONS[name]
    assert payload["elapsed_ms"] >= 0
    assert payload["structured"] is None
    assert payload["regions"]
    assert response_headers["x-request-id"] == payload["request_id"]
    assert REQUEST_ID_PATTERN.fullmatch(payload["request_id"])
    if request_id:
        assert payload["request_id"] == request_id
    confidences = []
    for region in payload["regions"]:
        assert isinstance(region["text"], str) and region["text"].strip()
        assert len(region["polygon"]) == 4
        assert all(
            isinstance(point["x"], int) and isinstance(point["y"], int)
            for point in region["polygon"]
        )
        assert region["page"] == 1
        assert region["block_type"] is None
        if region["confidence"] is not None:
            assert 0 <= region["confidence"] <= 1
            confidences.append(region["confidence"])
    recognized = "".join(region["text"] for region in payload["regions"])
    normalized_recognized = "".join(recognized.split()).upper()
    normalized_sha256 = hashlib.sha256(normalized_recognized.encode()).hexdigest()
    assert normalized_sha256 == EXPECTED_NORMALIZED_SHA256[name]
    summary = {
        "case": name,
        "status": status,
        "schema_version": payload["schema_version"],
        "engine": payload["engine"],
        "image": payload["image"],
        "elapsed_ms": round(payload["elapsed_ms"], 3),
        "region_count": len(payload["regions"]),
        "confidence_min": round(min(confidences), 6) if confidences else None,
        "confidence_max": round(max(confidences), 6) if confidences else None,
        "request_id_source": "provided" if request_id else "generated",
        "request_id_header_matches_body": True,
        "request_id_valid": True,
        "polygon_lengths": sorted(
            {len(region["polygon"]) for region in payload["regions"]}
        ),
        "pages": sorted({region["page"] for region in payload["regions"]}),
        "structured_is_null": True,
        "expected_text_exact_after_whitespace_case_normalization": True,
        "recognized_text_redacted": True,
    }
    return summary, recognized


def security_summary(expect_network_none: bool):
    if not expect_network_none:
        return None
    interfaces = socket.if_nameindex()
    assert interfaces == [(1, "lo")]
    status_lines = {}
    for line in Path("/proc/self/status").read_text().splitlines():
        if line.startswith(("Uid:", "Gid:", "CapEff:", "NoNewPrivs:")):
            name, value = line.split(":", 1)
            status_lines[name] = value.strip()
    assert status_lines["Uid"].split() == ["10001"] * 4
    assert status_lines["Gid"].split() == ["10001"] * 4
    assert status_lines["CapEff"] == "0000000000000000"
    assert status_lines["NoNewPrivs"] == "1"
    try:
        Path("/rootfs-probe").write_text("probe")
    except OSError as error:
        rootfs_read_only = error.errno == 30
    else:
        rootfs_read_only = False
    assert rootfs_read_only
    return {
        "interfaces": interfaces,
        "only_loopback": True,
        "uid": 10001,
        "gid": 10001,
        "cap_eff": status_lines["CapEff"],
        "no_new_privileges": int(status_lines["NoNewPrivs"]),
        "rootfs_read_only": rootfs_read_only,
    }


def main() -> None:
    args = parse_args()
    key = api_key(args)
    security = security_summary(args.expect_network_none)
    server = None
    server_log = ""
    started = time.monotonic()
    if args.start_server:
        server = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "ocr_service.app:create_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
                "--workers",
                "1",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
    try:
        ready_status = 0
        attempts = 0
        while ready_status != 200 and attempts < 1200:
            attempts += 1
            try:
                ready_status, _, ready_body = send(args.base_url, "/health/ready")
            except urllib.error.URLError:
                ready_status = 0
            if ready_status != 200:
                time.sleep(0.1)
        ready_ms = (time.monotonic() - started) * 1000
        assert ready_status == 200
        ready_payload = json.loads(ready_body)
        assert ready_payload == {
            "status": "ready",
            "engine": ENGINE["name"],
            "model": ENGINE["model"],
        }
        live_status, _, live_body = send(args.base_url, "/health/live")
        assert live_status == 200 and json.loads(live_body) == {"status": "alive"}
        fixture = (args.fixture_dir / "english.png").read_bytes()
        missing = unauthorized(
            "missing_api_key",
            send(
                args.base_url,
                "/v1/ocr",
                data=fixture,
                headers={"Content-Type": "image/png"},
            ),
        )
        invalid = unauthorized(
            "invalid_api_key",
            send(
                args.base_url,
                "/v1/ocr",
                data=fixture,
                headers={
                    "Content-Type": "image/png",
                    "X-API-Key": "invalid-test-key",
                },
            ),
        )
        ocr_with_text = [
            ocr(
                args.base_url,
                args.fixture_dir,
                key,
                "traditional.png",
                "m2-rapid-traditional",
            ),
            ocr(args.base_url, args.fixture_dir, key, "english.png", None),
        ]
        ocr_results = [result for result, _ in ocr_with_text]
        recognized_texts = [text for _, text in ocr_with_text]
    finally:
        if server is not None:
            server.terminate()
            try:
                server_log, _ = server.communicate(timeout=15)
            except subprocess.TimeoutExpired:
                server.kill()
                server_log, _ = server.communicate(timeout=15)

    if server is not None:
        assert server.returncode in (-15, 0)
        assert key not in server_log
        assert all(value not in server_log for value in recognized_texts)

    summary = {
        "network_and_security": security,
        "health": {
            "ready_status": ready_status,
            "ready_attempts": attempts,
            "ready_elapsed_ms": round(ready_ms, 3),
            "ready_body": ready_payload,
            "live_status": live_status,
            "live_body": json.loads(live_body),
        },
        "authentication": [missing, invalid],
        "ocr": ocr_results,
        "server_log": None
        if server is None
        else {
            "startup_complete_seen": "Application startup complete" in server_log,
            "model_exists_and_valid_messages": server_log.count(
                "File exists and is valid"
            ),
            "http_200_log_entries": server_log.count(" 200 OK"),
            "http_401_log_entries": server_log.count(" 401 Unauthorized"),
            "api_key_present": False,
            "recognized_ocr_text_present": False,
        },
    }
    print(json.dumps(summary, ensure_ascii=True, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
