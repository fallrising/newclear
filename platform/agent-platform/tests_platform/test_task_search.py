"""Authenticated literal history queries against the real PostgreSQL fixture."""

import base64
import json
from uuid import uuid4

from test_control_plane import PlatformFixture


def token(value):
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")


class TaskSearchTests(PlatformFixture):
    def seed(self, title, goal="goal", state="queued", project=None):
        response = self.post(
            "/tasks",
            {
                **self.payload,
                "title": title,
                "goal": goal,
                "project_id": project or self.project["id"],
            },
        )
        self.assertEqual(response.status_code, 202, response.text)
        value = response.json()
        with self.db.transaction() as conn:
            conn.execute("UPDATE runs SET state=%s WHERE id=%s", (state, value["run"]["id"]))
        return value

    def query(self, **params):
        response = self.client.get("/api/v1/tasks", params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def ids(self, **params):
        return {row["id"] for row in self.query(**params)["items"]}

    def invalid(self, **params):
        response = self.client.get("/api/v1/tasks", params=params)
        self.assertEqual(response.status_code, 422, response.text)
        return response

    def test_authenticated_search(self):
        self.client.cookies.clear()
        self.assertEqual(self.client.get("/api/v1/tasks", params={"q": "goal"}).status_code, 401)

    def test_title_goal_case_trim_and_unicode(self):
        first = self.seed("Fix Cocoon", "檢查隔離")
        second = self.seed("Other", "COCOON integration")
        self.seed("Unrelated")
        self.assertEqual(self.ids(q="  cocoon  "), {first["task"]["id"], second["task"]["id"]})
        self.assertEqual(self.ids(q="隔離"), {first["task"]["id"]})
        self.assertEqual(len(self.ids(q="   ")), 3)
        self.assertEqual(len(self.ids(q="")), 3)

    def test_percent_underscore_backslash_and_sql_are_literal(self):
        self.seed("Ordinary", "anything")
        for literal in ("%", "_", "\\", "!", "' OR 1=1 --"):
            value = self.seed("Exact " + literal)
            self.assertEqual(self.ids(q=literal), {value["task"]["id"]})

    def test_search_limit_is_raw_not_trimmed(self):
        self.seed("x" * 200)
        self.assertEqual(len(self.ids(q="x" * 200)), 1)
        self.invalid(q="x" * 201)
        self.invalid(q=" " * 201)
        self.invalid(q="界" * 201)

    def test_project_and_state_compose(self):
        other = self.post(
            "/projects", {"name": "Other", "canonical_repo": "https://example.test/repo"}
        ).json()
        value = self.seed("Needle", state="failed")
        self.seed("Needle", state="queued")
        self.seed("Needle", state="failed", project=other["id"])
        self.assertEqual(
            self.ids(q="needle", state="failed", project_id=self.project["id"]),
            {value["task"]["id"]},
        )
        self.assertEqual(self.ids(project_id=str(uuid4())), set())
        self.assertEqual(self.ids(q="absent"), set())

    def test_invalid_project_and_state(self):
        for project in ("", "not-uuid", "1", "[]"):
            self.invalid(project_id=project)
        for state in ("", "unknown", "FAILED", "failed' OR 1=1 --"):
            self.invalid(state=state)

    def test_latest_attempt_controls_goal_and_state(self):
        value = self.seed("Task", "old needle", "failed")
        response = self.post(
            f"/tasks/{value['task']['id']}/runs",
            {
                "goal": "new phrase",
                "base_sha": self.payload["base_sha"],
                "profile_revision": self.profile["id"],
                "expected_state_version": 1,
            },
        )
        self.assertEqual(response.status_code, 202, response.text)
        self.assertEqual(self.ids(q="old needle"), set())
        self.assertEqual(self.ids(state="failed"), set())
        self.assertEqual(self.ids(q="new phrase", state="queued"), {value["task"]["id"]})

    def test_filtered_pages_have_no_gaps_or_duplicates_with_ties(self):
        values = [self.seed("needle", state="failed") for _ in range(7)]
        self.seed("unrelated", state="failed")
        with self.db.transaction() as conn:
            conn.execute("UPDATE tasks SET created_at='2026-01-01T00:00:00Z'")
        seen, cursor = [], None
        while True:
            params = {
                "q": "needle",
                "state": "failed",
                "project_id": self.project["id"],
                "limit": 2,
            }
            if cursor:
                params["cursor"] = cursor
            page = self.query(**params)
            seen.extend(row["id"] for row in page["items"])
            cursor = page["next_cursor"]
            if cursor is None:
                break
        self.assertEqual(len(seen), 7)
        self.assertEqual(set(seen), {value["task"]["id"] for value in values})
        self.assertEqual(seen, sorted(seen, reverse=True))

    def test_cursor_binds_all_filters_and_accepts_normalized_equivalents(self):
        for _ in range(3):
            self.seed("needle", state="failed")
        filters = {"q": "needle", "project_id": self.project["id"], "state": "failed"}
        cursor = self.query(**filters, limit=1)["next_cursor"]
        self.assertEqual(
            len(self.query(**{**filters, "q": "  needle  "}, cursor=cursor)["items"]), 2
        )
        for change in ({"q": "different"}, {"project_id": str(uuid4())}, {"state": "queued"}):
            self.assertEqual(
                self.invalid(**{**filters, **change}, cursor=cursor).json()["error"],
                "invalid_cursor",
            )
        self.assertEqual(self.invalid(cursor=cursor).json()["error"], "invalid_cursor")
        legacy = self.query(limit=1)["next_cursor"]
        self.assertEqual(self.invalid(**filters, cursor=legacy).json()["error"], "invalid_cursor")
        self.assertEqual(len(self.query(cursor=legacy)["items"]), 2)

    def test_malformed_cursor_shapes_are_rejected(self):
        malformed = (
            None,
            1,
            True,
            [],
            {},
            ["a", "b"],
            {"v": 1},
            {"v": 1, "scope": [], "after": []},
            {"v": True, "scope": {}, "after": [1, 2]},
            {
                "v": 1,
                "scope": {"q": "needle", "project_id": None, "state": None},
                "after": ["2026-01-01T00:00:00", str(uuid4())],
            },
        )
        for value in malformed:
            with self.subTest(value=value):
                self.assertEqual(
                    self.invalid(q="needle", cursor=token(value)).json()["error"], "invalid_cursor"
                )
        for cursor in ("!", "A", "é", "x" * 513):
            self.invalid(q="needle", cursor=cursor)

    def test_allowlisted_states_and_long_unicode_cursor(self):
        for state in (
            "queued",
            "provisioning",
            "running",
            "awaiting_approval",
            "pausing",
            "paused",
            "resuming",
            "finalizing",
            "cancelling",
            "interrupted",
            "succeeded",
            "failed",
            "cancelled",
        ):
            value = self.seed(state, state=state)
            self.assertEqual(self.ids(state=state), {value["task"]["id"]})
        for _ in range(3):
            self.seed("界" * 200)
        first = self.query(q="界" * 200, limit=1)
        self.assertLessEqual(len(first["next_cursor"]), 512)
        self.assertEqual(len(self.query(q="界" * 200, cursor=first["next_cursor"])["items"]), 2)

    def test_tampered_filtered_cursor_fields_and_legacy_shapes(self):
        for _ in range(3):
            self.seed("needle")
        cursor = self.query(q="needle", limit=1)["next_cursor"]
        original = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        for changes in (
            {"v": True},
            {"v": 2},
            {"scope": []},
            {"after": {}},
            {"after": [1, 2]},
            {"after": ["2026-01-01", str(uuid4())]},
            {"after": ["2026-01-01T00:00:00Z", "invalid"]},
            {"extra": 1},
        ):
            self.assertEqual(
                self.invalid(q="needle", cursor=token({**original, **changes})).json()["error"],
                "invalid_cursor",
            )
        for value in ({}, 1, True, [], [1, 2], ["2026-01-01", str(uuid4())]):
            self.assertEqual(self.invalid(cursor=token(value)).json()["error"], "invalid_cursor")

    def test_nul_search_rejected_but_embedded_newline_allowed(self):
        value = self.seed("Line\nbreak")
        self.assertEqual(self.ids(q="Line\nbreak"), {value["task"]["id"]})
        self.invalid(q="\x00")
        self.invalid(q="Line\x00break")
