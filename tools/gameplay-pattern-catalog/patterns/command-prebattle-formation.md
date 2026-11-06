---
{
  "schema_version": 2,
  "id": "command-prebattle-formation",
  "title": "戰前陣型",
  "title_en": "Arrange before combat, then observe",
  "category": "command",
  "source_category": "command",
  "tags": [
    "planning",
    "spatial"
  ],
  "summary": "把操作重点放在开战前的一次布置。",
  "note_status": "draft",
  "related": [
    "command-frontline-shielding",
    "command-split-objectives",
    "combat-action-points",
    "combat-cover-flanking"
  ],
  "sources": [
    {
      "title": "Arrange before combat, then observe — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/command-prebattle-formation/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把操作重点放在开战前的一次布置。」
出處：`sources/text/command-prebattle-formation.json` 字元 198-214 `summary.zh`
顯示：把操作重點放在開戰前的一次佈置。

## 規則

「玩家在准备阶段调整单位位置和装备，开战后单位按自动规则行动。结果会暴露谁先接敌、谁被包围、谁没来得及输出；下一轮再通过布阵修正，而不是在战斗中逐个下指令。」
出處：`sources/text/command-prebattle-formation.json` 字元 304-381 `rules.zh`
顯示：玩家在準備階段調整單位位置和裝備，開戰後單位按自動規則行動。結果會暴露誰先接敵、誰被包圍、誰沒來得及輸出；下一輪再通過佈陣修正，而不是在戰鬥中逐個下指令。

## 核心循環

「观察对手与上一轮失败点」
出處：`sources/text/command-prebattle-formation.json` 字元 645-656 `loop[0].zh`
顯示：觀察對手與上一輪失敗點

「调整初始阵型」
出處：`sources/text/command-prebattle-formation.json` 字元 735-741 `loop[1].zh`
顯示：調整初始陣型

「让战斗自动结算」
出處：`sources/text/command-prebattle-formation.json` 字元 810-817 `loop[2].zh`
顯示：讓戰鬥自動結算

「把结果用于下一次布阵」
出處：`sources/text/command-prebattle-formation.json` 字元 893-903 `loop[3].zh`
顯示：把結果用於下一次佈陣

## 玩家取捨

「集中保护核心单位，还是分散防止一起吃范围伤害？」
出處：`sources/text/command-prebattle-formation.json` 字元 1001-1024 `decisions[0].zh`
顯示：集中保護核心單位，還是分散防止一起喫範圍傷害？

「针对眼前对手调整，会不会暴露给另一种阵容？」
出處：`sources/text/command-prebattle-formation.json` 字元 1131-1152 `decisions[1].zh`
顯示：針對眼前對手調整，會不會暴露給另一種陣容？

## 可調參數

「准备时间」
出處：`sources/text/command-prebattle-formation.json` 字元 1293-1297 `parameters[0].name.zh`
顯示：準備時間

「时间短强调快速识别，时间长允许仔细比较阵型。」
出處：`sources/text/command-prebattle-formation.json` 字元 1375-1397 `parameters[0].effect.zh`
顯示：時間短強調快速識別，時間長允許仔細比較陣型。

「战斗回放信息」
出處：`sources/text/command-prebattle-formation.json` 字元 1540-1546 `parameters[1].name.zh`
顯示：戰鬥回放信息

「显示目标与伤害去向，才能把失败转成下一轮可执行的调整。」
出處：`sources/text/command-prebattle-formation.json` 字元 1623-1650 `parameters[1].effect.zh`
顯示：顯示目標與傷害去向，才能把失敗轉成下一輪可執行的調整。

## 原型

「四个自动攻击单位，一块小棋盘，先只做布置与开战两个阶段。」
出處：`sources/text/command-prebattle-formation.json` 字元 2974-3002 `prototype.firstStep.zh`
顯示：四個自動攻擊單位，一塊小棋盤，先只做佈置與開戰兩個階段。

「只换站位不换数值，玩家能否解释结果为何变化？」
出處：`sources/text/command-prebattle-formation.json` 字元 3274-3296 `prototype.test.zh`
顯示：只換站位不換數值，玩家能否解釋結果爲何變化？

「路径与选目标规则若不可理解，玩家只能盲猜阵型。」
出處：`sources/text/command-prebattle-formation.json` 字元 3133-3156 `prototype.pitfall.zh`
顯示：路徑與選目標規則若不可理解，玩家只能盲猜陣型。

## 相關模式

- [前線掩護](command-frontline-shielding.md)
- [分工目標組](command-split-objectives.md)
- [行動點數](combat-action-points.md)
- [掩體側擊](combat-cover-flanking.md)

## 參考來源

- [Arrange before combat, then observe — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/command-prebattle-formation/) — 查閱：2026-11-02；取得方式：page-text。
