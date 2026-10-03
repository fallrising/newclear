import json
import unittest
from uuid import uuid4

from agent_platform.guest_fixture import edit_command
from agent_platform.model_mock import mock_response


def mock_command(content, run_id):
    value = mock_response(
        {
            "model": "local-mock",
            "messages": [{"role": "user", "content": content}],
            "tools": [],
            "max_tokens": 16,
            "stream": False,
        },
        run_id,
    )
    raw = value["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"]
    return json.loads(raw)["command"]


class GuestFixtureCardTests(unittest.TestCase):
    def test_in_guest_model_uses_the_same_card_command(self):
        run_id = str(uuid4())
        for content in (
            "Please write the login page",
            "FILE note.txt\nTEXT hello",
            "Task\nFILE note.txt\nTEXT hello\nThanks",
            "FILE ../note.txt\nTEXT hello",
        ):
            messages = [{"role": "user", "content": content}]
            with self.subTest(content=content):
                self.assertEqual(edit_command(messages, run_id), mock_command(content, run_id))
