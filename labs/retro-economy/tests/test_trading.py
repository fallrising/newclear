"""RE-A03–A07: pure rules, atomic persistence and real HTTP races."""
import copy
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from retro import domain
from retro.store import Store
import test_backend
from test_backend import move, route


def listing(item="medicine", quantity=1, price=5):
    return {"type": "list", "item": item, "quantity": quantity, "price": price}


def intent(kind, listing_id):
    return {"type": kind, "listing_id": listing_id}


class TradeRulesTests(unittest.TestCase):
    def test_pure_listing_buy_cancel_and_no_reservation(self):
        seller = domain.new_character("賣家", "smith", 1)
        buyer = domain.new_character("買家", "herbalist", 2)
        seller.update(x=-3)
        before = copy.deepcopy(seller)
        updated, other, offer, message = domain.apply_trade(seller, listing())
        self.assertEqual(seller, before)
        self.assertEqual(updated, seller)
        self.assertIsNone(other)
        self.assertTrue(message)
        offer["id"] = 1
        snapshot = copy.deepcopy((buyer, seller, offer))
        bought, sold, closed, _ = domain.apply_trade(buyer, intent("buy", 1), offer, seller)
        self.assertEqual((buyer, seller, offer), snapshot)
        self.assertEqual((bought["coins"], sold["coins"], closed["status"]), (7, 17, "sold"))
        self.assertEqual((bought["items"]["medicine"], sold["items"]["medicine"]), (1, 0))
        unchanged, other, cancelled, _ = domain.apply_trade(seller, intent("cancel", 1), offer)
        self.assertEqual(unchanged, seller)
        self.assertIsNone(other)
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual((buyer, seller, offer), snapshot)

    def test_refusals_do_not_mutate_inputs(self):
        seller = domain.new_character("賣家", "smith", 1)
        buyer = domain.new_character("買家", "herbalist", 2)
        offer = dict(id=1, seller_id=1, item="medicine", quantity=1, price=5, status="open")
        for actor, action, current, owner in [
            (seller, listing(quantity=True), None, None),
            (seller, listing(quantity=100), None, None),
            (seller, listing(item=[]), None, None),
            (buyer, intent("cancel", 1), offer, None),
            (seller, intent("buy", 1), offer, seller),
            (buyer, intent("buy", 1), dict(offer, status="sold"), seller),
            (buyer, intent("buy", 1), None, None),
            (buyer, intent("buy", 1), dict(offer, price=99), seller),
        ]:
            snapshot = copy.deepcopy((actor, action, current, owner))
            with self.assertRaises(domain.RuleError):
                domain.apply_trade(actor, action, current, owner)
            self.assertEqual((actor, action, current, owner), snapshot)


class TradingStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "trade.sqlite3"
        self.store = Store(self.path)
        self.people = []
        for name, profession in (("賣家", "smith"), ("買家", "herbalist"), ("買家二", "herbalist")):
            status, person = self.store.join(dict(name=name, profession=profession, join_id=str(uuid4())))
            self.assertEqual(status, 201)
            self.people.append(person)
        self.seller, self.buyer, self.third = self.people

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def act(self, person, action, action_id=None):
        return self.store.action(person["token"], dict(action_id=action_id or str(uuid4()), action=action))

    def create(self, action=None):
        status, result = self.act(self.seller, action or listing())
        self.assertEqual(status, 200, result)
        return result["listing_id"]

    def world(self):
        return [self.store.state(p["token"])[1] for p in self.people]

    def test_public_state_lists_all_statuses_in_id_order_without_tokens(self):
        first, second, third = self.create(), self.create(), self.create()
        self.assertEqual(self.act(self.buyer, intent("buy", first))[0], 200)
        self.assertEqual(self.act(self.seller, intent("cancel", second))[0], 200)
        public = self.store.state(self.buyer["token"])[1]
        self.assertEqual([r["id"] for r in public["listings"]], [first, second, third])
        self.assertEqual([r["status"] for r in public["listings"]], ["sold", "cancelled", "open"])
        self.assertEqual(set(public["listings"][0]), {"id", "seller_id", "seller_name", "item", "quantity", "price", "status"})
        self.assertEqual(public["listings"][0]["seller_name"], "賣家")
        for person in self.people:
            self.assertNotIn(person["token"], json.dumps(public))

    def test_a03_all_trade_receipts_replay_after_other_actions_and_reopen(self):
        receipts = []
        for kind in ("list", "cancel", "list", "buy"):
            person = self.buyer if kind == "buy" else self.seller
            action = listing() if kind == "list" else intent(kind, latest)
            aid = str(uuid4())
            original = self.act(person, action, aid)
            self.assertEqual(original[0], 200)
            receipts.append((person, action, aid, copy.deepcopy(original)))
            if kind == "list":
                latest = original[1]["listing_id"]
            self.assertEqual(self.act(person, move(-1))[0], 200)
        before = self.world()
        self.store.close()
        self.store = Store(self.path)
        for person, action, aid, original in receipts:
            for _ in range(3):
                self.assertEqual(self.act(person, action, aid), original)
            self.assertEqual(self.act(person, {"type": "gather"}, aid)[0], 409)
        self.assertEqual(self.world(), before)
        self.assertEqual(self.store.connection.execute("SELECT count(*) FROM listings").fetchone()[0], 2)

    def test_a05_buy_cancel_both_orderings_and_coin_supply(self):
        sold = self.create()
        self.assertEqual(self.act(self.buyer, intent("buy", sold))[0], 200)
        before = self.world()
        self.assertEqual(self.act(self.seller, intent("cancel", sold))[0], 400)
        self.assertEqual(self.world(), before)
        cancelled = self.act(self.buyer, listing())[1]["listing_id"]
        self.assertEqual(self.act(self.buyer, intent("cancel", cancelled))[0], 200)
        before = self.world()
        self.assertEqual(self.act(self.third, intent("buy", cancelled))[0], 400)
        self.assertEqual(self.world(), before)
        self.assertEqual(sum(s["state"]["coins"] for s in before), 36)
        for action in route("herbalist"):
            self.assertEqual(self.act(self.third, action)[0], 200)
        states = self.world()
        self.assertEqual(sum(s["state"]["coins"] for s in states), 12 * len(states) + 8 * sum(s["state"]["tower_reward_claimed"] for s in states))

    def test_a06_invalid_values_tokens_and_ownership_leave_world_unchanged(self):
        lid = self.create()
        actions = [listing(item="unknown"), listing(item=[]), dict(listing(), coins=100),
                   {"type": "list"}, intent("cancel", lid), {"type": ["buy"]}]
        for value in (-1, 0, 100, 10**100, True, 1.0, "1", None, [], {}):
            actions.extend((listing(quantity=value), listing(price=value)))
        for value in (-1, 0, 10**100, True, 1.0, "1", None, [], {}, 999999):
            actions.extend((intent("buy", value), intent("cancel", value)))
        before = self.world()
        for action in actions:
            with self.subTest(action=action):
                self.assertEqual(self.act(self.buyer, action)[0], 400)
                self.assertEqual(self.world(), before)
        self.assertEqual(self.act(self.seller, intent("buy", lid))[0], 400)
        self.assertEqual(self.store.action("forged", dict(action_id=str(uuid4()), action=intent("buy", lid)))[0], 401)
        self.assertEqual(self.world(), before)

    def test_whole_lot_total_price_limits_and_all_four_items(self):
        for item in domain.ITEMS:
            with self.subTest(item=item):
                with self.store.connection:
                    self.store.connection.execute("UPDATE items SET quantity=99 WHERE character_id=? AND item=?", (self.seller["state"]["id"], item))
                    self.store.connection.execute("UPDATE characters SET coins=99 WHERE id=?", (self.buyer["state"]["id"],))
                before = self.world()
                lid = self.create(listing(item, 99, 99))
                self.assertEqual(self.world()[0]["state"], before[0]["state"])
                self.assertEqual(self.act(self.buyer, intent("buy", lid))[0], 200)
                after = self.world()
                self.assertEqual(after[0]["state"]["items"][item], 0)
                self.assertEqual(after[1]["state"]["items"][item], before[1]["state"]["items"][item] + 99)
                self.assertEqual(after[1]["state"]["coins"], 0)
                self.assertEqual(after[0]["state"]["coins"], before[0]["state"]["coins"] + 99)
        with self.store.connection:
            self.store.connection.execute("UPDATE items SET quantity=1 WHERE character_id=? AND item='medicine'", (self.seller["state"]["id"],))
        self.create(listing(price=1))

    def test_stock_is_required_now_rechecked_on_purchase_and_never_reserved(self):
        before = self.world()
        self.assertEqual(self.act(self.seller, listing("ore"))[0], 400)
        self.assertEqual(self.world(), before)
        first, second = self.create(), self.create()
        self.assertEqual(self.act(self.buyer, intent("buy", first))[0], 200)
        before = self.world()
        self.assertEqual(self.act(self.third, intent("buy", second))[0], 400)
        self.assertEqual(self.world(), before)
        self.assertEqual(before[0]["listings"][1]["status"], "open")
        self.assertEqual(self.act(self.seller, intent("cancel", second))[0], 200)

    def test_insufficient_funds_refusal_receipt_stays_immutable_after_balance_changes(self):
        lid = self.create(listing(price=13))
        aid = str(uuid4())
        before = self.world()
        original = self.act(self.buyer, intent("buy", lid), aid)
        self.assertEqual(original[0], 400)
        self.assertEqual(self.world(), before)
        for action in route("herbalist"):
            self.assertEqual(self.act(self.buyer, action)[0], 200)
        self.assertEqual(self.act(self.buyer, intent("buy", lid), aid), original)
        self.assertEqual(self.act(self.buyer, intent("buy", lid))[0], 200)

    def test_atomic_rollback_at_seller_listing_and_receipt_writes(self):
        lid = self.create()
        for trigger in (
            f"BEFORE UPDATE ON characters WHEN OLD.id={self.seller['state']['id']}",
            "BEFORE UPDATE ON listings",
            "BEFORE INSERT ON log",
        ):
            with self.subTest(trigger=trigger):
                before = self.world()
                log_count = self.store.connection.execute("SELECT count(*) FROM log").fetchone()[0]
                self.store.connection.execute(f"CREATE TRIGGER fail_trade {trigger} BEGIN SELECT RAISE(ABORT, 'injected'); END")
                aid = str(uuid4())
                with self.assertRaises(sqlite3.IntegrityError):
                    self.act(self.buyer, intent("buy", lid), aid)
                self.assertEqual(self.world(), before)
                self.assertEqual(self.store.connection.execute("SELECT count(*) FROM log").fetchone()[0], log_count)
                self.store.connection.execute("DROP TRIGGER fail_trade")
        self.assertEqual(self.act(self.buyer, intent("buy", lid), aid)[0], 200)

    def test_list_and_cancel_roll_back_when_receipt_write_fails(self):
        lid = self.create()
        self.store.connection.execute("CREATE TRIGGER fail_receipt BEFORE INSERT ON log BEGIN SELECT RAISE(ABORT, 'injected'); END")
        for action in (listing(), intent("cancel", lid)):
            before = self.world()
            with self.assertRaises(sqlite3.IntegrityError):
                self.act(self.seller, action)
            self.assertEqual(self.world(), before)

    def test_a07_re1_database_upgrade_preserves_existing_state_and_receipts(self):
        aid = str(uuid4())
        old = self.act(self.seller, move(-1), aid)
        before = [p["state"] for p in self.world()]
        self.store.close()
        # RE-1 schema is identical except it has no listings table.
        with sqlite3.connect(self.path) as legacy:
            legacy.execute("DROP TABLE listings")
        self.store = Store(self.path)
        self.assertEqual([p["state"] for p in self.world()], before)
        self.assertEqual(self.act(self.seller, move(-1), aid), old)
        lid = self.create()
        before = self.world()
        self.store.close()
        self.store = Store(self.path)
        self.assertEqual(self.world(), before)
        self.assertEqual(self.act(self.buyer, intent("buy", lid))[0], 200)


class TradingHTTPTests(unittest.TestCase):
    setUp = test_backend.HTTPTests.setUp
    tearDown = test_backend.HTTPTests.tearDown
    request = test_backend.HTTPTests.request

    def join(self, name):
        status, result, _ = self.request("POST", "/api/join", dict(name=name, profession="herbalist", join_id=str(uuid4())))
        self.assertEqual(status, 201)
        return result["token"]

    def act(self, token, action):
        return self.request("POST", "/api/action", dict(action_id=str(uuid4()), action=action), {"Authorization": "Bearer " + token})

    def state(self, token):
        return self.request("GET", "/api/state", headers={"Authorization": "Bearer " + token})[1]

    def race(self, operations):
        barrier = threading.Barrier(len(operations))
        def run(operation):
            barrier.wait(timeout=5)
            return self.act(*operation)
        with ThreadPoolExecutor(max_workers=len(operations)) as pool:
            return list(pool.map(run, operations))

    def test_a04_concurrent_http_buyers_only_one_pays(self):
        buyers = [self.join("甲"), self.join("乙")]
        status, result, _ = self.act(self.token, listing())
        self.assertEqual(status, 200)
        results = self.race([(token, intent("buy", result["listing_id"])) for token in buyers])
        self.assertEqual(sorted(r[0] for r in results), [200, 400])
        states = [self.state(token)["state"] for token in buyers]
        self.assertEqual(sorted(s["coins"] for s in states), [7, 12])
        self.assertEqual(sum(s["items"]["medicine"] for s in states), 1)
        self.assertEqual(self.state(self.token)["state"]["coins"], 17)
        self.assertEqual(self.state(self.token)["listings"][0]["status"], "sold")

    def test_a05_concurrent_buy_cancel_only_one_effect(self):
        buyer = self.join("買家")
        status, result, _ = self.act(self.token, listing())
        self.assertEqual(status, 200)
        results = self.race([(buyer, intent("buy", result["listing_id"])), (self.token, intent("cancel", result["listing_id"]))])
        self.assertEqual(sorted(r[0] for r in results), [200, 400])
        seller_state, buyer_state = self.state(self.token), self.state(buyer)
        self.assertEqual(seller_state["state"]["coins"] + buyer_state["state"]["coins"], 24)
        outcome = seller_state["listings"][0]["status"]
        self.assertIn(outcome, ("sold", "cancelled"))
        self.assertEqual(buyer_state["state"]["coins"], 7 if outcome == "sold" else 12)
        self.assertEqual(buyer_state["state"]["items"]["medicine"], 1 if outcome == "sold" else 0)

    def test_a06_invalid_http_trading_does_not_change_world(self):
        buyer = self.join("買家")
        status, result, _ = self.act(self.token, listing())
        self.assertEqual(status, 200)
        before = [self.state(token) for token in (self.token, buyer)]
        for token, action, expected in (("forged", intent("buy", result["listing_id"]), 401),
                                       (buyer, intent("cancel", result["listing_id"]), 400),
                                       (buyer, intent("buy", 10**100), 400),
                                       (self.token, listing(quantity=True), 400),
                                       (self.token, listing(item="unknown"), 400)):
            self.assertEqual(self.act(token, action)[0], expected)
            self.assertEqual([self.state(t) for t in (self.token, buyer)], before)


class TradingProcessRestartTests(unittest.TestCase):
    def test_a07_process_restart_retains_three_statuses_and_exact_receipts(self):
        with tempfile.TemporaryDirectory() as temp:
            command = [sys.executable, str(ROOT / "server.py"), "--port", "0", "--db", str(Path(temp) / "world.sqlite3")]
            def start():
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                line = process.stdout.readline().strip()
                if not line.startswith("http://"):
                    process.terminate()
                    _, err = process.communicate(timeout=5)
                    self.fail(f"Server failed: {line} {err}")
                return process, int(line.rsplit(":", 1)[1])
            def request(path, body=None, token=None):
                import http.client
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                headers = {"Content-Type": "application/json"}
                if token:
                    headers["Authorization"] = "Bearer " + token
                conn.request("POST" if body is not None else "GET", path,
                             json.dumps(body) if body is not None else None, headers)
                response = conn.getresponse()
                result = response.status, json.loads(response.read())
                conn.close()
                return result
            receipts = []
            def act(token, action):
                body = dict(action_id=str(uuid4()), action=action)
                result = request("/api/action", body, token)
                receipts.append((token, body, copy.deepcopy(result)))
                return result
            process, port = start()
            try:
                people = []
                for name, profession in (("售", "smith"), ("購", "herbalist")):
                    status, person = request("/api/join", dict(name=name, profession=profession, join_id=str(uuid4())))
                    self.assertEqual(status, 201)
                    people.append(person["token"])
                seller, buyer = people
                lids = []
                for _ in range(3):
                    status, result = act(seller, listing())
                    self.assertEqual(status, 200)
                    lids.append(result["listing_id"])
                self.assertEqual(act(buyer, intent("buy", lids[0]))[0], 200)
                self.assertEqual(act(seller, intent("cancel", lids[1]))[0], 200)
                self.assertEqual(act(buyer, intent("buy", lids[2]))[0], 400)
                before = [request("/api/state", token=t) for t in people]
                self.assertEqual([row["status"] for row in before[0][1]["listings"]], ["sold", "cancelled", "open"])
            finally:
                process.terminate()
                process.communicate(timeout=5)
            process, port = start()
            try:
                self.assertEqual([request("/api/state", token=t) for t in people], before)
                for token, body, original in receipts:
                    self.assertEqual(request("/api/action", body, token), original)
                    conflict = dict(body, action={"type": "gather"})
                    self.assertEqual(request("/api/action", conflict, token)[0], 409)
                self.assertEqual([request("/api/state", token=t) for t in people], before)
            finally:
                process.terminate()
                process.communicate(timeout=5)
