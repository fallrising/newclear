"""Pure RE-0 rules. Inputs remain untouched on success and rejection."""
from copy import deepcopy

ITEMS = ("ore", "herb", "kit", "medicine")
POSITIONS = frozenset({(x, 0) for x in range(-3, 5)} | {(0, y) for y in range(1, 5)})


class RuleError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def new_character(name, profession, character_id=0):
    if profession not in ("smith", "herbalist"):
        raise RuleError("invalid_profession", "請選擇鐵匠或藥師。")
    items = dict.fromkeys(ITEMS, 0)
    items["medicine" if profession == "smith" else "kit"] = 1
    return {"id": character_id, "name": name, "profession": profession,
            "x": 0, "y": 0, "hp": 3, "coins": 12, "items": items,
            "tower_stage": 0, "tower_reward_claimed": False}


def apply_action(state, action):
    if not isinstance(action, dict) or not isinstance(action.get("type"), str):
        raise RuleError("invalid_action", "動作格式不正確。")
    kind = action["type"]
    fields = {"move": {"type", "dx", "dy"}, "gather": {"type"}, "craft": {"type", "item"}}
    if kind not in fields or set(action) != fields[kind]:
        raise RuleError("invalid_action", "動作含有缺少或不支援的欄位。")
    result = deepcopy(state)
    x, y = state["x"], state["y"]
    if kind == "move":
        dx, dy = action["dx"], action["dy"]
        if type(dx) is not int or type(dy) is not int or abs(dx) + abs(dy) != 1:
            raise RuleError("invalid_move", "每次只能沿道路走一格。")
        target = (x + dx, y + dy)
        if target not in POSITIONS:
            raise RuleError("invalid_move", "那裡沒有道路。")
        message = "前進一格。"
        if (x, y) == (1, 0) and target == (2, 0) and state["tower_stage"] < 1:
            if state["items"]["kit"] < 1:
                raise RuleError("missing_kit", "路障需要一份修補組，請先回鎮準備。")
            result["items"]["kit"] -= 1
            result["tower_stage"] = 1
            message = "消耗一份修補組，修好了路障。"
        if (x, y) == (2, 0) and target == (3, 0) and state["tower_stage"] < 2:
            if state["items"]["medicine"] < 1:
                result.update(x=0, y=0, hp=3, tower_stage=0)
                return result, "缺少行路藥，遭遇敗退；已回鎮恢復生命。修補組不退還。"
            result["items"]["medicine"] -= 1
            result["tower_stage"] = 2
            message = "消耗一份行路藥，順利通過遭遇。"
        if target == (4, 0):
            if state["tower_stage"] != 2:
                raise RuleError("tower_locked", "請先通過路障與遭遇。")
            if not state["tower_reward_claimed"]:
                result["coins"] += 8
                result["tower_reward_claimed"] = True
                message = "抵達塔頂！獲得首次獎勵 8 枚貨幣。之後重走不再發獎。"
            else:
                message = "再次抵達塔頂；首次獎勵已領取。"
        result["x"], result["y"] = target
        if target == (0, 0):
            result.update(hp=3, tower_stage=0)
            message = "回到霧岸鎮，生命恢復；本輪塔路進度已重設。"
        return result, message
    if kind == "gather":
        if (x, y) == (-3, 0):
            result["items"]["ore"] += 1
            return result, "採得一份礦石。"
        if (x, y) == (0, 4):
            result["items"]["herb"] += 1
            return result, "採得一份藥草。"
        raise RuleError("wrong_location", "請到礫坡或潮林終點採集。")
    item = action["item"]
    own_item, ingredient, amount = ("kit", "ore", 2) if state["profession"] == "smith" else ("medicine", "herb", 3)
    if item != own_item:
        raise RuleError("wrong_profession", "只能製作自己職業的配方。")
    if (x, y) != (0, 0):
        raise RuleError("wrong_location", "請回霧岸鎮製作。")
    if state["items"][ingredient] < amount:
        raise RuleError("missing_material", "原料不足：修補組需要 2 礦石，行路藥需要 3 藥草。")
    result["items"][ingredient] -= amount
    result["items"][own_item] += 1
    return result, "製作完成：一份修補組。" if own_item == "kit" else "製作完成：一份行路藥。"


def validate_trade(action):
    """Validate untrusted values before the persistence layer uses an ID."""
    fields = {"list": {"type", "item", "quantity", "price"},
              "buy": {"type", "listing_id"}, "cancel": {"type", "listing_id"}}
    if (not isinstance(action, dict) or not isinstance(action.get("type"), str)
            or action["type"] not in fields or set(action) != fields[action["type"]]):
        raise RuleError("invalid_action", "交易動作含有缺少或不支援的欄位。")
    if action["type"] == "list":
        if action["item"] not in ITEMS:
            raise RuleError("invalid_item", "只能掛售礦石、藥草、修補組或行路藥。")
        if any(type(action[key]) is not int or not 1 <= action[key] <= 99
               for key in ("quantity", "price")):
            raise RuleError("invalid_amount", "數量與整筆總價必須是 1 至 99 的整數。")
    elif type(action["listing_id"]) is not int or not 1 <= action["listing_id"] <= 2**63 - 1:
        raise RuleError("invalid_listing", "掛單識別碼必須是有效的正整數。")
    return action["type"]


def apply_trade(actor, action, listing=None, seller=None):
    """Return actor, optional seller, listing and message without input mutation.

    Listings do not reserve inventory. A purchase transfers an entire lot for
    the listed total price, with every economic precondition checked first.
    """
    kind = validate_trade(action)
    if kind == "list":
        if actor["items"][action["item"]] < action["quantity"]:
            raise RuleError("missing_stock", "持有物品不足，無法掛單。")
        offer = {"seller_id": actor["id"], "item": action["item"],
                 "quantity": action["quantity"], "price": action["price"], "status": "open"}
        return deepcopy(actor), None, offer, "掛單完成；物品不預扣，購買時會再次檢查庫存。"
    if listing is None or listing["id"] != action["listing_id"]:
        raise RuleError("listing_not_found", "找不到這筆掛單。")
    if listing["status"] != "open":
        raise RuleError("listing_closed", "這筆掛單已售出或取消，請更新交易列表。")
    if kind == "cancel":
        if listing["seller_id"] != actor["id"]:
            raise RuleError("not_seller", "只能取消自己的掛單。")
        closed = deepcopy(listing)
        closed["status"] = "cancelled"
        return deepcopy(actor), None, closed, "掛單已取消，物品與貨幣沒有變動。"
    if listing["seller_id"] == actor["id"]:
        raise RuleError("own_listing", "不能購買自己的掛單。")
    if seller is None or seller["id"] != listing["seller_id"]:
        raise RuleError("listing_not_found", "找不到這筆掛單的賣家。")
    if actor["coins"] < listing["price"]:
        raise RuleError("insufficient_coins", "貨幣不足以購買整筆掛單。")
    item, quantity, price = listing["item"], listing["quantity"], listing["price"]
    if seller["items"][item] < quantity:
        raise RuleError("missing_stock", "賣家目前庫存不足，掛單仍然開放。")
    bought, sold, closed = deepcopy(actor), deepcopy(seller), deepcopy(listing)
    bought["coins"] -= price
    sold["coins"] += price
    bought["items"][item] += quantity
    sold["items"][item] -= quantity
    closed["status"] = "sold"
    return bought, sold, closed, "購買完成，整筆物品與貨幣已轉移。"
