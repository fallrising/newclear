import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

from ice_maker.document_service import DurableBatchService

SPEC = importlib.util.spec_from_file_location("review_fixture", Path(__file__).with_name("serve_fixture.py"))
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


class FixtureTests(unittest.TestCase):
    def test_seed_identity_is_stable_on_restart_and_fresh_state(self):
        identities = []
        for _ in range(2):
            with tempfile.TemporaryDirectory() as directory:
                for _ in range(2):
                    service = DurableBatchService(directory, config_path=FIXTURE.COMPONENT / "config/document-ingestion.json", runner=FIXTURE.indexed_runner)
                    try:
                        payloads = [FIXTURE.synthetic_pdf(FIXTURE.SHORT), FIXTURE.synthetic_pdf(FIXTURE.LONG)]
                        uploads = [FIXTURE.Upload(name, payload) for name, payload in zip(["short.pdf", "long.pdf"], payloads)]
                        batch = service.submit(uploads, FIXTURE.metadata(uploads))
                        self.assertTrue(service.wait_until_idle(5))
                        self.assertEqual(service.status(batch)["status"], "completed")
                        identities.append(batch)
                        for payload in payloads:
                            body = service.readable_markdown(batch, hashlib.sha256(payload).hexdigest())
                            self.assertIn(b"synthetic", body)
                    finally:
                        self.assertTrue(service.close())
        self.assertEqual(len(set(identities)), 1)

    def test_injected_runner_failure_is_real_failed_batch(self):
        with tempfile.TemporaryDirectory() as directory:
            service = DurableBatchService(directory, config_path=FIXTURE.COMPONENT / "config/document-ingestion.json", runner=FIXTURE.indexed_runner)
            try:
                upload = FIXTURE.Upload("failed.pdf", FIXTURE.synthetic_pdf("ICE_REVIEW_FAIL"))
                batch = service.submit([upload], FIXTURE.metadata([upload]))
                self.assertTrue(service.wait_until_idle(5))
                self.assertEqual(service.status(batch)["status"], "failed")
                self.assertEqual(service.status(batch)["reason"], "processing_failed")
            finally:
                self.assertTrue(service.close())


if __name__ == "__main__":
    unittest.main()
