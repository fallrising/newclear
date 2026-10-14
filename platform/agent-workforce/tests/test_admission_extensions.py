"""Integration amendments found by independent architecture reviewers."""
import unittest
from agent_workforce.admission import admit, AdmissionError
from agent_workforce.domain import Registry
from test_domain import _records, _request, _grant, ISSUER, NOW

class AdmissionAmendments(unittest.TestCase):
    def fixture(self):
        records = _records()
        records["routes"]["route-1"]["runtime_status"] = "verified"
        return records, _grant(), _request()

    def test_last_message_is_counted_once_at_dispatch(self):
        records, grant, request = self.fixture()
        grant["max_messages"] = 1
        registry = Registry(records, (ISSUER,))
        admit(registry, grant, request, authenticated_caller=ISSUER, now=NOW, usage={"messages": 0})
        with self.assertRaises(AdmissionError):
            admit(registry, grant, request, authenticated_caller=ISSUER, now=NOW, usage={"messages": 1})
        result = admit(registry, grant, request, authenticated_caller=ISSUER, now=NOW,
                       usage={"messages": 1}, phase="dispatch")
        self.assertEqual(result["usage"]["messages"], 1)

    def test_runtime_status_must_be_explicitly_verified(self):
        for status in ["unknown", "runtime_unverified", "observed", "needs-revalidation", "blocked"]:
            records, grant, request = self.fixture()
            records["routes"]["route-1"]["runtime_status"] = status
            with self.subTest(status=status), self.assertRaises(AdmissionError):
                admit(Registry(records, (ISSUER,)), grant, request, authenticated_caller=ISSUER, now=NOW)

    def test_body_cannot_choose_dispatch_budget_phase(self):
        records, grant, request = self.fixture()
        grant["max_messages"] = 1
        request["phase"] = "dispatch"
        with self.assertRaises(AdmissionError):
            admit(Registry(records, (ISSUER,)), grant, request,
                  authenticated_caller=ISSUER, now=NOW, usage={"messages": 1})

    def test_invalid_trusted_phase_is_rejected(self):
        records, grant, request = self.fixture()
        with self.assertRaises(AdmissionError):
            admit(Registry(records, (ISSUER,)), grant, request,
                  authenticated_caller=ISSUER, now=NOW, phase="skip")

if __name__ == "__main__":
    unittest.main()
