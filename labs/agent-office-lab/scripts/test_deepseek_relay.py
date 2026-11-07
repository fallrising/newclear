import json
import unittest
from deepseek_relay import Budget, bounded_payload, MAX_BODY, MAX_OUTPUT, MAX_REQUESTS

class RelayBoundary(unittest.TestCase):
    def request(self, **extra):
        return json.dumps({'model': 'deepseek-flash', 'stream': True, 'messages': [{'role': 'user', 'content': 'synthetic'}], **extra}).encode()

    def test_caps_every_request_and_disables_thinking(self):
        d=json.loads(bounded_payload(self.request(max_tokens=999999, max_completion_tokens=999999,n=10,thinking={'type':'enabled'})))
        self.assertEqual(d['max_tokens'],MAX_OUTPUT);self.assertEqual(d['n'],1)
        self.assertNotIn('max_completion_tokens',d);self.assertEqual(d['thinking'],{'type':'disabled'})
        self.assertEqual(d['stream_options'],{'include_usage':True})

    def test_rejects_wrong_model_mode_empty_messages_and_oversize(self):
        for raw in (self.request(model='other'),self.request(stream=False),self.request(messages=[]),b'x'*(MAX_BODY+1),b'[]'):
            with self.assertRaises((ValueError,TypeError)): bounded_payload(raw)

    def test_budget_cannot_exceed_four_requests_or_overlap(self):
        b=Budget()
        for _ in range(MAX_REQUESTS):
            b.reserve()
            with self.assertRaises(ValueError): b.reserve()
            b.finish()
        with self.assertRaises(ValueError): b.reserve()
        self.assertEqual(b.requests,MAX_REQUESTS)

    def test_any_provider_failure_stops_future_forwarding(self):
        b=Budget();b.reserve();b.finish(failed=True)
        with self.assertRaises(ValueError): b.reserve()
        self.assertEqual(b.requests,1)

if __name__=='__main__':unittest.main()
