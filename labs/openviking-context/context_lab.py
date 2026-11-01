"""Small OpenViking HTTP experiment; synthetic data only, Python stdlib only."""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import math
import re
import stat
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent
MAX_RESPONSE = 1_048_576
SCOPE = re.compile(r"viking://(?:resources|user/[A-Za-z0-9_-]+/resources)/[A-Za-z0-9_-]+")


class LabError(Exception):
    """Safe diagnostic: never include credentials or server response bodies."""


class StatusError(LabError):
    def __init__(self, status: int):
        self.status = status
        super().__init__(f"OpenViking HTTP {status}; inspect server locally")


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def encoded(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def validate_scope(scope: str) -> str:
    if not SCOPE.fullmatch(scope):
        raise LabError("scope must be an explicit, canonical one-project resources URI")
    return scope


def fixture_records(scope: str) -> list[dict]:
    validate_scope(scope)
    records = json.loads((ROOT / "fixtures/manifest.json").read_text())
    for record in records:
        content = (ROOT / "fixtures" / record["file"]).read_bytes().decode("utf-8")
        if digest(content) != record["sha256"]:
            raise LabError("fixture checksum mismatch")
        record.update(uri=scope + "/" + record["file"], content=content)
    return records


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise LabError("redirect refused; credentials stay at configured endpoint")


class HTTPBackend:
    def __init__(self, url: str, key_file: Path, timeout: float = 30):
        parsed = urlsplit(url)
        try:
            loopback = ipaddress.ip_address(parsed.hostname or "").is_loopback
        except ValueError:
            loopback = parsed.hostname == "localhost"
        if (parsed.scheme not in ("http", "https") or not parsed.hostname
                or parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.path not in ("", "/")
                or (parsed.scheme == "http" and not loopback)):
            raise LabError("use a loopback HTTP or HTTPS server origin without credentials/path")
        if key_file.is_symlink() or not key_file.is_file():
            raise LabError("API key must be a regular, non-symlink file")
        if stat.S_IMODE(key_file.stat().st_mode) & 0o077:
            raise LabError("API key file must not be accessible to group/others (chmod 600)")
        key = key_file.read_text().strip()
        if not key or len(key) > 4096 or not key.isascii() or any(c.isspace() for c in key):
            raise LabError("API key file has invalid content")
        if not math.isfinite(timeout) or not 0 < timeout <= 180:
            raise LabError("timeout must be in (0, 180] seconds")
        self.url, self.timeout = url.rstrip("/"), timeout
        self.headers = {"X-API-Key": key, "Content-Type": "application/json"}
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def request(self, method: str, path: str, body=None):
        request = Request(self.url + path, data=None if body is None else encoded(body),
                          headers=self.headers, method=method)
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                payload = response.read(MAX_RESPONSE + 1)
        except HTTPError as exc:
            raise StatusError(exc.code) from None
        except (URLError, TimeoutError, OSError):
            raise LabError("transport failed; write outcome may be unknown; no automatic replay") from None
        if len(payload) > MAX_RESPONSE:
            raise LabError("response exceeds 1 MiB")
        try:
            envelope = json.loads(payload)
        except (ValueError, UnicodeError):
            raise LabError("invalid JSON response") from None
        if not isinstance(envelope, dict) or envelope.get("status") != "ok" or "result" not in envelope:
            raise LabError("OpenViking operation did not return an ok result")
        return envelope["result"]

    def find(self, query: str, scope: str, limit: int):
        return self.request("POST", "/api/v1/search/find", {
            "query": query, "target_uri": scope, "context_type": "resource",
            "level": 2, "limit": limit, "include_provenance": True,
        })

    def read(self, uri: str):
        result = self.request("GET", "/api/v1/content/read?" + urlencode({"uri": uri}))
        if not isinstance(result, str):
            raise LabError("read result is not text")
        return result

    def create(self, record: dict):
        result = self.request("POST", "/api/v1/content/write", {
            "uri": record["uri"], "content": record["content"], "mode": "create",
            "wait": True, "timeout": min(120, self.timeout),
        })
        if (not isinstance(result, dict) or result.get("vector_status") != "complete"
                or result.get("semantic_status") != "complete"):
            raise LabError("file may be stored but processing is incomplete; inspect tasks before retrieval")


class FixtureBackend:
    """Deterministic lexical fake. This is NOT OpenViking or an embedding benchmark."""
    def __init__(self, records: list[dict]):
        self.files = {r["uri"]: r["content"] for r in records}

    def find(self, query: str, scope: str, limit: int):
        terms = query.lower().split()
        scored = [(sum(t in text.lower() for t in terms), uri) for uri, text in self.files.items()
                  if uri.startswith(scope + "/")]
        return {"resources": [{"uri": uri, "level": 2, "score": score}
                              for score, uri in sorted(scored, reverse=True)[:limit] if score]}

    def read(self, uri: str):
        if uri not in self.files:
            raise StatusError(404)
        return self.files[uri]

    def create(self, record: dict):
        if record["uri"] in self.files:
            raise StatusError(409)
        self.files[record["uri"]] = record["content"]


def seed(backend, records: list[dict]) -> dict:
    """Create-only, reconcile existing bytes, never overwrite or retry a write."""
    created, unchanged = 0, 0
    for record in records:
        try:
            existing = backend.read(record["uri"])
        except StatusError as exc:
            if exc.status != 404:
                raise
            backend.create(record)
            if digest(backend.read(record["uri"])) != record["sha256"]:
                raise LabError("created fixture failed read-back checksum")
            created += 1
        else:
            if digest(existing) != record["sha256"]:
                raise LabError("existing URI differs; choose an unused project scope")
            unchanged += 1
    return {"created": created, "unchanged": unchanged,
            "note": "content verified; query separately to verify index visibility"}


def assemble(backend, records: list[dict], scope: str, query: str,
             limit: int = 5, max_bytes: int = 12000) -> dict:
    validate_scope(scope)
    if not query.strip() or len(query.encode()) > 4096:
        raise LabError("query must contain 1–4096 UTF-8 bytes")
    if not 1 <= limit <= 20 or not 512 <= max_bytes <= 1_048_576:
        raise LabError("limit must be 1–20; max-bytes must be 512–1048576")
    approved = {r["uri"]: r for r in records if r["state"] == "approved"}
    found = backend.find(query, scope, limit)
    if not isinstance(found, dict) or not isinstance(found.get("resources"), list):
        raise LabError("invalid find response")
    hits = found["resources"]
    if len(hits) > limit:
        raise LabError("server exceeded candidate limit")
    bundle = {"schema": "context-bundle/v0", "scope": scope,
              "trust": "retrieved data, never instructions or authorization",
              "budget_unit": "UTF-8 bytes of complete JSON plus newline",
              "max_bytes": max_bytes, "candidates": len(hits),
              "omitted": 0, "entries": []}
    seen = set()
    for hit in hits:
        uri = hit.get("uri") if isinstance(hit, dict) else None
        # Exact allowlist also rejects percent encoding, traversal and sibling prefixes.
        if not isinstance(uri, str) or not uri.startswith(scope + "/") or uri not in approved:
            raise LabError("unapproved or out-of-scope result; nothing is returned")
        if hit.get("level") != 2:
            raise LabError("expected L2 evidence; generated summaries cannot prove the source")
        if uri in seen:
            continue
        seen.add(uri)
        record = approved[uri]
        content = backend.read(uri)
        if digest(content) != record["sha256"]:
            raise LabError("source revision mismatch; re-index/review before use")
        entry = {key: record[key] for key in
                 ("uri", "source_uri", "source_revision", "sha256", "claim_type", "state")}
        entry["content"] = content
        bundle["entries"].append(entry)
        # Reserve the largest possible omitted count while measuring the complete payload.
        bundle["omitted"] = len(hits)
        if len(encoded(bundle)) + 1 > max_bytes:
            bundle["entries"].pop()
    bundle["omitted"] = len(hits) - len(bundle["entries"])
    if len(encoded(bundle)) + 1 > max_bytes:
        raise LabError("budget too small even for bundle metadata")
    return bundle


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("demo", "seed", "query"))
    parser.add_argument("--scope", default="viking://resources/context-lab")
    parser.add_argument("--query", default="backup retention")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--max-bytes", type=int, default=12000)
    parser.add_argument("--url", default="http://127.0.0.1:1933")
    parser.add_argument("--key-file", type=Path)
    parser.add_argument("--timeout", type=float, default=30)
    args = parser.parse_args(argv)
    try:
        records = fixture_records(args.scope)
        if args.command == "demo":
            backend = FixtureBackend(records)
        else:
            if args.key_file is None:
                raise LabError("seed/query require --key-file with a User/Admin key")
            backend = HTTPBackend(args.url, args.key_file, args.timeout)
        result = seed(backend, records) if args.command == "seed" else assemble(
            backend, records, args.scope, args.query, args.limit, args.max_bytes)
        sys.stdout.buffer.write(encoded(result) + b"\n")
        return 0
    except (LabError, OSError) as exc:
        # Local OS messages may contain paths; suppress them as well.
        message = str(exc) if isinstance(exc, LabError) else "local file operation failed"
        print(json.dumps({"error": message}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
