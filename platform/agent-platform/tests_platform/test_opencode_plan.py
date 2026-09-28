import unittest

from agent_platform.model_policy import HTTPS_MODE, Policy

GO_CHAT = "https://opencode.ai/zen/go/v1/chat/completions"


class OpenCodePlanTests(unittest.TestCase):
    def test_go_chat_completions_fits_the_existing_https_transport(self):
        policy = Policy(
            GO_CHAT,
            "synthetic-opencode-go-token",
            mode=HTTPS_MODE,
            model="kimi-k2.6",
            request_limit=4,
        )
        self.assertEqual(policy.origin, GO_CHAT)
        self.assertNotIn("synthetic-opencode-go-token", repr(policy))
        self.assertNotIn("synthetic-opencode-go-token", policy.digest)
        self.assertEqual(policy.model, "kimi-k2.6")
