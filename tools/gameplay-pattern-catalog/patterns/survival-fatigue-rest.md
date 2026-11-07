---
{
  "schema_version": 2,
  "id": "survival-fatigue-rest",
  "title": "疲勞休息點",
  "title_en": "Fatigue and sleep planning",
  "category": "survival",
  "source_category": "survival",
  "tags": [
    "planning",
    "risk"
  ],
  "summary": "把睡觉放进日程，而不是等角色撑不住再补救。",
  "note_status": "draft",
  "related": [
    "survival-bleeding-triage",
    "survival-competing-needs",
    "survival-limb-impairment",
    "survival-safe-water"
  ],
  "sources": [
    {
      "title": "Fatigue and sleep planning — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/survival-fatigue-rest/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把睡觉放进日程，而不是等角色撑不住再补救。」
出處：`sources/text/survival-fatigue-rest.json` 字元 180-201 `summary.zh`
顯示：把睡覺放進日程，而不是等角色撐不住再補救。

## 規則

「行动和清醒时间累积疲劳，削弱后续效率。玩家选择何时休息、休息多久以及在哪里睡；睡醒后的精力、时间和环境变化共同决定下一段活动。」
出處：`sources/text/survival-fatigue-rest.json` 字元 295-358 `rules.zh`
顯示：行動和清醒時間累積疲勞，削弱後續效率。玩家選擇何時休息、休息多久以及在哪裏睡；睡醒後的精力、時間和環境變化共同決定下一段活動。

## 核心循環

「估计剩余精力」
出處：`sources/text/survival-fatigue-rest.json` 字元 597-603 `loop[0].zh`
顯示：估計剩餘精力

「安排返程或临时休息」
出處：`sources/text/survival-fatigue-rest.json` 字元 672-681 `loop[1].zh`
顯示：安排返程或臨時休息

「睡眠推进世界时间」
出處：`sources/text/survival-fatigue-rest.json` 字元 755-763 `loop[2].zh`
顯示：睡眠推進世界時間

「按醒来状态重排行程」
出處：`sources/text/survival-fatigue-rest.json` 字元 838-847 `loop[3].zh`
顯示：按醒來狀態重排行程

## 玩家取捨

「再做一件事能带回收益，但可能错过安全返程时间。」
出處：`sources/text/survival-fatigue-rest.json` 字元 931-954 `decisions[0].zh`
顯示：再做一件事能帶回收益，但可能錯過安全返程時間。

「短睡保住白天，长睡减少下一次中断。」
出處：`sources/text/survival-fatigue-rest.json` 字元 1053-1070 `decisions[1].zh`
顯示：短睡保住白天，長睡減少下一次中斷。

## 可調參數

「疲劳对行动的影响」
出處：`sources/text/survival-fatigue-rest.json` 字元 1230-1238 `parameters[0].name.zh`
顯示：疲勞對行動的影響

「先影响搬运或战斗会迫使提前安排；只在归零惩罚容易拖到最后一刻。」
出處：`sources/text/survival-fatigue-rest.json` 字元 1317-1348 `parameters[0].effect.zh`
顯示：先影響搬運或戰鬥會迫使提前安排；只在歸零懲罰容易拖到最後一刻。

「睡眠恢复曲线」
出處：`sources/text/survival-fatigue-rest.json` 字元 1508-1514 `parameters[1].name.zh`
顯示：睡眠恢復曲線

「前半段恢复快，鼓励小睡；越睡越有效则鼓励完整休整。」
出處：`sources/text/survival-fatigue-rest.json` 字元 1590-1615 `parameters[1].effect.zh`
顯示：前半段恢復快，鼓勵小睡；越睡越有效則鼓勵完整休整。

## 原型

「只做白天倒计时、精力条和三个地点，睡眠按轮恢复。」
出處：`sources/text/survival-fatigue-rest.json` 字元 2911-2935 `prototype.firstStep.zh`
顯示：只做白天倒計時、精力條和三個地點，睡眠按輪恢復。

「观察玩家是否在精力耗尽前主动返程。」
出處：`sources/text/survival-fatigue-rest.json` 字元 3197-3214 `prototype.test.zh`
顯示：觀察玩家是否在精力耗盡前主動返程。

「把睡觉做成长时间无法操作的等待会打断体验；允许加速。」
出處：`sources/text/survival-fatigue-rest.json` 字元 3068-3094 `prototype.pitfall.zh`
顯示：把睡覺做成長時間無法操作的等待會打斷體驗；允許加速。

## 相關模式

- [失血分診](survival-bleeding-triage.md)
- [競爭需求](survival-competing-needs.md)
- [肢體機能受損](survival-limb-impairment.md)
- [取水與淨水決策](survival-safe-water.md)

## 參考來源

- [Fatigue and sleep planning — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/survival-fatigue-rest/) — 查閱：2026-11-02；取得方式：page-text。
