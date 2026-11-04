---
{
  "schema_version": 2,
  "id": "combat-intent-preview",
  "title": "意圖預覽",
  "title_en": "Previewing enemy intent",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "information",
    "planning",
    "risk"
  ],
  "summary": "先知道威胁，再用有限行动改变将要发生的事。",
  "note_status": "draft",
  "related": [
    "combat-cover-flanking",
    "combat-destructible-cover",
    "combat-forced-movement",
    "combat-friendly-fire"
  ],
  "sources": [
    {
      "title": "Previewing enemy intent — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-intent-preview/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先知道威胁，再用有限行动改变将要发生的事。」
出處：`sources/text/combat-intent-preview.json` 字元 175-196 `summary.zh`
顯示：先知道威脅，再用有限行動改變將要發生的事。

## 規則

「敌人行动前显示下一次攻击的目标、范围或伤害。玩家据此选择防御、击杀、移动或打断，回合结算后检查危险是否解除。可见的信息必须可靠；不公开的部分也要明确标示，才会形成能推理的局面。」
出處：`sources/text/combat-intent-preview.json` 字元 308-396 `rules.zh`
顯示：敵人行動前顯示下一次攻擊的目標、範圍或傷害。玩家據此選擇防禦、擊殺、移動或打斷，回合結算後檢查危險是否解除。可見的信息必須可靠；不公開的部分也要明確標示，纔會形成能推理的局面。

## 核心循環

「读出即将发生的攻击」
出處：`sources/text/combat-intent-preview.json` 字元 660-669 `loop[0].zh`
顯示：讀出即將發生的攻擊

「比较可用应对」
出處：`sources/text/combat-intent-preview.json` 字元 733-739 `loop[1].zh`
顯示：比較可用應對

「花行动改变局面」
出處：`sources/text/combat-intent-preview.json` 字元 810-817 `loop[2].zh`
顯示：花行動改變局面

「结算并读取新威胁」
出處：`sources/text/combat-intent-preview.json` 字元 898-906 `loop[3].zh`
顯示：結算並讀取新威脅

## 玩家取捨

「挡住伤害，还是先消灭威胁最大的敌人？」
出處：`sources/text/combat-intent-preview.json` 字元 1003-1021 `decisions[0].zh`
顯示：擋住傷害，還是先消滅威脅最大的敵人？

「救自己，还是保护这一回合受到攻击的目标？」
出處：`sources/text/combat-intent-preview.json` 字元 1120-1140 `decisions[1].zh`
顯示：救自己，還是保護這一回合受到攻擊的目標？

## 可調參數

「预告精度」
出處：`sources/text/combat-intent-preview.json` 字元 1278-1282 `parameters[0].name.zh`
顯示：預告精度

「只给攻击类型会保留猜测；给出目标和数值更适合精确解题。」
出處：`sources/text/combat-intent-preview.json` 字元 1358-1385 `parameters[0].effect.zh`
顯示：只給攻擊類型會保留猜測；給出目標和數值更適合精確解題。

「应对行动数量」
出處：`sources/text/combat-intent-preview.json` 字元 1555-1561 `parameters[1].name.zh`
顯示：應對行動數量

「行动越少，越需要挑选真正值得解除的威胁。」
出處：`sources/text/combat-intent-preview.json` 字元 1638-1658 `parameters[1].effect.zh`
顯示：行動越少，越需要挑選真正值得解除的威脅。

## 原型

「用一张小网格、两类敌人和“移动／攻击／防御”做三回合战斗。」
出處：`sources/text/combat-intent-preview.json` 字元 3021-3050 `prototype.firstStep.zh`
顯示：用一張小網格、兩類敵人和“移動／攻擊／防禦”做三回合戰鬥。

「观察试玩者能否在结算前说出自己为什么安全，失败后能否解释原因。」
出處：`sources/text/combat-intent-preview.json` 字元 3319-3350 `prototype.test.zh`
顯示：觀察試玩者能否在結算前說出自己爲什麼安全，失敗後能否解釋原因。

「预告与实际结果不一致，会让玩家觉得自己被规则欺骗。」
出處：`sources/text/combat-intent-preview.json` 字元 3188-3213 `prototype.pitfall.zh`
顯示：預告與實際結果不一致，會讓玩家覺得自己被規則欺騙。

## 相關模式

- [掩體側擊](combat-cover-flanking.md)
- [可破壞掩體](combat-destructible-cover.md)
- [強制移動](combat-forced-movement.md)
- [範圍攻擊的友方誤傷](combat-friendly-fire.md)

## 參考來源

- [Previewing enemy intent — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-intent-preview/) — 查閱：2026-11-02；取得方式：page-text。
