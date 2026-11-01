#!/usr/bin/env python3
"""Bounded RE-3 strategy evidence, using real Store transactions.

Run under agent-workspace; --seeds 7 19 41 --scenarios complementary
same_profession unaffordable are the defaults. --max-steps defaults to 400.
Full JSON evidence goes to AGENT_EVIDENCE_DIR/simulation.json (or --output).
Stdout is a compact JSON summary and evidence path. Exit 0 means every requested
scenario met its expected outcome; budget exhaustion or invariant failure exits 1.
Steps count scheduled turns, including waits; counts track successful Store
operations. Wait trace entries are scheduler observations, not Store/API actions.
These operation counts are not human latency or estimates of play duration.
This scripted strategy is not evidence of human discovery, fun, or balance.
"""
import argparse
from collections import Counter, deque
from copy import deepcopy
import json
import os
from pathlib import Path
import random
import sys
import tempfile
from uuid import NAMESPACE_URL, uuid5

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from retro.store import Store

ITEMS = ("ore", "herb", "kit", "medicine")
SCENARIOS = ("complementary", "same_profession", "unaffordable")
STALL_LIMIT = 8


class InvariantError(ValueError):
    """Recorded behavior disagrees with independent expected accounting."""


def require(condition, message):
    if not condition:
        raise InvariantError(message)


def move(dx, dy=0):
    return {"type": "move", "dx": dx, "dy": dy}


def production(profession, quantity):
    dx, dy, distance, amount, item = ((-1, 0, 3, 2, "kit") if profession == "smith"
                                      else (0, 1, 4, 3, "medicine"))
    return ([move(dx, dy)] * distance + [{"type": "gather"}] * (amount * quantity)
            + [move(-dx, -dy)] * distance + [{"type": "craft", "item": item}] * quantity)


def snapshot(store, tokens):
    responses = [store.state(token) for token in tokens]
    require(all(status == 200 and result["ok"] for status, result in responses), "state read failed")
    listings = responses[0][1]["listings"] if responses else []
    require(all(result["listings"] == listings for _, result in responses), "market views disagree")
    return {"characters": [result["state"] for _, result in responses], "listings": listings}


class Accounting:
    """Independent oracle: uses no domain rule helpers and no DB writes.

    Sources, sinks and transfers are derived from action intent and the prior
    verified state, never from observed balance differences or reported totals.
    Full per-character comparisons catch transfers to the wrong recipient even
    when the global total remains conserved.
    """
    def __init__(self):
        self.world = {"characters": [], "listings": []}
        self.ledger = {"coins": {"grants": 0, "rewards": 0, "transferred": 0, "final": 0},
                       "items": {item: {"created": 0, "consumed": 0, "transferred": 0, "final": 0} for item in ITEMS}}
        self.rounds = {}
        self.reached = set()
        self.counts = Counter()
        self.waits = Counter()
        self.rejections = Counter()
        self.idle_steps = 0
        self.checks = 0

    def join(self, observed):
        characters = observed["characters"]
        require(len(characters) == len(self.world["characters"]) + 1, "join cardinality")
        person = characters[-1]
        require(person["profession"] in ("smith", "herbalist"), "join profession")
        starter = "medicine" if person["profession"] == "smith" else "kit"
        expected = {"id": len(characters), "name": person["name"], "profession": person["profession"],
                    "x": 0, "y": 0, "hp": 3, "coins": 12,
                    "items": {item: int(item == starter) for item in ITEMS},
                    "tower_stage": 0, "tower_reward_claimed": False}
        require(person == expected, "invalid join grants or state")
        require(characters[:-1] == self.world["characters"] and observed["listings"] == [], "join changed existing world")
        self.ledger["coins"]["grants"] += 12
        self.ledger["items"][starter]["created"] += 1
        self.rounds[str(person["id"])] = 0
        self.world = deepcopy(observed)
        self.check_totals()

    def check_totals(self):
        states = self.world["characters"]
        coins = self.ledger["coins"]
        coins["final"] = sum(state["coins"] for state in states)
        require(coins["final"] == coins["grants"] + coins["rewards"], "coin source invariant")
        require(coins["final"] == 12 * len(states) + 8 * sum(state["tower_reward_claimed"] for state in states), "reward flag invariant")
        for item in ITEMS:
            entry = self.ledger["items"][item]
            entry["final"] = sum(state["items"][item] for state in states)
            require(entry["final"] == entry["created"] - entry["consumed"], f"{item} source/sink invariant")
        for state in states:
            require(all(type(value) is int and value >= 0 for value in [state["coins"], *state["items"].values()]), "noninteger or negative balance")
        self.checks += 1

    def event(self, event):
        expected = deepcopy(self.world)
        actor_id, action = event["actor"], event["action"]
        person = next((s for s in expected["characters"] if s["id"] == actor_id), None)
        require(person is not None, "unknown actor")
        kind, result, status = action["type"], event["result"], event["status"]
        require(status in (200, 400), "unexpected service error")
        require(result["ok"] is (status == 200), "result status disagreement")
        if status == 400:
            require(kind == "buy", "unexpected strategy rejection")
            offer = next((row for row in expected["listings"] if row["id"] == action["listing_id"]), None)
            require(offer is not None and offer["status"] == "open" and person["coins"] < offer["price"], "unjustified purchase rejection")
            require(result["error"]["code"] == "insufficient_coins", "unexpected rejection code")
            self.rejections["insufficient_coins"] += 1
            self.waits["insufficient_coins"] += 1
            self.idle_steps += 1
        elif kind == "wait":
            needed = "medicine" if person["profession"] == "smith" else "kit"
            require(person["items"][needed] == 0, "wait despite available supply")
            require(not any(row["status"] == "open" and row["item"] == needed and row["seller_id"] != actor_id for row in expected["listings"]), "wait despite market offer")
            require(action["reason"] == "missing_complementary_supply", "invalid wait reason")
            self.waits[action["reason"]] += 1
            self.idle_steps += 1
        else:
            self.counts[kind] += 1
            self.idle_steps = 0
            items = person["items"]
            if kind == "gather":
                require((person["x"], person["y"]) in ((-3, 0), (0, 4)), "invalid gathering position")
                item = "ore" if person["x"] == -3 else "herb"
                items[item] += 1
                self.ledger["items"][item]["created"] += 1
            elif kind == "craft":
                require((person["x"], person["y"]) == (0, 0), "craft away from town")
                item, source, quantity = (("kit", "ore", 2) if person["profession"] == "smith" else ("medicine", "herb", 3))
                require(action["item"] == item and items[source] >= quantity, "invalid recipe")
                items[source] -= quantity
                items[item] += 1
                self.ledger["items"][source]["consumed"] += quantity
                self.ledger["items"][item]["created"] += 1
            elif kind == "move":
                x, y = person["x"], person["y"]
                dx, dy = action["dx"], action["dy"]
                target = x + dx, y + dy
                require(type(dx) is int and type(dy) is int and abs(dx) + abs(dy) == 1, "invalid edge")
                require((target[1] == 0 and -3 <= target[0] <= 4) or (target[0] == 0 and 1 <= target[1] <= 4), "move off map")
                if (x, y, *target) == (1, 0, 2, 0) and person["tower_stage"] == 0:
                    require(items["kit"] >= 1, "barrier passed without kit")
                    items["kit"] -= 1
                    self.ledger["items"]["kit"]["consumed"] += 1
                    person["tower_stage"] = 1
                if (x, y, *target) == (2, 0, 3, 0) and person["tower_stage"] < 2:
                    require(items["medicine"] >= 1, "strategy unexpectedly defeated")
                    items["medicine"] -= 1
                    self.ledger["items"]["medicine"]["consumed"] += 1
                    person["tower_stage"] = 2
                if target == (4, 0):
                    require(person["tower_stage"] == 2, "tower reached before encounter")
                    self.reached.add(actor_id)
                    if not person["tower_reward_claimed"]:
                        person["coins"] += 8
                        person["tower_reward_claimed"] = True
                        self.ledger["coins"]["rewards"] += 8
                person["x"], person["y"] = target
                if target == (0, 0):
                    person.update(hp=3, tower_stage=0)
                    if actor_id in self.reached:
                        self.rounds[str(actor_id)] += 1
                        self.reached.remove(actor_id)
            elif kind == "list":
                require(items[action["item"]] >= action["quantity"], "listed missing stock")
                lid = len(expected["listings"]) + 1
                require(result.get("listing_id") == lid, "listing receipt disagreement")
                expected["listings"].append({"id": lid, "seller_id": actor_id, "seller_name": person["name"],
                                            "item": action["item"], "quantity": action["quantity"], "price": action["price"], "status": "open"})
            elif kind == "buy":
                offer = next((row for row in expected["listings"] if row["id"] == action["listing_id"]), None)
                require(offer is not None and offer["status"] == "open" and offer["seller_id"] != actor_id, "invalid purchase")
                seller = next(s for s in expected["characters"] if s["id"] == offer["seller_id"])
                item, quantity, price = offer["item"], offer["quantity"], offer["price"]
                require(person["coins"] >= price and seller["items"][item] >= quantity, "purchase without funds/stock")
                person["coins"] -= price
                seller["coins"] += price
                items[item] += quantity
                seller["items"][item] -= quantity
                offer["status"] = "sold"
                self.ledger["coins"]["transferred"] += price
                self.ledger["items"][item]["transferred"] += quantity
            else:
                raise InvariantError(f"unknown recorded action: {kind}")
        require(event["world"] == expected, f"world mismatch at action {self.checks}: {kind}")
        require(result["state"] == person, f"receipt mismatch at action {self.checks}: {kind}")
        self.world = expected
        self.check_totals()

    def summary(self, max_steps, steps):
        complete = all(value == 3 for value in self.rounds.values())
        if complete:
            outcome, reason = "completed", "three_rounds_each"
        elif self.idle_steps >= STALL_LIMIT:
            outcome = "stalled"
            reason = "insufficient_coins" if self.rejections else "missing_complementary_supply"
        else:
            require(steps == max_steps, "simulation stopped before budget or terminal state")
            outcome, reason = "budget_exhausted", "step_limit"
        return {"outcome": outcome, "reason": reason, "rounds": dict(self.rounds),
                "counts": dict(sorted(self.counts.items())), "waits": dict(sorted(self.waits.items())),
                "rejections": dict(sorted(self.rejections.items())), "ledger": deepcopy(self.ledger),
                "final_balances": {str(s["id"]): s["coins"] for s in self.world["characters"]},
                "accounting_checks": self.checks}


def verify_report(report):
    """Recompute the entire report; do not trust its success or ledger fields."""
    audit = Accounting()
    require(report["scenario"] in SCENARIOS, "unknown scenario")
    require(type(report["seed"]) is int, "invalid seed")
    require(type(report["max_steps"]) is int and 1 <= report["max_steps"] <= 10000, "invalid step budget")
    require(report["target_rounds"] == 3 and report["stall_limit"] == STALL_LIMIT, "acceptance target changed")
    require(len(report["joins"]) == 2, "expected two joins")
    for world in report["joins"]:
        audit.join(world)
    professions = [s["profession"] for s in audit.world["characters"]]
    require(professions == (["smith", "smith"] if report["scenario"] == "same_profession" else ["smith", "herbalist"]), "scenario professions mismatch")
    require(report["steps"] == len(report["events"]) <= report["max_steps"], "step budget mismatch")
    for event in report["events"]:
        audit.event(event)
    for key, value in audit.summary(report["max_steps"], report["steps"]).items():
        require(report[key] == value, f"report {key} disagrees with trace")
    require(report["final_world"] == audit.world, "final world disagrees with trace")
    require(report["reopened_world"] == audit.world and report["reopen_consistent"] is True, "durable reopen disagreement")
    return True


class Strategy:
    def __init__(self, profession, price):
        self.profession, self.price = profession, price
        self.queue = deque(production(profession, 1))
        self.phase = "first_production"
        self.rounds = 0

    def next_action(self, state, listings):
        if self.queue:
            return self.queue.popleft()
        own, needed = (("kit", "medicine") if self.profession == "smith" else ("medicine", "kit"))
        if self.phase in ("first_production", "supplied"):
            self.queue.extend([move(1)] * 4 + [move(-1)] * 4)
            self.phase = "tower"
        elif self.phase == "tower":
            self.rounds += 1
            if self.rounds == 3:
                return None
            self.queue.extend(production(self.profession, 2))
            self.phase = "production"
        elif self.phase == "production":
            self.phase = "market"
            return {"type": "list", "item": own, "quantity": 1, "price": self.price}
        elif self.phase == "market":
            if state["items"][needed]:
                self.phase = "supplied"
            else:
                offer = next((row for row in listings if row["status"] == "open" and row["item"] == needed and row["seller_id"] != state["id"]), None)
                if offer:
                    return {"type": "buy", "listing_id": offer["id"]}
                return {"type": "wait", "reason": "missing_complementary_supply"}
        return self.next_action(state, listings)


def run_scenario(path, scenario="complementary", seed=7, max_steps=400):
    if scenario not in SCENARIOS or type(seed) is not int or type(max_steps) is not int or not 1 <= max_steps <= 10000:
        raise ValueError("invalid scenario, seed, or step budget (1..10000)")
    path = Path(path)
    # Exclusive creation prevents accidental use of an existing game database.
    with path.open("xb"):
        pass
    store = Store(path)
    audit, tokens = Accounting(), []
    report = {"scenario": scenario, "seed": seed, "target_rounds": 3, "max_steps": max_steps,
              "stall_limit": STALL_LIMIT, "joins": [], "events": []}
    professions = ["smith", "smith" if scenario == "same_profession" else "herbalist"]
    strategies = [Strategy(profession, 99 if scenario == "unaffordable" else 3) for profession in professions]
    rng = random.Random(seed)
    try:
        for index, profession in enumerate(professions):
            status, result = store.join({"name": f"actor-{index + 1}", "profession": profession,
                                         "join_id": str(uuid5(NAMESPACE_URL, f"re3/{scenario}/{seed}/join/{index}"))})
            require(status == 201 and result["ok"], "join failed")
            tokens.append(result["token"])
            world = snapshot(store, tokens)
            audit.join(world)
            report["joins"].append(world)
        finished = False
        while not finished and len(report["events"]) < max_steps:
            order = list(range(2))
            rng.shuffle(order)
            for index in order:
                state = audit.world["characters"][index]
                action = strategies[index].next_action(state, audit.world["listings"])
                if action is None:
                    continue
                if action["type"] == "wait":
                    status, result = 200, {"ok": True, "state": deepcopy(state)}
                else:
                    status, result = store.action(tokens[index], {"action_id": str(uuid5(NAMESPACE_URL, f"re3/{scenario}/{seed}/action/{len(report['events'])}")), "action": action})
                event = {"actor": state["id"], "action": action, "status": status,
                         "result": result, "world": snapshot(store, tokens)}
                audit.event(event)
                report["events"].append(event)
                if all(rounds == 3 for rounds in audit.rounds.values()) or audit.idle_steps >= STALL_LIMIT or len(report["events"]) == max_steps:
                    finished = True
                    break
        report["steps"] = len(report["events"])
        report.update(audit.summary(max_steps, report["steps"]))
        report["final_world"] = snapshot(store, tokens)
        store.close()
        store = Store(path)
        report["reopened_world"] = snapshot(store, tokens)
        report["reopen_consistent"] = report["final_world"] == report["reopened_world"]
        verify_report(report)
        return report
    finally:
        store.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=int, nargs="+", default=[7, 19, 41])
    parser.add_argument("--scenarios", choices=SCENARIOS, nargs="+", default=list(SCENARIOS))
    parser.add_argument("--max-steps", type=int, default=400)
    parser.add_argument("--output", type=Path, help="full JSON trace path (must not already exist)")
    args = parser.parse_args(argv)
    build = os.environ.get("AGENT_BUILD_DIR")
    if not build:
        parser.error("run through agent-workspace so disposable databases stay under AGENT_BUILD_DIR")
    evidence = os.environ.get("AGENT_EVIDENCE_DIR")
    if args.output is None and not evidence:
        parser.error("AGENT_EVIDENCE_DIR or --output is required to preserve full evidence")
    output = args.output if args.output is not None else Path(evidence) / "simulation.json"
    try:
        if output.exists():
            raise FileExistsError(f"refusing to overwrite evidence: {output}")
        with tempfile.TemporaryDirectory(prefix="re3-simulation-", dir=build) as directory:
            runs = [run_scenario(Path(directory) / f"run-{index}.sqlite3", scenario, seed, args.max_steps)
                    for index, (scenario, seed) in enumerate((scenario, seed) for scenario in args.scenarios for seed in args.seeds)]
        expected = {"complementary": ("completed", "three_rounds_each", 3),
                    "same_profession": ("stalled", "missing_complementary_supply", 1),
                    "unaffordable": ("stalled", "insufficient_coins", 1)}
        accepted = all((run["outcome"], run["reason"]) == expected[run["scenario"]][:2]
                       and all(rounds == expected[run["scenario"]][2] for rounds in run["rounds"].values())
                       for run in runs)
        with output.open("x", encoding="utf-8") as stream:
            json.dump({"schema": "re3-strategy-v1", "accepted": accepted, "runs": runs}, stream, sort_keys=True, separators=(",", ":"))
            stream.write("\n")
        keys = ("scenario", "seed", "outcome", "reason", "steps", "rounds", "counts", "waits", "rejections", "final_balances", "accounting_checks")
        print(json.dumps({"accepted": accepted, "evidence_path": str(output.resolve()),
                          "runs": [{key: run[key] for key in keys} for run in runs]}, sort_keys=True))
        return 0 if accepted else 1
    except (InvariantError, ValueError, OSError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
