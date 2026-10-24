#!/usr/bin/env python3
"""Review-only synthetic service; never uses the production OCR toolchain."""
from contextlib import asynccontextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import threading
import time

import uvicorn

from ice_maker.document_batch import run_batch
from ice_maker.document_service import create_app
from ice_maker.extraction import extract_bytes

COMPONENT = Path(__file__).resolve().parents[1]
STATE = COMPONENT / "fe-review/runs/.state"
SHORT = "A short synthetic review document."
LONG = "A long synthetic review line " + "W" * 420
STOP = threading.Event()


def synthetic_pdf(text):
    return (b"%PDF-1.4\n%ICE-MAKER-SYNTHETIC-PDF\n%%ICE-PAGE 1\n"
            b"1 0 obj << /Type /Page >> endobj\nBT (" + text.encode("ascii") +
            b") Tj ET\ntrailer << /Root 1 0 R >>\n%%EOF\n")


class Upload:
    def __init__(self, name, payload):
        self.filename = name
        self.file = io.BytesIO(payload)


def metadata(uploads):
    return json.dumps([
        {"data_class": "internal", "languages": ["chi_tra", "eng"],
         "name": item.filename, "rights": "confirmed", "size": len(item.file.getvalue())}
        for item in uploads
    ], sort_keys=True, separators=(",", ":"))


def indexed_runner(manifest_path, input_root, **kwargs):
    source = (Path(input_root) / "sources/000").read_bytes()
    if b"ICE_REVIEW_FAIL" in source:
        raise RuntimeError("synthetic runner failure")
    if b"ICE_REVIEW_HOLD" in source:
        deadline = time.monotonic() + 30
        while not STOP.is_set() and not (STATE / "release").is_file():
            if time.monotonic() >= deadline:
                raise RuntimeError("synthetic hold deadline")
            STOP.wait(0.05)
    return run_batch(
        manifest_path, input_root,
        extractor=lambda payload, _descriptor, _config: extract_bytes(payload).chunks,
        extractor_binding_sha256="b" * 64, **kwargs,
    )


def main():
    if STATE.is_symlink() or (STATE / "service").is_symlink():
        raise RuntimeError("review state symlink rejected")
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    (STATE / "fixture.pid").write_text(str(os.getpid()) + "\n")
    app = create_app(STATE / "service", host="127.0.0.1",
                     config_path=COMPONENT / "config/document-ingestion.json",
                     runner=indexed_runner)
    service = app.state.document_service
    closed = False

    def close():
        nonlocal closed
        if closed:
            return
        STOP.set()
        closed = service.close(timeout=5)
        (STATE / "shutdown.json").write_text(json.dumps({"serviceClosed": closed}) + "\n")
        if not closed:
            raise RuntimeError("review service cleanup incomplete")

    @asynccontextmanager
    async def lifespan(_app):
        try:
            yield
        finally:
            close()

    app.router.lifespan_context = lifespan
    try:
        payloads = [synthetic_pdf(SHORT), synthetic_pdf(LONG)]
        uploads = [Upload("short.pdf", payloads[0]), Upload("long.pdf", payloads[1])]
        batch_id = service.submit(uploads, metadata(uploads))
        if not service.wait_until_idle(timeout=10) or service.status(batch_id)["status"] != "completed":
            raise RuntimeError("synthetic seed failed")
        ids = {"batch_id": batch_id, "source_sha256": [hashlib.sha256(p).hexdigest() for p in payloads]}
        (STATE / "fixture.json").write_text(json.dumps(ids, sort_keys=True) + "\n")
        print(json.dumps(ids, sort_keys=True), flush=True)
        uvicorn.run(app, host="127.0.0.1", port=8765, access_log=False)
    finally:
        close()


if __name__ == "__main__":
    main()
