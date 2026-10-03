import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from urllib.error import HTTPError, URLError

import context_lab as lab


class ContextTests(unittest.TestCase):
    def setUp(self):
        self.scope = "viking://resources/context-lab"
        self.records = lab.fixture_records(self.scope)
        self.backend = lab.FixtureBackend(self.records)

    def bundle(self, **kwargs):
        return lab.assemble(self.backend, self.records, self.scope, "backup", **kwargs)

    def test_source_hash_and_revision_are_preserved(self):
        result = self.bundle()
        self.assertEqual(len(result["entries"]), 1)
        entry = result["entries"][0]
        self.assertEqual(lab.digest(entry["content"]), entry["sha256"])
        self.assertEqual(entry["source_revision"], "synthetic-v1")
        self.assertEqual(entry["claim_type"], "synthetic_source_fact")

    def test_no_match_is_empty_not_a_fake_answer(self):
        result = lab.assemble(self.backend, self.records, self.scope, "zzzz")
        self.assertEqual(result["entries"], [])

    def test_whole_json_including_metadata_fits_byte_budget(self):
        for budget in (512, 700, 1000, 12000):
            result = self.bundle(max_bytes=budget)
            self.assertLessEqual(len(lab.encoded(result)) + 1, budget)
        self.assertEqual(self.bundle(max_bytes=512)["entries"], [])

    def test_multibyte_data_is_measured_as_utf8(self):
        record = self.records[0]
        record["content"] = "backup 備份🙂" * 80
        record["sha256"] = lab.digest(record["content"])
        self.backend = lab.FixtureBackend(self.records)
        result = self.bundle(max_bytes=1000)
        self.assertEqual(result["entries"], [])

    def test_escape_or_unapproved_result_is_rejected_before_read(self):
        for suffix in ("-other/backup.md", "/../secret.md", "/%2e%2e/secret.md", "/unknown.md"):
            with self.subTest(suffix=suffix):
                self.backend.find = Mock(return_value={"resources": [{"uri": self.scope + suffix, "level": 2}]})
                self.backend.read = Mock()
                with self.assertRaises(lab.LabError):
                    self.bundle()
                self.backend.read.assert_not_called()

    def test_stale_or_mutated_source_fails_closed(self):
        self.backend.files[self.records[0]["uri"]] += "\nchanged"
        with self.assertRaisesRegex(lab.LabError, "revision mismatch"):
            self.bundle()

    def test_candidate_is_not_promoted(self):
        self.records[0]["state"] = "candidate"
        with self.assertRaisesRegex(lab.LabError, "unapproved"):
            self.bundle()

    def test_summary_cannot_replace_l2_evidence(self):
        self.backend.find = Mock(return_value={"resources": [{"uri": self.records[0]["uri"], "level": 0}]})
        with self.assertRaisesRegex(lab.LabError, "L2"):
            self.bundle()

    def test_bad_scope_and_limits_never_call_server(self):
        for scope in ("viking://resources", "viking://resources/a/../b", "viking://~/resources/a", "viking://resources/a/"):
            with self.assertRaises(lab.LabError):
                lab.validate_scope(scope)
        self.backend.find = Mock()
        for limit in (0, -1, 21):
            with self.assertRaises(lab.LabError):
                self.bundle(limit=limit)
        self.backend.find.assert_not_called()

    def test_duplicate_candidates_are_deduplicated(self):
        hit = {"uri": self.records[0]["uri"], "level": 2}
        self.backend.find = Mock(return_value={"resources": [hit, hit]})
        self.assertEqual(len(self.bundle()["entries"]), 1)

    def test_seed_reconciles_without_overwriting(self):
        empty = lab.FixtureBackend([])
        self.assertEqual(lab.seed(empty, self.records)["created"], 2)
        self.assertEqual(lab.seed(empty, self.records)["unchanged"], 2)
        empty.files[self.records[0]["uri"]] = "keep this user's content"
        with self.assertRaises(lab.LabError):
            lab.seed(empty, self.records)
        self.assertEqual(empty.files[self.records[0]["uri"]], "keep this user's content")

    def test_seed_does_not_retry_unknown_write(self):
        empty = lab.FixtureBackend([])
        empty.create = Mock(side_effect=lab.LabError("unknown"))
        with self.assertRaises(lab.LabError):
            lab.seed(empty, self.records)
        empty.create.assert_called_once()


class HTTPContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.key = Path(self.temp.name) / "user.key"
        self.key.write_text("synthetic-key")
        self.key.chmod(0o600)
        self.client = lab.HTTPBackend("http://127.0.0.1:1933", self.key)

    def reply(self, result, status="ok"):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = lab.encoded({"status": status, "result": result})
        self.client.opener.open = Mock(return_value=response)

    def test_find_wire_contract(self):
        self.reply({"resources": []})
        self.client.find("backup", "viking://resources/context-lab", 5)
        request = self.client.opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "http://127.0.0.1:1933/api/v1/search/find")
        self.assertEqual(json.loads(request.data), {
            "query": "backup", "target_uri": "viking://resources/context-lab",
            "context_type": "resource", "level": 2, "limit": 5, "include_provenance": True})
        self.assertEqual(request.get_header("X-api-key"), "synthetic-key")

    def test_read_uses_encoded_uri_and_string_result(self):
        self.reply("body")
        self.assertEqual(self.client.read("viking://resources/context-lab/backup.md"), "body")
        request = self.client.opener.open.call_args.args[0]
        self.assertIn("uri=viking%3A%2F%2Fresources%2Fcontext-lab%2Fbackup.md", request.full_url)
        self.reply({"content": "wrong shape"})
        with self.assertRaises(lab.LabError):
            self.client.read("x")

    def test_write_is_create_only_and_incomplete_is_not_success(self):
        record = lab.fixture_records("viking://resources/context-lab")[0]
        self.reply({"vector_status": "complete", "semantic_status": "complete"})
        self.client.create(record)
        payload = json.loads(self.client.opener.open.call_args.args[0].data)
        self.assertEqual(payload["mode"], "create")
        self.assertTrue(payload["wait"])
        for status in ("queued", "skipped", "deferred"):
            self.reply({"vector_status": "complete", "semantic_status": status})
            with self.assertRaises(lab.LabError):
                self.client.create(record)

    def test_transport_errors_do_not_echo_response_or_key(self):
        for error in (HTTPError("url", 401, "synthetic-key", {}, None), URLError("synthetic-key")):
            self.client.opener.open = Mock(side_effect=error)
            with self.assertRaises(lab.LabError) as context:
                self.client.read("x")
            self.assertNotIn("synthetic-key", str(context.exception))
            self.client.opener.open.assert_called_once()

    def test_invalid_or_oversized_response_fails(self):
        self.reply(None, status="error")
        with self.assertRaises(lab.LabError):
            self.client.read("x")
        self.reply(None)
        response = self.client.opener.open.return_value
        for payload in (b"not-json", b"x" * (lab.MAX_RESPONSE + 1)):
            response.read.return_value = payload
            with self.assertRaises(lab.LabError):
                self.client.read("x")

    def test_remote_http_and_unsafe_key_are_rejected(self):
        for url in ("http://example.com", "http://127.0.0.1@evil.test", "https://example.com/?key=x"):
            with self.assertRaises(lab.LabError):
                lab.HTTPBackend(url, self.key)
        self.key.chmod(0o644)
        with self.assertRaises(lab.LabError):
            lab.HTTPBackend("http://127.0.0.1:1933", self.key)

    def test_redirect_is_not_followed(self):
        with self.assertRaises(lab.LabError):
            lab.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.test")


if __name__ == "__main__":
    unittest.main()
