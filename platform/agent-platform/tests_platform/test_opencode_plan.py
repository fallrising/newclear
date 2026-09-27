import unittest

from agent_platform.model_policy import HTTPS_MODE, Policy

ZEN_CHAT = "https://opencode.ai/zen/v1/chat/completions"


class OpenCodePlanTests(unittest.TestCase):
    def test_zen_chat_completions_fits_the_existing_https_transport(self):
        policy = Policy(
            ZEN_CHAT,
            "synthetic-opencode-token",
            mode=HTTPS_MODE,
            model="kimi-k2.6",
            request_limit=4,
        )
        self.assertEqual(policy.origin, ZEN_CHAT)
        self.assertEqual(policy.model, "kimi-k2.6")
        self.assertNotIn("synthetic-opencode-token", repr(policy))
        self.assertNotIn("synthetic-opencode-token", policy.digest)
