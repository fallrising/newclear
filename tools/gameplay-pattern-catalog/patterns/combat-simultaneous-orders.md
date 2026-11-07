---
{
  "schema_version": 2,
  "id": "combat-simultaneous-orders",
  "title": "同時指令",
  "title_en": "Simultaneous planned orders",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "planning",
    "time",
    "information"
  ],
  "summary": "先排好几秒动作，再观看双方计划撞在一起。",
  "note_status": "draft",
  "related": [
    "combat-pause-orders",
    "combat-intent-preview",
    "combat-action-points",
    "combat-combat-deck-cycle"
  ],
  "sources": [
    {
      "title": "Simultaneous planned orders — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-simultaneous-orders/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先排好几秒动作，再观看双方计划撞在一起。」
出處：`sources/text/combat-simultaneous-orders.json` 字元 186-206 `summary.zh`
顯示：先排好幾秒動作，再觀看雙方計劃撞在一起。

## 規則

「战斗分成规划与执行两段。规划时为单位安排移动、瞄准或攻击；确认后双方在同一时间段一起执行，过程中不能随时改令。执行完重新观察，再规划下一段。敌方计划可隐藏，也可部分公开，难点随之变化。」
出處：`sources/text/combat-simultaneous-orders.json` 字元 311-403 `rules.zh`
顯示：戰鬥分成規劃與執行兩段。規劃時爲單位安排移動、瞄準或攻擊；確認後雙方在同一時間段一起執行，過程中不能隨時改令。執行完重新觀察，再規劃下一段。敵方計劃可隱藏，也可部分公開，難點隨之變化。

## 核心循環

「观察当前局面」
出處：`sources/text/combat-simultaneous-orders.json` 字元 708-714 `loop[0].zh`
顯示：觀察當前局面

「安排动作及时间」
出處：`sources/text/combat-simultaneous-orders.json` 字元 779-786 `loop[1].zh`
顯示：安排動作及時間

「确认后同时执行」
出處：`sources/text/combat-simultaneous-orders.json` 字元 857-864 `loop[2].zh`
顯示：確認後同時執行

「复盘再规划」
出處：`sources/text/combat-simultaneous-orders.json` 字元 935-940 `loop[3].zh`
顯示：覆盤再規劃

## 玩家取捨

「先停下瞄准，还是抢先穿过对手射线？」
出處：`sources/text/combat-simultaneous-orders.json` 字元 1026-1043 `decisions[0].zh`
顯示：先停下瞄準，還是搶先穿過對手射線？

「按最可能的敌方计划下注，还是牺牲效率防住多个可能？」
出處：`sources/text/combat-simultaneous-orders.json` 字元 1128-1153 `decisions[1].zh`
顯示：按最可能的敵方計劃下注，還是犧牲效率防住多個可能？

## 可調參數

「执行片段长度」
出處：`sources/text/combat-simultaneous-orders.json` 字元 1304-1310 `parameters[0].name.zh`
顯示：執行片段長度

「片段越长，承诺越重，也越难看懂失误发生在哪一刻。」
出處：`sources/text/combat-simultaneous-orders.json` 字元 1390-1414 `parameters[0].effect.zh`
顯示：片段越長，承諾越重，也越難看懂失誤發生在哪一刻。

「敌方计划可见度」
出處：`sources/text/combat-simultaneous-orders.json` 字元 1560-1567 `parameters[1].name.zh`
顯示：敵方計劃可見度

「隐藏计划偏预测博弈，公开计划偏时间和空间排程。」
出處：`sources/text/combat-simultaneous-orders.json` 字元 1650-1673 `parameters[1].effect.zh`
顯示：隱藏計劃偏預測博弈，公開計劃偏時間和空間排程。

## 原型

「先用两名单位、离散时间格和固定敌方计划做一个房间，不做自由物理或联网。」
出處：`sources/text/combat-simultaneous-orders.json` 字元 3068-3103 `prototype.firstStep.zh`
顯示：先用兩名單位、離散時間格和固定敵方計劃做一個房間，不做自由物理或聯網。

「检查玩家能否从回放指出哪一秒出错，并修改那一段获得不同结果。」
出處：`sources/text/combat-simultaneous-orders.json` 字元 3429-3459 `prototype.test.zh`
顯示：檢查玩家能否從回放指出哪一秒出錯，並修改那一段獲得不同結果。

「规划预览与实际执行若使用不同规则，玩家无法信任时间轴。」
出處：`sources/text/combat-simultaneous-orders.json` 字元 3270-3297 `prototype.pitfall.zh`
顯示：規劃預覽與實際執行若使用不同規則，玩家無法信任時間軸。

## 相關模式

- [暫停指令](combat-pause-orders.md)
- [意圖預覽](combat-intent-preview.md)
- [行動點數](combat-action-points.md)
- [戰鬥牌組循環](combat-combat-deck-cycle.md)

## 參考來源

- [Simultaneous planned orders — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-simultaneous-orders/) — 查閱：2026-11-02；取得方式：page-text。
