"""RE-1 behavioral checks, including real HTTP and process restart."""
import copy
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from retro.domain import RuleError, apply_action, new_character
from retro.store import Store
from retro.http import make_server


def move(dx, dy=0):
    return {"type": "move", "dx": dx, "dy": dy}


def route(profession):
    axis = (-1, 0) if profession == "smith" else (0, 1)
    distance, amount, item = (3, 2, "kit") if profession == "smith" else (4, 3, "medicine")
    return ([move(*axis)] * distance + [{"type": "gather"}] * amount
            + [move(-axis[0], -axis[1])] * distance
            + [{"type": "craft", "item": item}] + [move(1)] * 4)


class RulesTests(unittest.TestCase):
    def test_both_professions_complete_first_route(self):
        for profession in ("smith", "herbalist"):
            state = new_character("霧", profession)
            self.assertEqual(state["coins"], 12)
            self.assertEqual(state["items"]["medicine" if profession == "smith" else "kit"], 1)
            for action in route(profession):
                previous = copy.deepcopy(state)
                state, message = apply_action(state, action)
                self.assertEqual(previous["coins"], 12 if not previous["tower_reward_claimed"] else 20)
                self.assertTrue(message)
            self.assertEqual((state["x"], state["hp"], state["coins"], state["tower_stage"]), (4, 3, 20, 2))
            self.assertTrue(state["tower_reward_claimed"])
            self.assertEqual(state["items"], {"ore": 0, "herb": 0, "kit": 0, "medicine": 0})

    def test_no_repeat_reward_backtrack_and_town_reset(self):
        state = new_character("霧", "smith")
        for action in route("smith") + [move(-1), move(1)]:
            state, _ = apply_action(state, action)
        self.assertEqual(state["coins"], 20)
        for _ in range(4):
            state, _ = apply_action(state, move(-1))
        self.assertEqual(state["tower_stage"], 0)
        state["items"].update(kit=1, medicine=1)
        for _ in range(4):
            state, _ = apply_action(state, move(1))
        self.assertEqual(state["coins"], 20)
        self.assertEqual(state["items"]["kit"], 0)

    def test_deterministic_failure_consumes_kit_and_returns_to_town(self):
        state = new_character("霧", "herbalist")
        for _ in range(3):
            state, _ = apply_action(state, move(1))
        self.assertEqual((state["x"], state["y"], state["hp"], state["tower_stage"]), (0, 0, 3, 0))
        self.assertEqual(state["items"]["kit"], 0)
        self.assertEqual(state["coins"], 12)

    def test_barrier_only_charged_once_before_town(self):
        state = new_character("霧", "herbalist")
        for action in [move(1), move(1), move(-1), move(1)]:
            state, _ = apply_action(state, action)
        self.assertEqual((state["x"], state["tower_stage"], state["items"]["kit"]), (2, 1, 0))

    def test_rejections_never_mutate_input(self):
        actions = [move(0, -1), move(1, 1), move(2), move(True), {"type": "gather"},
                   {"type": "craft", "item": "kit"}, {"type": "craft", "item": "medicine"},
                   {"type": "gather", "quantity": -1}, {"type": "gather", "coins": 100},
                   {"type": "unknown"}, [], {"type": "move", "dx": 1.0, "dy": 0}]
        for action in actions:
            with self.subTest(action=action):
                state = new_character("霧", "smith")
                before = copy.deepcopy(state)
                with self.assertRaises(RuleError):
                    apply_action(state, action)
                self.assertEqual(state, before)

    def test_gather_is_unlimited_and_available_to_both_professions(self):
        for profession in ("smith", "herbalist"):
            state = new_character("霧", profession)
            for _ in range(3):
                state, _ = apply_action(state, move(-1))
            for _ in range(5):
                state, _ = apply_action(state, {"type": "gather"})
            self.assertEqual(state["items"]["ore"], 5)
            with self.assertRaises(RuleError):
                apply_action(state, {"type": "craft", "item": "kit"})

    def test_success_does_not_mutate_input(self):
        state = new_character("霧", "smith")
        before = copy.deepcopy(state)
        result, _ = apply_action(state, move(-1))
        result["items"]["ore"] = 99
        self.assertEqual(state, before)

    def test_missing_kit_and_wrong_profession_preserve_state(self):
        state = new_character("霧", "smith")
        state, _ = apply_action(state, move(1))
        before = copy.deepcopy(state)
        with self.assertRaises(RuleError) as rejected:
            apply_action(state, move(1))
        self.assertEqual(rejected.exception.code, "missing_kit")
        self.assertEqual(state, before)
        state = new_character("霧", "herbalist")
        state["items"]["ore"] = 10
        before = copy.deepcopy(state)
        with self.assertRaises(RuleError) as rejected:
            apply_action(state, {"type": "craft", "item": "kit"})
        self.assertEqual(rejected.exception.code, "wrong_profession")
        self.assertEqual(state, before)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "save.sqlite3"
        self.store = Store(self.path)
        self.join = {"name": "霧", "profession": "smith", "join_id": str(uuid4())}
        self.status, self.created = self.store.join(self.join)
        self.token = self.created["token"]

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def act(self, action, action_id=None):
        return self.store.action(self.token, {"action_id": action_id or str(uuid4()), "action": action})

    def test_join_replay_restart_and_conflict(self):
        self.assertEqual(self.status, 201)
        self.assertEqual(self.store.join(self.join), (201, self.created))
        self.store.close()
        self.store = Store(self.path)
        self.assertEqual(self.store.join(self.join), (201, self.created))
        status, result = self.store.join(dict(self.join, profession="herbalist"))
        self.assertEqual(status, 409)
        self.assertFalse(result["ok"])

    def test_delayed_action_replay_survives_intervening_actions_and_restart(self):
        for _ in range(3):
            self.act(move(-1))
        aid = str(uuid4())
        original = self.act({"type": "gather"}, aid)
        self.act({"type": "gather"})
        self.store.close()
        self.store = Store(self.path)
        self.assertEqual(self.act({"type": "gather"}, aid), original)
        self.assertEqual(self.store.state(self.token)[1]["state"]["items"]["ore"], 2)
        self.assertEqual(self.act(move(1), aid)[0], 409)

    def test_rejected_action_is_retained_without_state_change(self):
        aid = str(uuid4())
        old = self.act({"type": "gather"}, aid)
        self.assertEqual(old[0], 400)
        self.assertEqual(old[1]["state"], self.created["state"])
        for _ in range(3):
            self.act(move(-1))
        self.assertEqual(self.act({"type": "gather"}, aid), old)
        self.assertEqual(self.store.state(self.token)[1]["state"]["items"]["ore"], 0)

    def test_reopen_preserves_stage_reward_and_inventory(self):
        for action in route("smith"):
            self.assertEqual(self.act(action)[0], 200)
        expected = self.store.state(self.token)
        self.store.close()
        self.store = Store(self.path)
        self.assertEqual(self.store.state(self.token), expected)
        self.assertNotIn("token", expected[1]["state"])

    def test_mid_route_restart_preserves_consumed_barrier(self):
        for action in route("smith")[:-2]:
            self.assertEqual(self.act(action)[0], 200)
        self.assertEqual(self.store.state(self.token)[1]["state"]["tower_stage"], 1)
        self.store.close()
        self.store = Store(self.path)
        self.assertEqual(self.act(move(-1))[0], 200)
        self.assertEqual(self.act(move(1))[0], 200)
        self.assertEqual(self.act(move(1))[0], 200)
        self.assertEqual(self.act(move(1))[1]["state"]["coins"], 20)

    def test_action_ids_are_scoped_to_each_character(self):
        aid = str(uuid4())
        self.assertEqual(self.act(move(-1), aid)[0], 200)
        _, second = self.store.join(dict(self.join, join_id=str(uuid4())))
        status, result = self.store.action(second["token"], {"action_id": aid, "action": move(0, 1)})
        self.assertEqual(status, 200)
        self.assertEqual(result["state"]["y"], 1)

    def test_atomic_join_rollback_does_not_create_orphan_character(self):
        self.store.connection.execute("CREATE TRIGGER fail_join BEFORE INSERT ON joins BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        with self.assertRaises(Exception):
            self.store.join(dict(self.join, join_id=str(uuid4())))
        self.assertEqual(self.store.connection.execute("SELECT count(*) FROM characters").fetchone()[0], 1)

    def test_atomic_rollback_if_event_insert_fails(self):
        before = self.store.state(self.token)
        self.store.connection.execute("CREATE TRIGGER fail_event BEFORE INSERT ON log BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        with self.assertRaises(Exception):
            self.act(move(-1))
        self.assertEqual(self.store.state(self.token), before)

    def test_normalized_schema_persists_items_tower_and_replay_journal(self):
        for action in route("smith"):
            self.act(action)
        row = self.store.connection.execute("SELECT x, y, hp, coins, tower_stage, tower_reward_claimed FROM characters WHERE id = ?", (self.created["state"]["id"],)).fetchone()
        self.assertEqual(tuple(row), (4, 0, 3, 20, 2, 1))
        items = self.store.connection.execute("SELECT item, quantity FROM items WHERE character_id = ?", (self.created["state"]["id"],)).fetchall()
        self.assertEqual({row[0]: row[1] for row in items}, {"ore": 0, "herb": 0, "kit": 0, "medicine": 0})
        self.assertEqual(self.store.connection.execute("SELECT count(*) FROM log").fetchone()[0], len(route("smith")))
        with self.assertRaises(Exception):
            with self.store.connection:
                self.store.connection.execute("UPDATE items SET quantity = -1 WHERE item = 'ore'")
        self.assertEqual(self.store.state(self.token)[1]["state"]["items"]["ore"], 0)

    def test_invalid_names_professions_ids_and_tokens(self):
        for update in ({"name": ""}, {"name": "x" * 25}, {"name": "a\nb"}, {"profession": "admin"},
                       {"join_id": "bad"}, {"coins": 500}, {"name": 23}):
            self.assertEqual(self.store.join(dict(self.join, **update))[0], 400)
        self.assertEqual(self.store.state("forged")[0], 401)
        self.assertEqual(self.store.action("forged", {"action_id": str(uuid4()), "action": move(1)})[0], 401)


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        static = self.root / "static"
        static.mkdir()
        (static / "index.html").write_text("<!doctype html><title>霧岸鎮</title>")
        (static / "app.js").write_text("'use strict';")
        (static / "style.css").write_text("body{}")
        self.server = make_server("127.0.0.1", 0, self.root / "db.sqlite3", static)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.port = self.server.server_port
        _, result, _ = self.request("POST", "/api/join", {"name": "<b>霧</b>", "profession": "smith", "join_id": str(uuid4())})
        self.token = result["token"]

    def tearDown(self):
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()
        self.temp.cleanup()

    def request(self, method, path, body=None, headers=None, raw=False):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        data = body if raw else (json.dumps(body).encode() if body is not None else None)
        hdr = {"Content-Type": "application/json"}
        hdr.update(headers or {})
        conn.request(method, path, data, hdr)
        response = conn.getresponse()
        payload = response.read()
        result = json.loads(payload) if "application/json" in response.getheader("Content-Type", "") else payload
        status, result_headers = response.status, dict(response.getheaders())
        conn.close()
        return status, result, result_headers

    def test_real_http_action_and_state(self):
        auth = {"Authorization": "Bearer " + self.token}
        status, result, _ = self.request("POST", "/api/action", {"action_id": str(uuid4()), "action": move(-1)}, auth)
        self.assertEqual(status, 200)
        self.assertEqual(result["state"]["x"], -1)
        self.assertEqual(self.request("GET", "/api/state", headers=auth)[1]["state"], result["state"])
        self.assertNotIn(self.token, json.dumps(result))

    def test_token_and_static_boundaries(self):
        self.assertEqual(self.request("GET", "/api/state")[0], 401)
        self.assertEqual(self.request("GET", "/api/state?token=" + self.token)[0], 404)
        for path in ("/../db.sqlite3", "/%2e%2e/db.sqlite3", "/server.py", "/missing", "/static/index.html"):
            self.assertEqual(self.request("GET", path)[0], 404)
        for path in ("/", "/app.js", "/style.css"):
            status, _, headers = self.request("GET", path)
            self.assertEqual(status, 200)
            self.assertEqual(headers["X-Content-Type-Options"], "nosniff")

    def test_bad_json_type_nonfinite_duplicate_keys_and_size(self):
        for body in (b"{", b"null", b"[]", b'{"name":NaN}', b'{"name":1,"name":2}'):
            self.assertEqual(self.request("POST", "/api/join", body, raw=True)[0], 400)
        self.assertEqual(self.request("POST", "/api/join", b"x" * 8193, raw=True)[0], 413)
        self.assertEqual(self.request("POST", "/api/join", {}, {"Content-Type": "text/plain"})[0], 415)

    def test_escaped_surrogates_and_infinite_exponents_rejected(self):
        auth = {"Authorization": "Bearer " + self.token}
        body = {"action_id": str(uuid4()), "action": {"type": "craft", "item": "\ud800"}}
        self.assertEqual(self.request("POST", "/api/action", body, auth)[0], 400)
        raw = ('{"action_id":"' + str(uuid4()) + '","action":{"type":"move","dx":1e999,"dy":0}}').encode()
        self.assertEqual(self.request("POST", "/api/action", raw, auth, raw=True)[0], 400)

    def test_bad_framing_and_duplicate_auth_rejected(self):
        requests = [
            b"Content-Length: 2\r\nContent-Length: 2\r\n",
            b"Content-Length: -1\r\n",
            b"Content-Length: 2\r\nTransfer-Encoding: chunked\r\n",
            b"",
        ]
        for framing in requests:
            sock = socket.create_connection(("127.0.0.1", self.port), timeout=5)
            sock.sendall(b"POST /api/join HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n" + framing + b"\r\n{}")
            self.assertIn(b"400", sock.recv(2048))
            sock.close()
        sock = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        auth = ("Authorization: Bearer " + self.token + "\r\n").encode()
        sock.sendall(b"GET /api/state HTTP/1.1\r\nHost: localhost\r\n" + auth + auth + b"\r\n")
        self.assertIn(b"401", sock.recv(2048))
        sock.close()

    def test_cross_origin_writes_rejected_and_same_origin_allowed(self):
        body = {"action_id": str(uuid4()), "action": move(-1)}
        auth = {"Authorization": "Bearer " + self.token}
        self.assertEqual(self.request("POST", "/api/action", body, dict(auth, Origin="https://evil.example"))[0], 400)
        self.assertEqual(self.request("POST", "/api/action", body, dict(auth, Origin=f"http://127.0.0.1:{self.port}"))[0], 200)

    def test_stalled_body_times_out_and_server_recovers(self):
        sock = socket.create_connection(("127.0.0.1", self.port), timeout=6)
        sock.sendall(b"POST /api/join HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 10\r\n\r\n{")
        response = sock.recv(2048)
        self.assertTrue(not response or b"408" in response)
        sock.close()
        self.assertEqual(self.request("GET", "/")[0], 200)


class ProcessRestartTests(unittest.TestCase):
    def test_actual_process_restart_keeps_state_and_join_grants(self):
        with tempfile.TemporaryDirectory() as temp:
            command = [sys.executable, str(ROOT / "server.py"), "--port", "0", "--db", str(Path(temp) / "save.sqlite3")]
            def start():
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                line = process.stdout.readline().strip()
                if not line.startswith("http://"):
                    process.terminate()
                    _, err = process.communicate(timeout=5)
                    self.fail(f"Server failed: {line} {err}")
                return process, int(line.rsplit(":", 1)[1])
            def request(port, path, body=None, token=None):
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                headers = {"Content-Type": "application/json"}
                if token:
                    headers["Authorization"] = "Bearer " + token
                conn.request("POST" if body else "GET", path, json.dumps(body) if body else None, headers)
                response = conn.getresponse()
                result = json.loads(response.read())
                conn.close()
                return result
            process, port = start()
            join = {"name": "重啟", "profession": "smith", "join_id": str(uuid4())}
            try:
                created = request(port, "/api/join", join)
                token = created["token"]
                for action in route("smith"):
                    expected = request(port, "/api/action", {"action_id": str(uuid4()), "action": action}, token)
                    self.assertTrue(expected["ok"])
            finally:
                process.terminate()
                process.communicate(timeout=5)
            process, port = start()
            try:
                restored = request(port, "/api/state", token=token)
                self.assertEqual(restored["state"], expected["state"])
                self.assertEqual(request(port, "/api/join", join), created)
                self.assertEqual(request(port, "/api/state", token=token)["state"], expected["state"])
            finally:
                process.terminate()
                process.communicate(timeout=5)
