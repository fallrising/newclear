import asyncio
import hashlib
import http.client
import io
import json
import os
import signal
import sqlite3
import subprocess
import sys
import socket
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest import mock

from ice_maker.document_batch import canonical_json, load_config, run_batch, validate_manifest
from ice_maker.document_service import (
    DurableBatchService,
    ServiceError,
    create_app,
    main as document_service_main,
    validate_bind,
)
from ice_maker.extraction import extract_bytes


PDF = b"%PDF-1.7\nsmall deterministic fixture\n"
PNG = b"\x89PNG\r\n\x1a\nsmall deterministic fixture"


class Upload:
    def __init__(self, name, payload, *, stream=None):
        self.filename = name
        self.file = stream if stream is not None else io.BytesIO(payload)


class BadStream:
    def read(self, _size):
        raise OSError("private stream failure")


def metadata(files, **overrides):
    rows = []
    for upload, payload in files:
        row = {
            "data_class": "internal",
            "languages": ["chi_tra", "eng"],
            "name": upload.filename,
            "rights": "confirmed",
            "size": len(payload),
        }
        row.update(overrides)
        rows.append(row)
    return json.dumps(rows, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def successful_runner(manifest_path, input_root, **_kwargs):
    manifest = validate_manifest(manifest_path)
    records = []
    for item in manifest.items:
        payload = (Path(input_root) / item.path).read_bytes()
        records.append({
            "path": item.path,
            "sha256": hashlib.sha256(payload).hexdigest(),
            "status": "processed",
        })
    return {
        "counts": {
            "duplicate": 0,
            "failed": 0,
            "processed": len(records),
            "rejected": 0,
        },
        "items": records,
        "manifest_sha256": manifest.digest,
        "schema_version": "document-batch-result.v1",
    }


def indexed_runner(manifest_path, input_root, **kwargs):
    return run_batch(
        manifest_path,
        input_root,
        extractor=lambda source, _descriptor, _config: extract_bytes(source).chunks,
        extractor_binding_sha256="b" * 64,
        **kwargs,
    )


def synthetic_pdf(text="Hello"):
    return (
        b"%PDF-1.4\n%ICE-MAKER-SYNTHETIC-PDF\n%%ICE-PAGE 1\n"
        b"1 0 obj << /Type /Page >> endobj\nBT ("
        + text.encode("ascii")
        + b") Tj ET\ntrailer << /Root 1 0 R >>\n%%EOF\n"
    )


class DocumentServiceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name).resolve()
        config = json.loads(
            (Path(__file__).resolve().parents[1] / "config/document-ingestion.json").read_text()
        )
        config["limits"].update({
            "max_aggregate_bytes": 100,
            "max_file_bytes": 64,
            "max_items": 3,
            "max_workers": 2,
        })
        self.config_path = self.base / "config.json"
        self.config_path.write_bytes(canonical_json(config))
        self.services = []

    def tearDown(self):
        for service in reversed(self.services):
            service.close(timeout=1)
        self.temporary.cleanup()

    def service(self, *, root=None, runner=successful_runner, start=True):
        service = DurableBatchService(
            root or self.base / "state",
            config_path=self.config_path,
            runner=runner,
            _start_workers=start,
        )
        self.services.append(service)
        return service

    def indexed_service(self, *, root=None, start=True):
        config = json.loads(self.config_path.read_text())
        config["limits"].update({
            "max_aggregate_bytes": 4096,
            "max_file_bytes": 1024,
        })
        config_path = self.base / (
            "indexed-" + hashlib.sha256(str(root).encode()).hexdigest() + ".json"
        )
        config_path.write_bytes(canonical_json(config))
        service = DurableBatchService(
            root or self.base / "indexed-state",
            config_path=config_path,
            runner=indexed_runner,
            _start_workers=start,
        )
        self.services.append(service)
        return service

    def submit(self, service, files=None, metadata_raw=None):
        files = files or [(Upload("a.pdf", PDF), PDF)]
        return service.submit(
            [upload for upload, _ in files],
            metadata(files) if metadata_raw is None else metadata_raw,
        )

    def test_submit_is_prompt_durable_and_completed_status_is_bounded(self):
        gate = threading.Event()

        def blocked(*args, **kwargs):
            gate.wait(2)
            return successful_runner(*args, **kwargs)

        service = self.service(runner=blocked)
        started = time.monotonic()
        batch_id = self.submit(service)
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertIn(service.status(batch_id)["status"], {"queued", "running"})
        gate.set()
        self.assertTrue(service.wait_until_idle(timeout=2))
        self.assertEqual(service.status(batch_id), {
            "batch_id": batch_id,
            "counts": {"duplicate": 0, "failed": 0, "processed": 1, "rejected": 0},
            "status": "completed",
        })
        encoded = canonical_json(service.status(batch_id))
        self.assertNotIn(str(self.base).encode(), encoded)
        self.assertNotIn(PDF, encoded)

    def test_readable_results_use_real_progress_and_isolate_same_manifest_batches(self):
        service = self.indexed_service()
        alpha, beta, gamma = (
            synthetic_pdf("alpha"),
            synthetic_pdf("beta"),
            synthetic_pdf("gamma"),
        )

        def submit_pair(first, second):
            rows = [(Upload("a.pdf", first), first), (Upload("b.pdf", second), second)]
            return self.submit(service, rows)

        first_batch = submit_pair(alpha, beta)
        second_batch = submit_pair(beta, alpha)
        third_batch = self.submit(service, [(Upload("c.pdf", gamma), gamma)])
        self.assertTrue(service.wait_until_idle(timeout=5))
        alpha_hash = hashlib.sha256(alpha).hexdigest()
        beta_hash = hashlib.sha256(beta).hexdigest()
        gamma_hash = hashlib.sha256(gamma).hexdigest()

        first = service.readable_documents(first_batch)
        second = service.readable_documents(second_batch)
        self.assertEqual(first, service.readable_documents(first_batch))
        self.assertEqual(
            [item["source_sha256"] for item in first["documents"]],
            sorted((alpha_hash, beta_hash)),
        )
        self.assertEqual(
            [item["source_sha256"] for item in second["documents"]],
            sorted((alpha_hash, beta_hash)),
        )
        listing = canonical_json(first)
        for forbidden in (b"alpha", b"a.pdf", b"sources/000", str(self.base).encode()):
            self.assertNotIn(forbidden, listing)
        self.assertIn(b"alpha", service.readable_markdown(first_batch, alpha_hash))
        with self.assertRaisesRegex(ServiceError, "readable_result_not_found"):
            service.readable_markdown(first_batch, gamma_hash)
        with self.assertRaisesRegex(ServiceError, "readable_result_not_found"):
            service.readable_documents("0" * 64)
        self.assertEqual(service.readable_documents(third_batch)["documents"][0]["source_sha256"], gamma_hash)

    def test_readable_results_reject_unfinished_corrupt_and_oversized_state(self):
        queued = self.indexed_service(root=self.base / "queued-state", start=False)
        payload = synthetic_pdf("queued")
        batch_id = self.submit(queued, [(Upload("queued.pdf", payload), payload)])
        with self.assertRaisesRegex(ServiceError, "readable_result_unavailable"):
            queued.readable_documents(batch_id)

        service = self.indexed_service(root=self.base / "corrupt-state")
        payload = synthetic_pdf("corrupt")
        batch_id = self.submit(service, [(Upload("corrupt.pdf", payload), payload)])
        self.assertTrue(service.wait_until_idle(timeout=3))
        database = self.base / "corrupt-state/knowledge/batch-index.sqlite3"
        connection = sqlite3.connect(database)
        connection.execute("INSERT INTO chunks_fts(chunks_fts) VALUES('delete-all')")
        connection.commit()
        connection.close()
        with self.assertRaisesRegex(ServiceError, "readable_state_invalid"):
            service.readable_documents(batch_id)

        clean = self.indexed_service(root=self.base / "bounded-state")
        payload = synthetic_pdf("bounded")
        batch_id = self.submit(clean, [(Upload("bounded.pdf", payload), payload)])
        self.assertTrue(clean.wait_until_idle(timeout=3))
        source = hashlib.sha256(payload).hexdigest()
        with mock.patch("ice_maker.document_service.MAX_LISTING_BYTES", 1):
            with self.assertRaisesRegex(ServiceError, "readable_result_too_large"):
                clean.readable_documents(batch_id)
        with mock.patch("ice_maker.readable_results.MAX_MARKDOWN_BYTES", 32):
            with self.assertRaisesRegex(ServiceError, "readable_result_too_large"):
                clean.readable_markdown(batch_id, source)

    def test_identical_retry_is_idempotent_and_collision_is_not_replaced(self):
        service = self.service(start=False)
        batch_id = self.submit(service)
        self.assertEqual(batch_id, self.submit(service))
        manifest = self.base / "state/batches" / batch_id / "manifest.json"
        manifest.write_text("{}\n")
        with self.assertRaisesRegex(ServiceError, "batch_conflict"):
            self.submit(service)
        self.assertEqual(manifest.read_text(), "{}\n")

    def test_requires_explicit_exact_metadata_and_actual_sizes(self):
        service = self.service(start=False)
        files = [(Upload("a.pdf", PDF), PDF)]
        invalid = (
            None,
            "{}",
            json.dumps([{"name": "a.pdf"}]),
            metadata(files, rights="invented"),
            metadata(files, data_class="secret"),
            metadata(files, languages=[]),
            metadata(files, size=len(PDF) + 1),
        )
        for raw in invalid:
            with self.subTest(raw=raw), self.assertRaises(ServiceError):
                service.submit([Upload("a.pdf", PDF)], raw)
        self.assertCountEqual(
            os.listdir(self.base / "state"), ["batches", ".service.lock"]
        )

    def test_count_name_signature_stream_and_copy_limits_fail_atomically(self):
        service = self.service(start=False)
        with self.assertRaises(ServiceError):
            service.submit([], "[]")
        four = [(Upload(f"{index}.pdf", PDF), PDF) for index in range(4)]
        with self.assertRaises(ServiceError):
            self.submit(service, four)
        for name in ("../x.pdf", "/x.pdf", "x\n.pdf", "ｅ.pdf", " " * 129):
            files = [(Upload(name, PDF), PDF)]
            with self.subTest(name=name), self.assertRaises(ServiceError):
                self.submit(service, files)
        duplicate = [(Upload("A.pdf", PDF), PDF), (Upload("a.PDF", PNG), PNG)]
        with self.assertRaises(ServiceError):
            self.submit(service, duplicate)
        unsupported = [(Upload("a.bin", b"not a document"), b"not a document")]
        with self.assertRaises(ServiceError):
            self.submit(service, unsupported)
        bad = Upload("a.pdf", b"", stream=BadStream())
        with self.assertRaises(ServiceError):
            service.submit([bad], metadata([(bad, PDF)]))
        too_large = b"%PDF-" + b"x" * 64
        with self.assertRaises(ServiceError):
            self.submit(service, [(Upload("large.pdf", too_large), too_large)])
        aggregate = [
            (Upload("one.pdf", b"%PDF-" + b"1" * 50), b"%PDF-" + b"1" * 50),
            (Upload("two.pdf", b"%PDF-" + b"2" * 50), b"%PDF-" + b"2" * 50),
        ]
        with self.assertRaises(ServiceError):
            self.submit(service, aggregate)
        self.assertFalse(any(path.name.startswith(".upload-") for path in (self.base / "state").iterdir()))

    def test_restart_recovers_queued_and_abandoned_running_attempts(self):
        service = self.service(start=False)
        batch_id = self.submit(service)
        service.close()
        recovered = self.service()
        self.assertTrue(recovered.wait_until_idle(timeout=2))
        self.assertEqual(recovered.status(batch_id)["status"], "completed")

        second_root = self.base / "second-state"
        staged = self.service(root=second_root, start=False)
        second_id = self.submit(staged)
        attempt = second_root / "batches" / second_id / "attempts/000000"
        (attempt / "running.json").write_bytes(canonical_json({
            "attempt": 0, "batch_id": second_id, "status": "running",
        }))
        staged.close()
        restarted = self.service(root=second_root)
        self.assertTrue(restarted.wait_until_idle(timeout=2))
        self.assertEqual(restarted.status(second_id)["status"], "completed")
        self.assertTrue((second_root / "batches" / second_id / "attempts/000001/queued.json").is_file())

    def test_completed_restart_does_not_run_again(self):
        calls = []

        def runner(*args, **kwargs):
            calls.append(1)
            return successful_runner(*args, **kwargs)

        service = self.service(runner=runner)
        batch_id = self.submit(service)
        self.assertTrue(service.wait_until_idle(timeout=2))
        service.close()
        restarted = self.service(runner=runner)
        self.assertTrue(restarted.wait_until_idle(timeout=1))
        self.assertEqual(restarted.status(batch_id)["status"], "completed")
        self.assertEqual(calls, [1])

    def test_two_worker_limit_is_shared_across_concurrent_batches(self):
        release = threading.Event()
        lock = threading.Lock()
        active = maximum = 0

        def runner(*args, **kwargs):
            nonlocal active, maximum
            with lock:
                active += 1
                maximum = max(maximum, active)
            release.wait(2)
            result = successful_runner(*args, **kwargs)
            with lock:
                active -= 1
            return result

        service = self.service(runner=runner)
        identifiers = []
        for index in range(3):
            payload = PDF + bytes([index])
            identifiers.append(self.submit(
                service, [(Upload(f"{index}.pdf", payload), payload)],
            ))
        deadline = time.monotonic() + 1
        while maximum < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(maximum, 2)
        self.assertEqual(sum(service.status(item)["status"] == "queued" for item in identifiers), 1)
        release.set()
        self.assertTrue(service.wait_until_idle(timeout=2))
        self.assertLessEqual(maximum, 2)

    def test_failed_runner_is_durable_safe_and_does_not_block_other_batch(self):
        def runner(manifest_path, input_root, **kwargs):
            if (Path(input_root) / "sources/000").read_bytes().endswith(b"bad"):
                raise RuntimeError("private /tmp/path token: hidden")
            return successful_runner(manifest_path, input_root, **kwargs)

        service = self.service(runner=runner)
        bad_payload = PDF + b"bad"
        bad = self.submit(service, [(Upload("bad.pdf", bad_payload), bad_payload)])
        good_payload = PDF + b"good"
        good = self.submit(service, [(Upload("good.pdf", good_payload), good_payload)])
        self.assertTrue(service.wait_until_idle(timeout=2))
        self.assertEqual(service.status(bad), {
            "batch_id": bad,
            "counts": {"duplicate": 0, "failed": 0, "processed": 0, "rejected": 0},
            "reason": "processing_failed",
            "status": "failed",
        })
        self.assertEqual(service.status(good)["status"], "completed")

    def test_unknown_tampered_partial_and_symlinked_state_fail_closed(self):
        service = self.service(start=False)
        with self.assertRaisesRegex(ServiceError, "batch_not_found"):
            service.status("0" * 64)
        batch_id = self.submit(service)
        batch = self.base / "state/batches" / batch_id
        (batch / "upload.json").write_text("{}\n")
        with self.assertRaisesRegex(ServiceError, "state_invalid"):
            service.status(batch_id)
        second_root = self.base / "partial-state"
        second = self.service(root=second_root, start=False)
        second_id = self.submit(second)
        attempts = second_root / "batches" / second_id / "attempts"
        attempts.rename(attempts.with_name("attempts-real"))
        attempts.symlink_to(attempts.with_name("attempts-real"), target_is_directory=True)
        with self.assertRaisesRegex(ServiceError, "state_invalid"):
            second.status(second_id)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            target = root / "target"
            target.mkdir()
            linked = root / "linked"
            linked.symlink_to(target, target_is_directory=True)
            with self.assertRaises(ServiceError):
                DurableBatchService(linked, config_path=self.config_path, _start_workers=False)

    def test_cleanup_preserves_unrelated_state_and_path_swap_fails(self):
        root = self.base / "state"
        service = self.service(root=root, start=False)
        (root / "sentinel").write_text("keep")
        bad = Upload("a.pdf", b"", stream=BadStream())
        with self.assertRaises(ServiceError):
            service.submit([bad], metadata([(bad, PDF)]))
        self.assertEqual((root / "sentinel").read_text(), "keep")
        service.close()
        moved = self.base / "moved"
        root.rename(moved)
        root.mkdir()
        with self.assertRaises(ServiceError):
            service.status("0" * 64)

    def test_bind_rejected_before_state_mutation(self):
        for host in ("0.0.0.0", "::", "localhost", "127.0.0.2", ""):
            root = self.base / ("bad-" + hashlib.sha256(host.encode()).hexdigest())
            with self.subTest(host=host), self.assertRaises(ServiceError):
                create_app(root, host=host, config_path=self.config_path)
            self.assertFalse(root.exists())
        self.assertEqual(validate_bind("127.0.0.1"), "127.0.0.1")
        self.assertEqual(validate_bind("::1"), "::1")

    def test_module_has_no_provider_shell_git_or_network_client_capability(self):
        source = (Path(__file__).resolve().parents[1] / "src/ice_maker/document_service.py").read_text()
        for forbidden in ("subprocess", "requests", "urllib", "github", "git ", "socket"):
            self.assertNotIn(forbidden, source.lower())

    def test_container_cli_uses_only_fixed_unix_socket(self):
        fake_uvicorn = types.SimpleNamespace(run=mock.Mock())
        arguments = [
            "--state-root", "/data/state", "--config", "/opt/config.json",
            "--uds", "/data/.document-service-runtime/service.sock",
            "--pdfinfo", "/usr/bin/pdfinfo", "--pdftotext", "/usr/bin/pdftotext",
            "--pdftoppm", "/usr/bin/pdftoppm", "--tesseract", "/usr/bin/tesseract",
            "--poppler-version", "25.03.0", "--tesseract-version", "5.5.0",
            "--installed-language", "chi_tra", "--installed-language", "eng",
        ]
        with mock.patch("ice_maker.document_service.create_app", return_value="app") as factory:
            with mock.patch.dict(sys.modules, {"uvicorn": fake_uvicorn}):
                self.assertEqual(document_service_main(arguments), 0)
        factory.assert_called_once()
        fake_uvicorn.run.assert_called_once_with(
            "app", uds="/data/.document-service-runtime/service.sock", access_log=False,
        )
        for invalid in ("relative.sock", "/tmp/service.sock", "/data/other.sock"):
            bad = list(arguments)
            bad[bad.index("/data/.document-service-runtime/service.sock")] = invalid
            with mock.patch("ice_maker.document_service.create_app", return_value="app"):
                with mock.patch.dict(sys.modules, {"uvicorn": fake_uvicorn}):
                    self.assertEqual(document_service_main(bad), 2)


def asgi_exchange(app, method, path, body=b"", headers=()):
    sent = []
    delivered = False

    async def receive():
        nonlocal delivered
        if delivered:
            return {"type": "http.disconnect"}
        delivered = True
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": method, "scheme": "http", "path": path,
        "raw_path": path.encode(), "query_string": b"", "headers": list(headers),
        "client": ("127.0.0.1", 12345), "server": ("127.0.0.1", 8000),
        "root_path": "",
    }
    asyncio.run(app(scope, receive, send))
    status = next(item["status"] for item in sent if item["type"] == "http.response.start")
    response = b"".join(item.get("body", b"") for item in sent if item["type"] == "http.response.body")
    response_headers = dict(
        next(item["headers"] for item in sent if item["type"] == "http.response.start")
    )
    return status, response, response_headers


def asgi_request(app, method, path, body=b"", headers=()):
    status, response, _response_headers = asgi_exchange(
        app, method, path, body, headers
    )
    return status, response


@unittest.skipUnless(
    __import__("importlib").util.find_spec("fastapi")
    and __import__("importlib").util.find_spec("multipart"),
    "service extras are tested in the pinned container runtime",
)
class DocumentServiceHttpTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.config = Path(__file__).resolve().parents[1] / "config/document-ingestion.json"
        self.app = create_app(
            self.root / "state", config_path=self.config,
            runner=successful_runner, _start_workers=False,
        )

    def tearDown(self):
        self.app.state.document_service.close(timeout=1)
        self.temporary.cleanup()

    def test_health_browser_page_multipart_202_and_status(self):
        status, body = asgi_request(self.app, "GET", "/healthz")
        self.assertEqual((status, json.loads(body)), (200, {"status": "ok"}))
        status, body = asgi_request(self.app, "GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b'method="post"', body)
        self.assertIn(b'name="files"', body)
        self.assertIn(b"rights", body)
        boundary = "ice-maker-boundary"
        rows = [(Upload("a.pdf", PDF), PDF), (Upload("b.png", PNG), PNG)]
        fields = []
        for upload, payload in rows:
            fields.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{upload.filename}\"\r\n"
                "Content-Type: application/octet-stream\r\n\r\n".encode() + payload + b"\r\n"
            )
        fields.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n"
            .encode() + metadata(rows).encode() + b"\r\n"
        )
        fields.append(f"--{boundary}--\r\n".encode())
        request = b"".join(fields)
        status, body = asgi_request(self.app, "POST", "/api/batches", request, (
            (b"content-type", f"multipart/form-data; boundary={boundary}".encode()),
            (b"content-length", str(len(request)).encode()),
        ))
        self.assertEqual(status, 202)
        batch_id = json.loads(body)["batch_id"]
        status, body = asgi_request(self.app, "GET", "/api/batches/" + batch_id)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["status"], "queued")
        status, body = asgi_request(self.app, "GET", "/api/batches/" + "0" * 64)
        self.assertEqual((status, json.loads(body)), (404, {"detail": "batch_not_found"}))

    def test_readable_http_routes_return_stable_safe_responses(self):
        queued = Upload("queued.pdf", synthetic_pdf("queued"))
        queued_id = self.app.state.document_service.submit(
            [queued], metadata([(queued, queued.file.getvalue())])
        )
        status, body = asgi_request(
            self.app, "GET", f"/api/batches/{queued_id}/documents"
        )
        self.assertEqual(
            (status, json.loads(body)),
            (409, {"detail": "readable_result_unavailable"}),
        )
        status, body = asgi_request(
            self.app, "GET", "/api/batches/" + "0" * 64 + "/documents"
        )
        self.assertEqual(
            (status, json.loads(body)),
            (404, {"detail": "readable_result_not_found"}),
        )

        indexed = create_app(
            self.root / "indexed-state",
            config_path=self.config,
            runner=indexed_runner,
        )
        try:
            text = '<img src=x onerror=alert> [x] `z`'
            payload = synthetic_pdf(text)
            upload = Upload("hostile.pdf", payload)
            batch_id = indexed.state.document_service.submit(
                [upload], metadata([(upload, payload)])
            )
            self.assertTrue(indexed.state.document_service.wait_until_idle(3))
            source = hashlib.sha256(payload).hexdigest()

            status, listing = asgi_request(
                indexed, "GET", f"/api/batches/{batch_id}/documents"
            )
            self.assertEqual(status, 200)
            self.assertNotIn(text.encode(), listing)
            status, markdown, headers = asgi_exchange(
                indexed,
                "GET",
                f"/api/batches/{batch_id}/documents/{source}/markdown",
            )
            self.assertEqual(status, 200)
            self.assertTrue(headers[b"content-type"].startswith(b"text/markdown"))
            self.assertEqual(
                headers[b"content-disposition"],
                f'attachment; filename="document-{source}.md"'.encode(),
            )
            self.assertIn(("    " + text).encode(), markdown)
            status, page = asgi_request(
                indexed,
                "GET",
                f"/batches/{batch_id}/documents/{source}",
            )
            self.assertEqual(status, 200)
            self.assertNotIn(b"<img src=x", page)
            self.assertIn(b"&lt;img src=x onerror=alert&gt;", page)

            with mock.patch("ice_maker.document_service.MAX_LISTING_BYTES", 1):
                status, body = asgi_request(
                    indexed, "GET", f"/api/batches/{batch_id}/documents"
                )
            self.assertEqual(
                (status, json.loads(body)),
                (413, {"detail": "readable_result_too_large"}),
            )
        finally:
            indexed.state.document_service.close(timeout=1)


class DocumentServiceContainerPolicyTests(unittest.TestCase):
    def setUp(self):
        self.project = Path(__file__).resolve().parents[1]
        self.build_script = self.project / "scripts/build-document-service.sh"
        self.run_script = self.project / "scripts/run-document-service.sh"
        self.proxy_script = self.project / "scripts/loopback-uds-proxy.py"

    def test_dockerfile_pins_complete_offline_runtime_contract(self):
        source = (self.project / "docker/document-service.Dockerfile").read_text()
        self.assertIn(
            "FROM python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93",
            source,
        )
        self.assertIn("https://snapshot.debian.org/archive/debian/20260713T000000Z", source)
        for package in (
            "poppler-utils=25.03.0-5+deb13u4",
            "tesseract-ocr=5.5.0-1+b1",
            "tesseract-ocr-eng=1:4.1.0-2",
            "tesseract-ocr-chi-tra=1:4.1.0-2",
        ):
            self.assertIn(package, source)
        for package in (
            "annotated-doc==0.0.5", "annotated-types==0.8.0", "anyio==4.15.0",
            "click==8.5.0", "fastapi==0.141.1", "h11==0.16.0", "idna==3.19",
            "packaging==26.2", "Pillow==12.3.0", "pydantic==2.13.5",
            "pydantic_core==2.46.5", "python-multipart==0.0.32", "starlette==1.6.0",
            "typing-inspection==0.4.4", "typing_extensions==4.16.0", "uvicorn==0.52.4",
        ):
            self.assertIn(package, source)
        self.assertIn("COPY config/document-ingestion.json", source)
        self.assertIn("COPY knowledge/90-meta/taxonomy.yaml", source)
        self.assertIn("COPY scripts/loopback-uds-proxy.py", source)
        self.assertIn("USER 65532:65532", source)
        self.assertIn("-type d -exec chmod 0555", source)
        self.assertIn("-type f -exec chmod 0444", source)
        self.assertIn("HEALTHCHECK", source)
        self.assertIn("socket.AF_UNIX", source)
        self.assertIn("HTTP/1.1\\\\r\\\\nHost: localhost", source)
        self.assertIn("/data/.document-service-runtime/service.sock", source)
        self.assertNotIn("ARG ", source)
        self.assertNotIn("VOLUME", source)

    def test_scripts_enforce_sanitized_build_and_constrained_runtime(self):
        build = self.build_script.read_text()
        run = self.run_script.read_text()
        for script in (self.build_script, self.run_script, self.proxy_script):
            self.assertTrue(script.stat().st_mode & 0o111, script)
        for required in (
            "set -Eeuo pipefail", "mktemp -d /tmp/ice-maker-build.XXXXXXXX",
            "src/ice_maker", "knowledge/90-meta/taxonomy.yaml", "sha256sum", "--pull=false",
            "org.opencontainers.image.revision",
        ):
            self.assertIn(required, build)
        self.assertNotIn("docker build .", build)
        for required in (
            "--network none", "loopback-uds-proxy.py", "--cap-drop=ALL",
            "--security-opt=no-new-privileges:true", "--read-only", "--tmpfs",
            "--cpus=2", "--memory=8g", "--memory-swap=8g", "--pids-limit=256",
            "--init", "--restart=no", "--pull=never", '--user "$run_uid:$run_gid"',
        ):
            self.assertIn(required, run)
        for required in (
            "--network host", "--no-healthcheck", "--cpus=0.25", "--memory=128m",
            "--memory-swap=128m", "--pids-limit=64", "ice-maker-document-relay",
            "dst=/run/ice-maker",
        ):
            self.assertIn(required, run)
        self.assertEqual(run.count("--mount "), 2)
        self.assertNotIn("--publish", run)
        self.assertNotIn("docker network", run)
        for forbidden in ("eval ", "/var/run/docker.sock", ".ssh", ".git", "curl ", "wget "):
            self.assertNotIn(forbidden, run)

    def test_missing_docker_and_unsafe_inputs_fail_before_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            empty_path = root / "empty"
            empty_path.mkdir()
            missing = subprocess.run(
                ["/bin/bash", str(self.build_script)],
                env={"HOME": str(root), "PATH": str(empty_path)},
                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
            self.assertEqual(missing.returncode, 69)
            self.assertIn("Docker CLI is required", missing.stderr)

            data = root / "data"
            data.mkdir()
            linked = root / "linked"
            linked.symlink_to(data, target_is_directory=True)
            cases = (("/", "8080"), ("relative", "8080"), (str(linked), "8080"),
                     (str(data), "80"), (str(data), "65536"), (str(data), "8x80"))
            for path, port in cases:
                with self.subTest(path=path, port=port):
                    result = subprocess.run(
                        ["/bin/bash", str(self.run_script), path, port],
                        env={"HOME": str(root), "PATH": "/usr/bin:/bin"},
                        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    )
                    self.assertEqual(result.returncode, 64)

    def _fake_runtime(self, root):
        fake_bin = root / "bin"
        fake_bin.mkdir()
        fake_log = root / "docker.log"
        fake_state = root / "container.exists"
        docker = fake_bin / "docker"
        docker.write_text(
            """#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
last=
for argument in "$@"; do last=$argument; done
case "$1" in
  info) printf '%s\\n' '["name=apparmor","name=seccomp,profile=builtin"]|2' ;;
  image) printf '%s\\n' "$FAKE_IMAGE|$FAKE_SOURCE|65532:65532" ;;
  network) exit 2 ;;
  inspect)
    if [ "$2" != "--format" ]; then
      if [ "$last" = "ice-maker-document-relay" ]; then
        [ -f "$FAKE_RELAY_STATE" ]
      else
        [ -f "$FAKE_CONTAINER_STATE" ]
      fi
    else
      case "$3" in
        '{{.State.Status}}') printf '%s\\n' 'running' ;;
        *State.Status*)
          if [ "$last" = "ice-maker-document-relay" ]; then
            printf '%s\\n' "running|$FAKE_IMAGE|$FAKE_SOURCE|$FAKE_DATA|$FAKE_PORT|$FAKE_RUNTIME"
          else
            printf '%s\\n' "running|healthy|$FAKE_IMAGE|$FAKE_SOURCE|$FAKE_DATA|$FAKE_PORT|$FAKE_RUNTIME"
          fi ;;
        *Mounts*)
          if [ "$last" = "ice-maker-document-relay" ]; then
            printf '%s\\n' "bind|$FAKE_RUNTIME_DIR|/run/ice-maker|true"
          else
            printf '%s\\n' "bind|$FAKE_DATA_DIR|/data|true"
          fi ;;
        *NanoCpus*)
          if [ "$last" = "ice-maker-document-relay" ]; then
            printf '%s\\n' 'true|250000000|134217728|134217728|64|host|{}|["ALL"]|["no-new-privileges:true"]'
          else
            printf '%s\\n' 'true|2000000000|8589934592|8589934592|256|none|{}'
          fi ;;
        *State.Health*) printf '%s\\n' 'healthy' ;;
        *) exit 2 ;;
      esac
    fi ;;
  run)
    case "$*" in
      *'--name ice-maker-document-relay'*)
        "$FAKE_REAL_PYTHON" "$FAKE_PROXY_SCRIPT" --listen 127.0.0.1 --port "$FAKE_PORT" --unix-socket "$FAKE_UNIX_SOCKET" --pid-file "$FAKE_PROXY_PID" </dev/null >/dev/null 2>&1 &
        : > "$FAKE_RELAY_STATE"; printf '%064d\\n' 1 ;;
      *)
        "$FAKE_REAL_PYTHON" "$FAKE_BACKEND_SCRIPT" "$FAKE_UNIX_SOCKET" "$FAKE_BACKEND_PID" </dev/null >/dev/null 2>&1 &
        count=0
        while [ ! -S "$FAKE_UNIX_SOCKET" ] && [ "$count" -lt 50 ]; do /bin/sleep 0.02; count=$((count + 1)); done
        : > "$FAKE_CONTAINER_STATE"; printf '%064d\\n' 0 ;;
    esac ;;
  *) exit 2 ;;
esac
"""
        )
        docker.chmod(0o755)
        fake_id = fake_bin / "id"
        fake_id.write_text(
            "#!/bin/sh\n"
            f"case \"$1\" in -u) echo {os.getuid()} ;; -g) echo {os.getgid()} ;; "
            "*) exit 2 ;; esac\n"
        )
        fake_id.chmod(0o755)
        return fake_bin, fake_log, fake_state

    def test_exact_runtime_argv_is_idempotent_and_conflicts_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            capability = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                capability.bind(str(root / "capability.sock"))
            except PermissionError:
                capability.close()
                self.skipTest("sandbox forbids filesystem Unix sockets")
            capability.close()
            (root / "capability.sock").unlink()
            data = root / "data"
            data.mkdir()
            fake_bin, fake_log, fake_state = self._fake_runtime(root)
            fake_relay_state = root / "relay.exists"
            backend_script = root / "backend.py"
            backend_pid = root / "backend.pid"
            backend_script.write_text(
                "import os,signal,socket,sys\n"
                "path=sys.argv[1]; open(sys.argv[2],'w').write(str(os.getpid()))\n"
                "server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM); server.bind(path); server.listen(8)\n"
                "stop=False\n"
                "def done(*_):\n global stop; stop=True; server.close()\n"
                "signal.signal(signal.SIGTERM,done)\n"
                "while not stop:\n"
                " try:\n  client,_=server.accept()\n"
                " except OSError:\n  break\n"
                " with client:\n"
                "  request=b''\n"
                "  while b'\\r\\n\\r\\n' not in request:\n"
                "   chunk=client.recv(4096)\n"
                "   if not chunk: break\n"
                "   request+=chunk\n"
                "  client.sendall(b'HTTP/1.1 200 OK\\r\\nContent-Length: 15\\r\\nConnection: close\\r\\n\\r\\n{\"status\":\"ok\"}')\n"
            )
            image = "sha256:" + "1" * 64
            source = "2" * 64
            data_digest = hashlib.sha256(str(data).encode()).hexdigest()
            runtime = hashlib.sha256(
                (
                    "cpu=2;memory=8g;swap=8g;pids=256;readonly=true;capdrop=ALL;nnp=true;network=none;"
                    + "proxy=" + hashlib.sha256(self.proxy_script.read_bytes()).hexdigest()
                    + ";run=" + hashlib.sha256(self.run_script.read_bytes()).hexdigest()
                ).encode()
            ).hexdigest()
            port_probe = socket.socket()
            port_probe.bind(("127.0.0.1", 0))
            port = str(port_probe.getsockname()[1])
            port_probe.close()
            env = {
                "HOME": str(root / "operator-home"),
                "PATH": str(fake_bin) + ":/usr/bin:/bin",
                "FAKE_DOCKER_LOG": str(fake_log), "FAKE_CONTAINER_STATE": str(fake_state),
                "FAKE_IMAGE": image, "FAKE_SOURCE": source, "FAKE_DATA": data_digest,
                "FAKE_PORT": port, "FAKE_RUNTIME": runtime, "FAKE_DATA_DIR": str(data),
                "FAKE_RELAY_STATE": str(fake_relay_state),
                "FAKE_RUNTIME_DIR": str(data / ".document-service-runtime"),
                "FAKE_REAL_PYTHON": sys.executable, "FAKE_BACKEND_SCRIPT": str(backend_script),
                "FAKE_UNIX_SOCKET": str(data / ".document-service-runtime/service.sock"),
                "FAKE_BACKEND_PID": str(backend_pid),
                "FAKE_PROXY_SCRIPT": str(self.proxy_script),
                "FAKE_PROXY_PID": str(data / ".document-service-runtime/proxy.pid"),
            }
            proxy_pid = None
            backend_process_pid = None
            try:
                first = subprocess.run(
                    ["/bin/bash", str(self.run_script), str(data), port], env=env,
                    text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                )
                self.assertEqual(first.returncode, 0, first.stderr)
                second = subprocess.run(
                    ["/bin/bash", str(self.run_script), str(data), port], env=env,
                    text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                )
                self.assertEqual(second.returncode, 0, second.stderr)
                self.assertIn("reusing healthy parser and relay", second.stdout)
                calls = fake_log.read_text().splitlines()
                run_calls = [line for line in calls if line.startswith("run ")]
                self.assertEqual(len(run_calls), 2)
                call = next(line for line in run_calls if "--network none" in line)
                relay_call = next(line for line in run_calls if "--network host" in line)
                for argument in (
                    "--network none", "--cap-drop=ALL", "--security-opt=no-new-privileges:true",
                    "--read-only", "--cpus=2", "--memory=8g", "--memory-swap=8g",
                    "--pids-limit=256", "--pull=never",
                    f"--user {os.getuid()}:{os.getgid()}",
                    "dst=/data", image,
                ):
                    self.assertIn(argument, call)
                self.assertNotIn("--publish", call)
                for argument in (
                    "--network host", "--no-healthcheck", "--cpus=0.25", "--memory=128m",
                    "--memory-swap=128m", "--pids-limit=64", "dst=/run/ice-maker",
                    "/opt/ice-maker/scripts/loopback-uds-proxy.py", "--listen 127.0.0.1",
                ):
                    self.assertIn(argument, relay_call)
                self.assertNotIn("dst=/data", relay_call)

                proxy_pid = int((data / ".document-service-runtime/proxy.pid").read_text())
                backend_process_pid = int(backend_pid.read_text())
                fake_state.write_text("occupied")
                env["FAKE_DATA"] = "3" * 64
                conflict = subprocess.run(
                    ["/bin/bash", str(self.run_script), str(data), port], env=env,
                    text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                )
                self.assertEqual(conflict.returncode, 73)
                self.assertIn("occupied", conflict.stderr)
                self.assertEqual(len([line for line in fake_log.read_text().splitlines() if line.startswith("run ")]), 2)
            finally:
                for process_id in (proxy_pid, backend_process_pid):
                    if process_id is not None:
                        try:
                            os.kill(process_id, signal.SIGTERM)
                        except ProcessLookupError:
                            pass

    def test_loopback_proxy_relays_only_to_a_unix_socket_and_locks_pid(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            unix_path = root / "service.sock"
            backend = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                backend.bind(str(unix_path))
            except PermissionError:
                backend.close()
                self.skipTest("sandbox forbids filesystem Unix sockets")
            backend.listen(1)

            def serve_once():
                connection, _ = backend.accept()
                with connection:
                    request = b""
                    while b"\r\n\r\n" not in request:
                        request += connection.recv(4096)
                    connection.sendall(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 15\r\nConnection: close\r\n\r\n{\"status\":\"ok\"}"
                    )

            thread = threading.Thread(target=serve_once, daemon=True)
            thread.start()
            probe = socket.socket()
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
            probe.close()
            pid_file = root / "proxy.pid"
            process = subprocess.Popen(
                [sys.executable, str(self.proxy_script), "--listen", "127.0.0.1",
                 "--port", str(port), "--unix-socket", str(unix_path),
                 "--pid-file", str(pid_file)],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            try:
                deadline = time.monotonic() + 3
                while not pid_file.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertIsNone(process.poll())
                client = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
                client.request("GET", "/healthz")
                response = client.getresponse()
                self.assertEqual((response.status, response.read()), (200, b'{"status":"ok"}'))
                client.close()
                self.assertEqual(pid_file.read_text(), str(process.pid) + "\n")
            finally:
                process.terminate()
                process.wait(timeout=3)
                backend.close()
                thread.join(timeout=1)
            self.assertFalse(pid_file.exists())

    def test_loopback_proxy_rejects_remote_bind_and_linked_pid(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            unix_path = root / "service.sock"
            backend = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                backend.bind(str(unix_path))
            except PermissionError:
                backend.close()
                self.skipTest("sandbox forbids filesystem Unix sockets")
            backend.listen(1)
            sentinel = root / "sentinel"
            sentinel.write_text("keep")
            linked = root / "proxy.pid"
            linked.symlink_to(sentinel)
            base = [sys.executable, str(self.proxy_script), "--port", "18080",
                    "--unix-socket", str(unix_path), "--pid-file", str(linked)]
            try:
                remote = subprocess.run(
                    [*base, "--listen", "0.0.0.0"], text=True,
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                )
                self.assertEqual(remote.returncode, 64)
                linked_pid = subprocess.run(
                    [*base, "--listen", "127.0.0.1"], text=True,
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                )
                self.assertEqual(linked_pid.returncode, 73)
                self.assertEqual(sentinel.read_text(), "keep")
            finally:
                backend.close()

        source = self.proxy_script.read_text()
        for forbidden in ("subprocess", "urllib", "requests", "github", "AF_INET6", "0.0.0.0"):
            self.assertNotIn(forbidden, source)
        self.assertIn("socket.AF_UNIX", source)
        self.assertIn('(\"127.0.0.1\", args.port)', source)


if __name__ == "__main__":
    unittest.main()
