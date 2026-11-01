"""SQLite boundary: state and immutable replay receipts share a transaction."""
import json
from pathlib import Path
import secrets
import sqlite3
import unicodedata
from uuid import UUID

from .domain import ITEMS, RuleError, apply_action, apply_trade, new_character, validate_trade


def error(status, code, message, state=None):
    payload = {"ok": False, "error": {"code": code, "message": message}}
    if state is not None:
        payload["state"] = state
    return status, payload


def valid_id(value):
    if not isinstance(value, str) or len(value) != 36:
        return False
    try:
        return str(UUID(value)) == value.lower()
    except ValueError:
        return False


def encode(value):
    # ASCII escapes let even rejected JSON containing unpaired surrogates be
    # retained as a replay receipt without passing invalid Unicode to SQLite.
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":"), allow_nan=False)


class Store:
    def __init__(self, path):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        # HTTPServer serializes operations. Disabling affinity also permits the
        # test harness to create the server before running its serving thread.
        self.connection = sqlite3.connect(str(path), check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.executescript("""
            CREATE TABLE IF NOT EXISTS characters (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                token TEXT NOT NULL UNIQUE,
                x INTEGER NOT NULL,
                y INTEGER NOT NULL,
                hp INTEGER NOT NULL CHECK(typeof(hp) = 'integer' AND hp BETWEEN 0 AND 3),
                profession TEXT NOT NULL CHECK(profession IN ('smith', 'herbalist')),
                coins INTEGER NOT NULL CHECK(typeof(coins) = 'integer' AND coins >= 0),
                tower_stage INTEGER NOT NULL CHECK(tower_stage IN (0, 1, 2)),
                tower_reward_claimed INTEGER NOT NULL CHECK(tower_reward_claimed IN (0, 1))
            );
            CREATE TABLE IF NOT EXISTS items (
                character_id INTEGER NOT NULL REFERENCES characters(id),
                item TEXT NOT NULL CHECK(item IN ('ore', 'herb', 'kit', 'medicine')),
                quantity INTEGER NOT NULL CHECK(typeof(quantity) = 'integer' AND quantity >= 0),
                PRIMARY KEY(character_id, item)
            );
            CREATE TABLE IF NOT EXISTS listings (
                id INTEGER PRIMARY KEY,
                seller_id INTEGER NOT NULL REFERENCES characters(id),
                item TEXT NOT NULL CHECK(item IN ('ore', 'herb', 'kit', 'medicine')),
                quantity INTEGER NOT NULL CHECK(typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 99),
                price INTEGER NOT NULL CHECK(typeof(price) = 'integer' AND price BETWEEN 1 AND 99),
                status TEXT NOT NULL CHECK(status IN ('open', 'sold', 'cancelled'))
            );
            CREATE TABLE IF NOT EXISTS joins (
                join_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                result TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS log (
                seq INTEGER PRIMARY KEY,
                character_id INTEGER NOT NULL REFERENCES characters(id),
                action_id TEXT NOT NULL,
                action TEXT NOT NULL,
                status INTEGER NOT NULL,
                result TEXT NOT NULL,
                time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(character_id, action_id)
            );
        """)

    def close(self):
        self.connection.close()

    def join(self, body):
        if not isinstance(body, dict) or set(body) != {"name", "profession", "join_id"}:
            return error(400, "invalid_join", "加入資料欄位不正確。")
        name, profession, join_id = body["name"], body["profession"], body["join_id"]
        if (not isinstance(name, str) or not 1 <= len(name.strip()) <= 24
                or any(unicodedata.category(char).startswith("C") for char in name)):
            return error(400, "invalid_name", "名字須為 1 至 24 個字，且不可包含控制字元。")
        if profession not in ("smith", "herbalist") or not valid_id(join_id):
            return error(400, "invalid_join", "職業或加入識別碼不正確。")
        payload = encode(body)
        with self.connection:
            previous = self.connection.execute("SELECT payload, result FROM joins WHERE join_id = ?", (join_id,)).fetchone()
            if previous:
                if previous[0] != payload:
                    return error(409, "id_conflict", "此加入識別碼已用於不同資料，請勿更改重送內容。")
                return 201, json.loads(previous[1])
            token = secrets.token_urlsafe(32)
            state = new_character(name.strip(), profession)
            cursor = self.connection.execute(
                "INSERT INTO characters(name, token, x, y, hp, profession, coins, tower_stage, tower_reward_claimed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (state["name"], token, state["x"], state["y"], state["hp"], state["profession"], state["coins"], state["tower_stage"], int(state["tower_reward_claimed"])))
            state["id"] = cursor.lastrowid
            self.connection.executemany("INSERT INTO items(character_id, item, quantity) VALUES (?, ?, ?)",
                                        [(state["id"], item, state["items"][item]) for item in ITEMS])
            result = {"ok": True, "token": token, "state": state, "message": "歡迎來到霧岸鎮！採集原料、回鎮製作，再挑戰塔路。"}
            self.connection.execute("INSERT INTO joins(join_id, payload, result) VALUES (?, ?, ?)", (join_id, payload, encode(result)))
            return 201, result

    def _character(self, token):
        if not isinstance(token, str) or not 1 <= len(token) <= 128:
            return None
        row = self.connection.execute("SELECT id, name, x, y, hp, profession, coins, tower_stage, tower_reward_claimed FROM characters WHERE token = ?", (token,)).fetchone()
        return self._state_from_row(row)

    def _character_by_id(self, character_id):
        row = self.connection.execute(
            "SELECT id, name, x, y, hp, profession, coins, tower_stage, tower_reward_claimed FROM characters WHERE id = ?",
            (character_id,)).fetchone()
        return self._state_from_row(row)

    def _state_from_row(self, row):
        if row is None:
            return None
        state = dict(row)
        state["tower_reward_claimed"] = bool(state["tower_reward_claimed"])
        state["items"] = {row["item"]: row["quantity"] for row in self.connection.execute(
            "SELECT item, quantity FROM items WHERE character_id = ?", (state["id"],))}
        return state

    def _save_character(self, state):
        self.connection.execute(
            "UPDATE characters SET x = ?, y = ?, hp = ?, coins = ?, tower_stage = ?, tower_reward_claimed = ? WHERE id = ?",
            (state["x"], state["y"], state["hp"], state["coins"], state["tower_stage"], int(state["tower_reward_claimed"]), state["id"]))
        self.connection.executemany("UPDATE items SET quantity = ? WHERE character_id = ? AND item = ?",
                                    [(state["items"][item], state["id"], item) for item in ITEMS])

    def _listings(self):
        return [dict(row) for row in self.connection.execute(
            "SELECT listings.id, seller_id, characters.name AS seller_name, item, quantity, price, status "
            "FROM listings JOIN characters ON characters.id = seller_id ORDER BY listings.id")]

    def _trade(self, state, action):
        kind = validate_trade(action)
        listing, seller = None, None
        if kind != "list":
            row = self.connection.execute("SELECT * FROM listings WHERE id = ?", (action["listing_id"],)).fetchone()
            listing = dict(row) if row else None
            if kind == "buy" and listing:
                seller = self._character_by_id(listing["seller_id"])
        updated, updated_seller, offer, message = apply_trade(state, action, listing, seller)
        if kind == "list":
            cursor = self.connection.execute(
                "INSERT INTO listings(seller_id, item, quantity, price, status) VALUES (?, ?, ?, ?, ?)",
                (offer["seller_id"], offer["item"], offer["quantity"], offer["price"], offer["status"]))
            return updated, message, {"listing_id": cursor.lastrowid}
        if updated_seller is not None:
            self._save_character(updated)
            self._save_character(updated_seller)
        self.connection.execute("UPDATE listings SET status = ? WHERE id = ?", (offer["status"], offer["id"]))
        return updated, message, {}

    def state(self, token):
        state = self._character(token)
        if state is None:
            return error(401, "unauthorized", "角色憑證無效，請確認這個瀏覽器的本機角色。")
        return 200, {"ok": True, "state": state, "listings": self._listings(), "message": "角色狀態已同步。"}

    def action(self, token, body):
        with self.connection:
            # Lock before reading stock, listing or replay state. HTTPServer is
            # single-threaded; this also serializes separate DB connections.
            self.connection.execute("BEGIN IMMEDIATE")
            state = self._character(token)
            if state is None:
                return error(401, "unauthorized", "角色憑證無效，請確認這個瀏覽器的本機角色。")
            if (not isinstance(body, dict) or set(body) != {"action_id", "action"}
                    or not valid_id(body.get("action_id"))):
                return error(400, "invalid_action", "動作識別碼或欄位不正確。", state)
            action_id = body["action_id"]
            try:
                payload = encode(body["action"])
            except (TypeError, ValueError):
                return error(400, "invalid_action", "動作格式不正確。", state)
            previous = self.connection.execute(
                "SELECT action, status, result FROM log WHERE character_id = ? AND action_id = ?",
                (state["id"], action_id)).fetchone()
            if previous:
                if previous[0] != payload:
                    return error(409, "id_conflict", "此動作識別碼已用於不同內容，請勿更改重送內容。", state)
                return previous[1], json.loads(previous[2])
            try:
                action = body["action"]
                extra = {}
                if isinstance(action, dict) and action.get("type") in ("list", "buy", "cancel"):
                    updated, message, extra = self._trade(state, action)
                else:
                    updated, message = apply_action(state, action)
                    self._save_character(updated)
                status, result = 200, {"ok": True, "state": updated, "message": message, **extra}
            except RuleError as exc:
                status, result = error(400, exc.code, exc.message, state)
            self.connection.execute(
                "INSERT INTO log(character_id, action_id, action, status, result) VALUES (?, ?, ?, ?, ?)",
                (state["id"], action_id, payload, status, encode(result)))
            return status, result
