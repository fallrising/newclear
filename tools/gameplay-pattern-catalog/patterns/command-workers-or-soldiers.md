---
{
  "schema_version": 2,
  "id": "command-workers-or-soldiers",
  "title": "勞力與兵力的分配",
  "title_en": "Allocate people between work and combat",
  "category": "command",
  "source_category": "command",
  "tags": [
    "economy",
    "planning"
  ],
  "summary": "多一个作战单位，可能就少一个持续创造资源的人。",
  "note_status": "draft",
  "related": [
    "command-focus-fire",
    "command-frontline-shielding",
    "command-initiative-order",
    "command-prebattle-formation"
  ],
  "sources": [
    {
      "title": "Allocate people between work and combat — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/command-workers-or-soldiers/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「多一个作战单位，可能就少一个持续创造资源的人。」
出處：`sources/text/command-workers-or-soldiers.json` 字元 200-223 `summary.zh`
顯示：多一個作戰單位，可能就少一個持續創造資源的人。

## 規則

「生产者提供未来收入，战斗者提供眼前保护或扩张，两者争用人口、训练资源或同一批人员。玩家根据外部压力调整比例；生产变化和战斗结果共同反馈这次选择是否可持续。」
出處：`sources/text/command-workers-or-soldiers.json` 字元 321-398 `rules.zh`
顯示：生產者提供未來收入，戰鬥者提供眼前保護或擴張，兩者爭用人口、訓練資源或同一批人員。玩家根據外部壓力調整比例；生產變化和戰鬥結果共同反饋這次選擇是否可持續。

## 核心循環

「查看收入与外部威胁」
出處：`sources/text/command-workers-or-soldiers.json` 字元 684-693 `loop[0].zh`
顯示：查看收入與外部威脅

「增加生产者或战斗者」
出處：`sources/text/command-workers-or-soldiers.json` 字元 763-772 `loop[1].zh`
顯示：增加生產者或戰鬥者

「承受短期强弱变化」
出處：`sources/text/command-workers-or-soldiers.json` 字元 839-847 `loop[2].zh`
顯示：承受短期強弱變化

「按新资源与威胁再分配」
出處：`sources/text/command-workers-or-soldiers.json` 字元 922-932 `loop[3].zh`
顯示：按新資源與威脅再分配

## 玩家取捨

「现在多训练工人让以后更强，是否来得及抵挡下一次进攻？」
出處：`sources/text/command-workers-or-soldiers.json` 字元 1040-1066 `decisions[0].zh`
顯示：現在多訓練工人讓以後更強，是否來得及抵擋下一次進攻？

「打完仗后保留军队威慑，还是让更多人口恢复生产？」
出處：`sources/text/command-workers-or-soldiers.json` 字元 1169-1192 `decisions[1].zh`
顯示：打完仗後保留軍隊威懾，還是讓更多人口恢復生產？

## 可調參數

「转职或训练成本」
出處：`sources/text/command-workers-or-soldiers.json` 字元 1337-1344 `parameters[0].name.zh`
顯示：轉職或訓練成本

「成本低允许临时应急；成本高让扩军变成长期承诺。」
出處：`sources/text/command-workers-or-soldiers.json` 字元 1433-1456 `parameters[0].effect.zh`
顯示：成本低允許臨時應急；成本高讓擴軍變成長期承諾。

「压力到达时间」
出處：`sources/text/command-workers-or-soldiers.json` 字元 1610-1616 `parameters[1].name.zh`
顯示：壓力到達時間

「提前预告让玩家能规划，完全随机容易让经济选择沦为猜运气。」
出處：`sources/text/command-workers-or-soldiers.json` 字元 1697-1725 `parameters[1].effect.zh`
顯示：提前預告讓玩家能規劃，完全隨機容易讓經濟選擇淪爲猜運氣。

## 原型

「用人口标记切换工人和守卫，配一条收入条和定时威胁。」
出處：`sources/text/command-workers-or-soldiers.json` 字元 3086-3111 `prototype.firstStep.zh`
顯示：用人口標記切換工人和守衛，配一條收入條和定時威脅。

「玩家会不会因预告中的敌情改变人口分配？」
出處：`sources/text/command-workers-or-soldiers.json` 字元 3414-3433 `prototype.test.zh`
顯示：玩家會不會因預告中的敵情改變人口分配？

「初版不要同时加入复杂科技、补给和多资源市场。」
出處：`sources/text/command-workers-or-soldiers.json` 字元 3262-3284 `prototype.pitfall.zh`
顯示：初版不要同時加入複雜科技、補給和多資源市場。

## 相關模式

- [集中火力決策](command-focus-fire.md)
- [前線掩護](command-frontline-shielding.md)
- [先攻順序](command-initiative-order.md)
- [戰前陣型](command-prebattle-formation.md)

## 參考來源

- [Allocate people between work and combat — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/command-workers-or-soldiers/) — 查閱：2026-11-02；取得方式：page-text。
