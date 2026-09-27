import json
import unittest
from uuid import uuid4

from agent_platform.model_mock import mock_response


def payload(content):
    return {
        "model": "local-mock",
        "messages": [{"role": "user", "content": content}],
        "tools": [],
        "max_tokens": 16,
        "stream": False,
    }


class MockTaskCardTests(unittest.TestCase):
    def command(self, content):
        value = mock_response(payload(content), str(uuid4()))
        raw = value["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"]
        return json.loads(raw)["command"]

    def test_plain_card_writes_only_that_file(self):
        command = self.command("FILE note.txt\nTEXT hello")
        self.assertIn("Path('note.txt')", command)
        self.assertIn("hello", command)
        self.assertNotIn("m2-result.txt", command)

    def test_other_goals_keep_the_fixture_file(self):
        run_id = str(uuid4())
        value = mock_response(payload("Please write the login page"), run_id)
        raw = value["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"]
        self.assertIn("m2-result.txt", json.loads(raw)["command"])
        self.assertIn(run_id, json.loads(raw)["command"])

    def test_paths_and_shell_text_are_not_a_card(self):
        for content in (
            "FILE ../note.txt\nTEXT hello",
            "FILE note.txt\nTEXT hello; rm -rf /",
            "FILE note.txt\nTEXT hello\nTEXT extra",
        ):
            with self.subTest(content=content):
                self.assertIn("m2-result.txt", self.command(content))
