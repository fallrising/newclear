---
{
  "schema_version": 2,
  "id": "stealth-synchronized-actions",
  "title": "同步動作",
  "title_en": "Queued synchronized actions",
  "category": "stealth",
  "source_category": "stealth",
  "tags": [
    "planning",
    "timing",
    "spatial"
  ],
  "summary": "先给几名队员安排动作，再一口气处理互相照应的守卫。",
  "note_status": "draft",
  "related": [
    "exploration-stealth-awareness",
    "stealth-body-concealment",
    "stealth-light-shadow",
    "stealth-sound-lures"
  ],
  "sources": [
    {
      "title": "Queued synchronized actions — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/stealth-synchronized-actions/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先给几名队员安排动作，再一口气处理互相照应的守卫。」
出處：`sources/text/stealth-synchronized-actions.json` 字元 184-209 `summary.zh`
顯示：先給幾名隊員安排動作，再一口氣處理互相照應的守衛。

## 規則

「玩家为多个角色预先指定目标与动作，再用一次确认触发。同步解决相互照看的敌人，避免一人倒下时另一人报警；不同动作的行走与出手时间仍需计算。」
出處：`sources/text/stealth-synchronized-actions.json` 字元 334-402 `rules.zh`
顯示：玩家爲多個角色預先指定目標與動作，再用一次確認觸發。同步解決相互照看的敵人，避免一人倒下時另一人報警；不同動作的行走與出手時間仍需計算。

## 核心循環

「找出互相照看的敌人」
出處：`sources/text/stealth-synchronized-actions.json` 字元 646-655 `loop[0].zh`
顯示：找出互相照看的敵人

「让队员各就各位」
出處：`sources/text/stealth-synchronized-actions.json` 字元 733-740 `loop[1].zh`
顯示：讓隊員各就各位

「预排目标与动作」
出處：`sources/text/stealth-synchronized-actions.json` 字元 807-814 `loop[2].zh`
顯示：預排目標與動作

「同步执行后撤离」
出處：`sources/text/stealth-synchronized-actions.json` 字元 883-890 `loop[3].zh`
顯示：同步執行後撤離

## 玩家取捨

「全员立即出手，还是让远处队员先接近再触发？」
出處：`sources/text/stealth-synchronized-actions.json` 字元 984-1005 `decisions[0].zh`
顯示：全員立即出手，還是讓遠處隊員先接近再觸發？

「安排第三人解决新巡逻，还是留他处理计划失误？」
出處：`sources/text/stealth-synchronized-actions.json` 字元 1117-1139 `decisions[1].zh`
顯示：安排第三人解決新巡邏，還是留他處理計劃失誤？

## 可調參數

「执行时间差」
出處：`sources/text/stealth-synchronized-actions.json` 字元 1303-1308 `parameters[0].name.zh`
顯示：執行時間差

「动作完成时间差越大，玩家越需要提前站位或设置延迟。」
出處：`sources/text/stealth-synchronized-actions.json` 字元 1395-1420 `parameters[0].effect.zh`
顯示：動作完成時間差越大，玩家越需要提前站位或設置延遲。

「排队时是否暂停」
出處：`sources/text/stealth-synchronized-actions.json` 字元 1575-1582 `parameters[1].name.zh`
顯示：排隊時是否暫停

「暂停降低操作负担；不暂停则保留观察巡逻和快速安排的压力。」
出處：`sources/text/stealth-synchronized-actions.json` 字元 1663-1691 `parameters[1].effect.zh`
顯示：暫停降低操作負擔；不暫停則保留觀察巡邏和快速安排的壓力。

## 原型

「先做两名队员、两个固定守卫、每人一个可排队动作，再加共同执行按钮。」
出處：`sources/text/stealth-synchronized-actions.json` 字元 3124-3157 `prototype.firstStep.zh`
顯示：先做兩名隊員、兩個固定守衛、每人一個可排隊動作，再加共同執行按鈕。

「玩家能否说清失败是站位、动作耗时还是触发时机造成，而非觉得队员不听指挥？」
出處：`sources/text/stealth-synchronized-actions.json` 字元 3489-3525 `prototype.test.zh`
顯示：玩家能否說清失敗是站位、動作耗時還是觸發時機造成，而非覺得隊員不聽指揮？

「不要一开始做长指令链；优先解释“尚未就位”和“已准备执行”的区别。」
出處：`sources/text/stealth-synchronized-actions.json` 字元 3309-3342 `prototype.pitfall.zh`
顯示：不要一開始做長指令鏈；優先解釋“尚未就位”和“已準備執行”的區別。

## 相關模式

- [潛行警戒](exploration-stealth-awareness.md)
- [移動與藏起目標](stealth-body-concealment.md)
- [光影之間的路線](stealth-light-shadow.md)
- [聲音誘餌](stealth-sound-lures.md)

## 參考來源

- [Queued synchronized actions — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/stealth-synchronized-actions/) — 查閱：2026-11-02；取得方式：page-text。
