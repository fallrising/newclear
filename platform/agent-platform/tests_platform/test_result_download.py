"""Authenticated attachment boundaries against persisted PostgreSQL results."""

import hashlib
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb
from test_control_plane import PlatformFixture

from agent_platform.api import create_app
from agent_platform.domain import Problem
from agent_platform.result_download import diff_bytes


class ResultDownloadValidationTests(unittest.TestCase):
    def test_invalid_utf8_is_rejected_without_replacement(self):
        with self.assertRaises(Problem) as caught:
            diff_bytes({"result": {"diff": "\ud800"}, "base_sha": "a" * 40})
        self.assertEqual(caught.exception.status, 409)

    def test_multibyte_utf8_limit_is_enforced(self):
        patch = "🐈" * 65537
        with self.assertRaises(Problem) as caught:
            diff_bytes({"result": {"diff": patch}, "base_sha": "a" * 40})
        self.assertEqual(caught.exception.status, 409)


class ResultDownloadTests(PlatformFixture):
    def setUp(self):
        super().setUp()
        self.run_id = self.create()["run"]["id"]
        self.path = f"/api/v1/runs/{self.run_id}/result.diff"

    def result(self, diff="+hello\n", **changes):
        patch = diff.encode("utf-8") if isinstance(diff, str) else b""
        return {
            "diff": diff,
            "diff_bytes": len(patch),
            "diff_sha256": hashlib.sha256(patch).hexdigest(),
            "base_sha": self.payload["base_sha"],
            "verification": {"status": "unknown"},
            **changes,
        }

    def persist(self, result):
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET result=%s WHERE id=%s", (Jsonb(result), self.run_id))

    def test_exact_bytes_and_safe_attachment_headers(self):
        for diff in ("", "+hello\n", "+你好🐈\r\n", "<script>alert(1)</script>\n", "x" * 262144):
            with self.subTest(diff=diff[:32]):
                self.persist(self.result(diff, filename="evil.html", content_type="text/html"))
                response = self.client.get(self.path)
                self.assertEqual(response.status_code, 200, response.text[:200])
                self.assertEqual(response.content, diff.encode("utf-8"))
                self.assertEqual(response.headers["content-type"], "text/plain; charset=utf-8")
                self.assertEqual(
                    response.headers["content-disposition"],
                    f'attachment; filename="run-{self.run_id}.diff"',
                )
                self.assertEqual(response.headers["x-content-type-options"], "nosniff")
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertEqual(
                    response.headers["content-security-policy"], "sandbox; default-src 'none'"
                )
        regular = self.client.get(f"/api/v1/runs/{self.run_id}")
        self.assertIn("script-src 'self'", regular.headers["content-security-policy"])

    def test_session_required_including_expired_session(self):
        self.persist(self.result())
        outsider = TestClient(create_app(self.settings, self.db), base_url=self.settings.origin)
        self.addCleanup(outsider.close)
        self.assertEqual(outsider.get(self.path).status_code, 401)
        with self.db.transaction() as conn:
            conn.execute("UPDATE sessions SET expires_at=now()-interval '1 second'")
        self.assertEqual(self.client.get(self.path).status_code, 401)

    def test_missing_run_result_or_diff(self):
        self.assertEqual(self.client.get(f"/api/v1/runs/{uuid4()}/result.diff").status_code, 404)
        for result in (None, {}, {"summary": "no diff"}):
            with self.subTest(result=result):
                self.persist(result)
                self.assertEqual(self.client.get(self.path).status_code, 404)

    def test_corrupt_metadata_is_rejected(self):
        cases = [
            [],
            "diff",
            1,
            True,
            *[self.result(diff=value) for value in (None, [], 1, True)],
        ]
        for field, values in {
            "diff_bytes": [None, True, False, "7", 7.0, -1, 999999],
            "diff_sha256": [None, True, [], "A" * 64, "0" * 64, "abc"],
            "base_sha": [None, True, [], "0" * 40, self.payload["base_sha"].upper()],
        }.items():
            cases.extend(self.result(**{field: value}) for value in values)
        for missing in ("diff_bytes", "diff_sha256", "base_sha"):
            value = self.result()
            del value[missing]
            cases.append(value)
        cases.append(self.result("x" * 262145))
        for result in cases:
            with self.subTest(result=str(result)[:120]):
                self.persist(result)
                response = self.client.get(self.path)
                self.assertEqual(response.status_code, 409, response.text[:200])
                self.assertNotIn("content-disposition", response.headers)

    def test_failed_unknown_and_absent_verification_are_inspectable(self):
        for verification in ({"status": "failed"}, {"status": "unknown"}, None):
            with self.subTest(verification=verification):
                result = self.result(verification=verification)
                self.persist(result)
                self.assertEqual(self.client.get(self.path).status_code, 200)
                self.assertEqual(
                    self.client.get(f"/api/v1/runs/{self.run_id}").json()["result"], result
                )
