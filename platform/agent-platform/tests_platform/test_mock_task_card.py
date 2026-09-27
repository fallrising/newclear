import json
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from agent_platform.model_mock import mock_response, rehearse


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

    def test_plain_card_writes_the_file_and_the_fixture_result(self):
        run_id = str(uuid4())
        value = mock_response(payload("FILE note.txt\nTEXT hello"), run_id)
        command = json.loads(
            value["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"]
        )["command"]
        self.assertIn("Path('note.txt')", command)
        self.assertIn("hello", command)
        self.assertIn("m2-result.txt", command)
        self.assertIn(run_id, command)

    def test_card_is_found_inside_a_longer_user_message(self):
        command = self.command("Task\nFILE note.txt\nTEXT hello\nThanks")
        self.assertIn("Path('note.txt')", command)

    def test_other_goals_keep_the_fixture_file(self):
        run_id = str(uuid4())
        value = mock_response(payload("Please write the login page"), run_id)
        raw = value["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"]
        self.assertIn("m2-result.txt", json.loads(raw)["command"])
        self.assertIn(run_id, json.loads(raw)["command"])

    def test_rehearsal_writes_the_card_and_passes_the_fixture_check(self):
        run_id = str(uuid4())
        with tempfile.TemporaryDirectory() as directory:
            result = rehearse(directory, "FILE note.txt\nTEXT hello", run_id)
            self.assertTrue(result["fixture_matches_run"])
            self.assertEqual((Path(directory) / "note.txt").read_text(), "hello\n")
            self.assertEqual((Path(directory) / "m2-result.txt").read_text(), run_id + "\n")

    def test_paths_and_shell_text_are_not_a_card(self):
        for content in (
            "FILE ../note.txt\nTEXT hello",
            "FILE note.txt\nTEXT hello; rm -rf /",
            "FILE note.txt\nTEXT hello\nFILE other.txt\nTEXT second",
            "FILE m2-result.txt\nTEXT hello",
        ):
            with self.subTest(content=content):
                self.assertIn("m2-result.txt", self.command(content))
