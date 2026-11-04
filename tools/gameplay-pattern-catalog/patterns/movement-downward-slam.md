---
{
  "schema_version": 2,
  "id": "movement-downward-slam",
  "title": "承諾一次下砸",
  "title_en": "Commit to a downward slam",
  "category": "movement",
  "source_category": "movement",
  "tags": [
    "spatial",
    "timing",
    "risk"
  ],
  "summary": "不等自然下落，主动砸向地面或目标，换取一次强反馈。",
  "note_status": "draft",
  "related": [
    "exploration-climbing-rest-route",
    "exploration-grapple-swing",
    "exploration-wall-jump",
    "movement-ledge-catch"
  ],
  "sources": [
    {
      "title": "Commit to a downward slam — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/movement-downward-slam/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「不等自然下落，主动砸向地面或目标，换取一次强反馈。」
出處：`sources/text/movement-downward-slam.json` 字元 182-207 `summary.zh`
顯示：不等自然下落，主動砸向地面或目標，換取一次強反饋。

## 規則

「角色在空中触发快速下落动作，将一次普通落地变成攻击或破坏地面的机会。玩家要先对准下方目标再发动，因为下砸期间的修正通常更少；落地后的敌人状态或通路变化决定下一步。」
出處：`sources/text/movement-downward-slam.json` 字元 327-408 `rules.zh`
顯示：角色在空中觸發快速下落動作，將一次普通落地變成攻擊或破壞地面的機會。玩家要先對準下方目標再發動，因爲下砸期間的修正通常更少；落地後的敵人狀態或通路變化決定下一步。

## 核心循環

「从空中观察下方」
出處：`sources/text/movement-downward-slam.json` 字元 699-706 `loop[0].zh`
顯示：從空中觀察下方

「对准可命中目标」
出處：`sources/text/movement-downward-slam.json` 字元 778-785 `loop[1].zh`
顯示：對準可命中目標

「主动发动下砸」
出處：`sources/text/movement-downward-slam.json` 字元 849-855 `loop[2].zh`
顯示：主動發動下砸

「利用落地结果继续」
出處：`sources/text/movement-downward-slam.json` 字元 917-925 `loop[3].zh`
顯示：利用落地結果繼續

## 玩家取捨

「下面有敌人也有危险地面，是下砸抢先命中，还是先落到旁边？」
出處：`sources/text/movement-downward-slam.json` 字元 1022-1050 `decisions[0].zh`
顯示：下面有敵人也有危險地面，是下砸搶先命中，還是先落到旁邊？

「砸开地板会进入未知下层，要现在开路还是先探索当前平台？」
出處：`sources/text/movement-downward-slam.json` 字元 1160-1187 `decisions[1].zh`
顯示：砸開地板會進入未知下層，要現在開路還是先探索當前平臺？

## 可調參數

「下砸后的调整余地」
出處：`sources/text/movement-downward-slam.json` 字元 1367-1375 `parameters[0].name.zh`
顯示：下砸後的調整餘地

「调整越少越强调出手前对准，调整越多越便于临时应对移动目标。」
出處：`sources/text/movement-downward-slam.json` 字元 1462-1491 `parameters[0].effect.zh`
顯示：調整越少越強調出手前對準，調整越多越便於臨時應對移動目標。

「可破坏目标的范围」
出處：`sources/text/movement-downward-slam.json` 字元 1656-1664 `parameters[1].name.zh`
顯示：可破壞目標的範圍

「明确的材质或标记让玩家判断哪里可以开路，混乱的规则会变成到处乱试。」
出處：`sources/text/movement-downward-slam.json` 字元 1748-1781 `parameters[1].effect.zh`
顯示：明確的材質或標記讓玩家判斷哪裏可以開路，混亂的規則會變成到處亂試。

## 原型

「只做一个可跳的平台、两块不同材质地板和一个静止目标，明确区分普通落地与主动下砸的结果。」
出處：`sources/text/movement-downward-slam.json` 字元 3407-3450 `prototype.firstStep.zh`
顯示：只做一個可跳的平臺、兩塊不同材質地板和一個靜止目標，明確區分普通落地與主動下砸的結果。

「让玩家先预测两种地板受击后的结果，再实际尝试，检查材质提示是否足以支持判断。」
出處：`sources/text/movement-downward-slam.json` 字元 3824-3862 `prototype.test.zh`
顯示：讓玩家先預測兩種地板受擊後的結果，再實際嘗試，檢查材質提示是否足以支持判斷。

「不要把所有地板都设为可破坏，否则一次下砸可能让关卡连通关系失控。」
出處：`sources/text/movement-downward-slam.json` 字元 3646-3678 `prototype.pitfall.zh`
顯示：不要把所有地板都設爲可破壞，否則一次下砸可能讓關卡連通關係失控。

## 相關模式

- [攀爬休息點路線](exploration-climbing-rest-route.md)
- [鉤索擺盪決策](exploration-grapple-swing.md)
- [牆面跳躍](exploration-wall-jump.md)
- [邊緣抓取](movement-ledge-catch.md)

## 參考來源

- [Commit to a downward slam — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/movement-downward-slam/) — 查閱：2026-11-02；取得方式：page-text。
