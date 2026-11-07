---
{
  "schema_version": 2,
  "id": "combat-combat-deck-cycle",
  "title": "戰鬥牌組循環",
  "title_en": "Combat draw–discard cycles",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "planning",
    "randomness",
    "optimization"
  ],
  "summary": "每次出牌既解决眼前问题，也改变下一轮抽牌结构。",
  "note_status": "draft",
  "related": [
    "inventory-deck-thinning",
    "automation-aerial-logistics",
    "automation-belt-routing",
    "automation-blueprint-reuse"
  ],
  "sources": [
    {
      "title": "Combat draw–discard cycles — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-combat-deck-cycle/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「每次出牌既解决眼前问题，也改变下一轮抽牌结构。」
出處：`sources/text/combat-combat-deck-cycle.json` 字元 178-201 `summary.zh`
顯示：每次出牌既解決眼前問題，也改變下一輪抽牌結構。

## 規則

「从牌库抽取手牌，在能量限制内出牌；使用或未保留的牌进入弃牌区。抽牌堆耗尽后弃牌堆重新洗入，玩家通过过牌、保留和移除改变关键牌出现的频率。」
出處：`sources/text/combat-combat-deck-cycle.json` 字元 314-382 `rules.zh`
顯示：從牌庫抽取手牌，在能量限制內出牌；使用或未保留的牌進入棄牌區。抽牌堆耗盡後棄牌堆重新洗入，玩家通過過牌、保留和移除改變關鍵牌出現的頻率。

## 核心循環

「查看手牌与敌情」
出處：`sources/text/combat-combat-deck-cycle.json` 字元 633-640 `loop[0].zh`
顯示：查看手牌與敵情

「分配能量与出牌顺序」
出處：`sources/text/combat-combat-deck-cycle.json` 字元 708-717 `loop[1].zh`
顯示：分配能量與出牌順序

「弃牌并结束回合」
出處：`sources/text/combat-combat-deck-cycle.json` 字元 791-798 `loop[2].zh`
顯示：棄牌並結束回合

「抽取或重洗下一手」
出處：`sources/text/combat-combat-deck-cycle.json` 字元 866-874 `loop[3].zh`

## 玩家取捨

「本回合防守与快速过牌冲突：能否承受一点伤害换下一手关键组合？」
出處：`sources/text/combat-combat-deck-cycle.json` 字元 970-1000 `decisions[0].zh`
顯示：本回合防守與快速過牌衝突：能否承受一點傷害換下一手關鍵組合？

「一张强牌只有被抽到才有价值，精简与冗余各有代价。」
出處：`sources/text/combat-combat-deck-cycle.json` 字元 1133-1157 `decisions[1].zh`
顯示：一張強牌只有被抽到才有價值，精簡與冗餘各有代價。

## 可調參數

「手牌与能量比」
出處：`sources/text/combat-combat-deck-cycle.json` 字元 1330-1336 `parameters[0].name.zh`
顯示：手牌與能量比

「牌多能量少强调取舍，能量宽松则强调排序。」
出處：`sources/text/combat-combat-deck-cycle.json` 字元 1418-1438 `parameters[0].effect.zh`
顯示：牌多能量少強調取捨，能量寬鬆則強調排序。

「重洗节奏」
出處：`sources/text/combat-combat-deck-cycle.json` 字元 1597-1601 `parameters[1].name.zh`
顯示：重洗節奏

「小牌库更稳定，大牌库更需要搜索与冗余。」
出處：`sources/text/combat-combat-deck-cycle.json` 字元 1682-1701 `parameters[1].effect.zh`
顯示：小牌庫更穩定，大牌庫更需要搜索與冗餘。

## 原型

「做十张固定卡、一名显示意图的敌人、抽牌堆与弃牌堆。」
出處：`sources/text/combat-combat-deck-cycle.json` 字元 3286-3311 `prototype.firstStep.zh`
顯示：做十張固定卡、一名顯示意圖的敵人、抽牌堆與棄牌堆。

「观察玩家是否会为了下一轮少打一张牌，并能解释抽牌堆与弃牌堆的区别。」
出處：`sources/text/combat-combat-deck-cycle.json` 字元 3627-3660 `prototype.test.zh`
顯示：觀察玩家是否會爲了下一輪少打一張牌，並能解釋抽牌堆與棄牌堆的區別。

「先确认抽牌、弃牌、洗牌的时序；特殊效果太早加入会掩盖循环问题。」
出處：`sources/text/combat-combat-deck-cycle.json` 字元 3457-3488 `prototype.pitfall.zh`
顯示：先確認抽牌、棄牌、洗牌的時序；特殊效果太早加入會掩蓋循環問題。

## 相關模式

- [牌組抽疏](inventory-deck-thinning.md)
- [空中搬運物流](automation-aerial-logistics.md)
- [受限空間中的物流路由](automation-belt-routing.md)
- [藍圖重用](automation-blueprint-reuse.md)

## 參考來源

- [Combat draw–discard cycles — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-combat-deck-cycle/) — 查閱：2026-11-02；取得方式：page-text。
