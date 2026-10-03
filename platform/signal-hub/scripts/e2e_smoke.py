"""Exercise a real local binary, SQLite lock failures and crash recovery.

Uses only synthetic credentials/events, a temporary directory and loopback.
Install contracts/requirements.txt before running; validates every HTTP response
against the checked-in OpenAPI schemas.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import selectors
import sqlite3
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "contracts/openapi.json"
API_URI = API.as_uri()
document = json.loads(API.read_text())
registry = Registry().with_resource(
    API_URI, Resource.from_contents(document, default_specification=DRAFT202012))
for path in (ROOT / "contracts/schemas").glob("*.json"):
    schema = json.loads(path.read_text())
    resource = Resource.from_contents(schema)
    registry = registry.with_resource(path.as_uri(), resource).with_resource(schema["$id"], resource)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    args = parser.parse_args()
    binary = str(Path(args.binary).resolve())
    checks = 0
    process = None
    with tempfile.TemporaryDirectory(prefix="signalhub-m1-") as directory:
        local = Path(directory)
        tokens = {name: secrets.token_urlsafe(32) for name in ("source", "owner", "reader", "alert")}
        for name, token in tokens.items():
            path = local / (name + ".token")
            path.write_text(token)
            path.chmod(0o600)
        ref = lambda name: "file:" + str(local / (name + ".token"))
        config = {
            "sources": [
                {"name": "demo", "source_prefix": "urn:example:demo:", "allowed_types": ["demo.event.*"], "token_ref": ref("source")},
                {"name": "alert", "source_prefix": "urn:signalhub:alertmanager:", "allowed_types": ["alertmanager.alert.*"], "token_ref": ref("alert")},
            ],
            "rules": [], "subscriptions": [], "webhook_allowlist": [],
        }
        config_path = local / "config.json"
        config_path.write_text(json.dumps(config))
        db = local / "events.db"

        def start():
            child = subprocess.Popen([
                binary, "-config", str(config_path), "-db", str(db),
                "-owner-token-ref", ref("owner"), "-readonly-token-ref", ref("reader"),
                "-listen", "127.0.0.1:0",
            ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            with selectors.DefaultSelector() as selector:
                selector.register(child.stderr, selectors.EVENT_READ)
                if not selector.select(timeout=15):
                    child.kill()
                    child.wait()
                    raise AssertionError("server startup timed out")
            line = child.stderr.readline().strip()
            if not line.startswith("signalhub listening on 127.0.0.1:"):
                child.kill()
                child.wait()
                raise AssertionError("server did not start: " + line)
            return child, "http://" + line.removeprefix("signalhub listening on ")

        def call(method, path, role=None, body=None, media="application/cloudevents+json", want=200):
            nonlocal checks
            data = body.encode() if isinstance(body, str) else (json.dumps(body).encode() if body is not None else None)
            headers = {"Content-Type": media}
            if role:
                headers["Authorization"] = "Bearer " + tokens[role]
            request = urllib.request.Request(base + path, data=data, headers=headers, method=method)
            try:
                response = urllib.request.urlopen(request, timeout=15)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                status, raw = response.status, response.read()
                assert status == want, (method, path, status, raw)
                assert response.headers.get("Cache-Control") == "no-store"
            value = json.loads(raw)
            route = urllib.parse.urlsplit(path).path
            if route.startswith("/v1/events/"):
                route = "/v1/events/{seq}"
            pointer = "/paths/" + route.replace("~", "~0").replace("/", "~1")
            pointer += "/" + method.lower() + "/responses/" + str(status) + "/content/application~1json/schema"
            Draft202012Validator({"$ref": API_URI + "#" + pointer},
                                 registry=registry, format_checker=FormatChecker()).validate(value)
            assert all(token.encode() not in raw for token in tokens.values())
            checks += 1
            return value

        event = {"specversion": "1.0", "source": "urn:example:demo:service",
                 "id": "first", "type": "demo.event.created",
                 "time": "2026-10-03T12:00:00.0000000002Z",
                 "subject": "服務\u0000alpha", "summary": "synthetic smoke",
                 "correlationid": "chain", "data": {"healthy": True}}
        try:
            process, base = start()
            call("GET", "/healthz")
            call("GET", "/readyz")
            call("POST", "/v1/events", body=event, want=401)
            call("GET", "/v1/events", "source", want=403)
            call("POST", "/v1/events", "reader", event, want=403)
            first = call("POST", "/v1/events", "source", event, want=202)
            assert call("POST", "/v1/events", "source", event)["seq"] == first["seq"]
            assert call("POST", "/v1/events", "source", dict(event, originurl=None))["duplicate"]
            call("POST", "/v1/events", "source", dict(event, summary="conflict"), want=409)
            call("POST", "/v1/events", "source", dict(event, source="urn:other:demo"), want=403)
            call("POST", "/v1/events", "source", dict(event, data={"large": "x" * 16384}), want=413)
            call("POST", "/v1/events", "source", '{"id":1,"id":2}', want=400)
            call("POST", "/v1/events", "source", [], "application/cloudevents-batch+json", want=400)
            second = dict(event, id="second", time="2026-10-03T12:00:00.0000000001Z")
            batch = call("POST", "/v1/events", "source", [event, {}, second], "application/cloudevents-batch+json")
            assert [row["status"] for row in batch["results"]] == [200, 400, 202]
            page = call("GET", "/v1/events?limit=1", "reader")
            assert page["items"][0]["seq"] == first["seq"], "sub-nanosecond sort lost precision"
            cursor = urllib.parse.quote(page["next_cursor"], safe="")
            next_page = call("GET", "/v1/events?limit=1&cursor=" + cursor, "reader")
            assert next_page["items"][0]["event"]["id"] == "second" and next_page["next_cursor"] is None
            call("GET", "/v1/events?q=changed&cursor=" + cursor, "reader", want=400)
            prefix = urllib.parse.urlencode({"subject_prefix": "服務\u0000"})
            assert len(call("GET", "/v1/events?" + prefix, "reader")["items"]) == 2
            detail = call("GET", "/v1/events/" + str(first["seq"]), "reader")
            assert detail["item"]["event"] == event and len(detail["related"]) == 1
            call("GET", "/v1/events/9999", "owner", want=404)

            # An external writer holds SQLite's write lock: no false success.
            connection = sqlite3.connect(db)
            connection.execute("BEGIN IMMEDIATE")
            try:
                call("POST", "/v1/events", "source", dict(event, id="locked"), want=503)
            finally:
                connection.rollback()
                connection.close()
            call("POST", "/v1/events", "source", dict(event, id="locked"), want=202)

            alert = {"version": "4", "receiver": "demo", "status": "firing", "groupKey": "demo", "alerts": [{
                "status": "firing", "fingerprint": "abc", "startsAt": "2026-10-03T10:00:00Z",
                "endsAt": "0001-01-01T00:00:00Z", "labels": {"alertname": "Demo"},
                "annotations": {}, "generatorURL": "https://example.invalid/alert",
            }]}
            for expected in (202, 200):
                result = call("POST", "/v1/adapters/alertmanager", "alert", alert, "application/json")
                assert result["results"][0]["status"] == expected
            alert["alerts"][0].update(status="resolved", endsAt="2026-10-03T11:00:00Z")
            assert call("POST", "/v1/adapters/alertmanager", "alert", alert, "application/json")["results"][0]["status"] == 202
            # Abrupt stop proves accepted writes survive WAL recovery, rather
            # than depending on a graceful shutdown checkpoint.
            process.kill()
            process.wait(timeout=5)
            process.stderr.close()
            process, base = start()
            assert call("POST", "/v1/events", "source", event)["seq"] == first["seq"]
            assert call("GET", "/v1/events/" + str(first["seq"]), "reader")["item"]["event"] == event
            connection = sqlite3.connect(db)
            try:
                assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
                assert connection.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 5
                assert connection.execute("SELECT COUNT(*) FROM ingest_conflicts").fetchone()[0] == 1
            finally:
                connection.close()
        finally:
            if process is not None and process.poll() is None:
                process.terminate()
                process.wait(timeout=20)
            if process is not None and process.stderr:
                process.stderr.close()
    print(f"PASS: {checks} HTTP responses match OpenAPI; auth, lock retry, adapter and crash/restart persistence")


if __name__ == "__main__":
    main()
