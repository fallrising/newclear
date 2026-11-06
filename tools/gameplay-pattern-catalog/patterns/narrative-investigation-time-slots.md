---
{
  "schema_version": 2,
  "id": "narrative-investigation-time-slots",
  "title": "調查時間時段",
  "title_en": "Allocate limited time among leads",
  "category": "narrative",
  "source_category": "narrative",
  "tags": [
    "planning",
    "time",
    "information"
  ],
  "summary": "查这一条线索，就暂时放下另一条。",
  "note_status": "draft",
  "related": [
    "narrative-background-dialogue-access",
    "narrative-delayed-choice-consequences",
    "narrative-loop-event-schedule",
    "narrative-perspective-handoff"
  ],
  "sources": [
    {
      "title": "Allocate limited time among leads — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/narrative-investigation-time-slots/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「查这一条线索，就暂时放下另一条。」
出處：`sources/text/narrative-investigation-time-slots.json` 字元 203-219 `summary.zh`
顯示：查這一條線索，就暫時放下另一條。

## 規則

「调查行动消耗游戏内时间，人物和事件也有出现时段。玩家根据预期收益安排访问、交谈和等待；到达新时段后，能见的人或剩余机会发生变化。它关注调查顺序与机会成本，不要求玩家现实中快速阅读。」
出處：`sources/text/narrative-investigation-time-slots.json` 字元 319-409 `rules.zh`
顯示：調查行動消耗遊戲內時間，人物和事件也有出現時段。玩家根據預期收益安排訪問、交談和等待；到達新時段後，能見的人或剩餘機會發生變化。它關注調查順序與機會成本，不要求玩家現實中快速閱讀。

## 核心循環

「查看线索与可用时段」
出處：`sources/text/narrative-investigation-time-slots.json` 字元 743-752 `loop[0].zh`
顯示：查看線索與可用時段

「选择一次调查或等待」
出處：`sources/text/narrative-investigation-time-slots.json` 字元 827-836 `loop[1].zh`
顯示：選擇一次調查或等待

「获得信息并推进时钟」
出處：`sources/text/narrative-investigation-time-slots.json` 字元 911-920 `loop[2].zh`
顯示：獲得信息並推進時鐘

「按新的日程重新排优先级」
出處：`sources/text/narrative-investigation-time-slots.json` 字元 997-1008 `loop[3].zh`
顯示：按新的日程重新排優先級

## 玩家取捨

「先查把握较大的线索，还是赶在人物离开前问一个不确定问题？」
出處：`sources/text/narrative-investigation-time-slots.json` 字元 1110-1138 `decisions[0].zh`
顯示：先查把握較大的線索，還是趕在人物離開前問一個不確定問題？

「等关键人物出现，还是用这段时间调查别处？」
出處：`sources/text/narrative-investigation-time-slots.json` 字元 1263-1283 `decisions[1].zh`
顯示：等關鍵人物出現，還是用這段時間調查別處？

## 可調參數

「行动消耗的粒度」
出處：`sources/text/narrative-investigation-time-slots.json` 字元 1430-1437 `parameters[0].name.zh`
顯示：行動消耗的粒度

「整段时段易读；细分分钟更灵活，但需要更好的日程提示。」
出處：`sources/text/narrative-investigation-time-slots.json` 字元 1520-1546 `parameters[0].effect.zh`
顯示：整段時段易讀；細分分鐘更靈活，但需要更好的日程提示。

「错过机会能否重来」
出處：`sources/text/narrative-investigation-time-slots.json` 字元 1718-1726 `parameters[1].name.zh`
顯示：錯過機會能否重來

「隔天再来会减轻焦虑；永久错过则需要提前提醒。」
出處：`sources/text/narrative-investigation-time-slots.json` 字元 1823-1845 `parameters[1].effect.zh`
顯示：隔天再來會減輕焦慮；永久錯過則需要提前提醒。

## 原型

「做三个地点、四个行动和两个时段，提前显示每项行动是否推进时间。」
出處：`sources/text/narrative-investigation-time-slots.json` 字元 3413-3444 `prototype.firstStep.zh`
顯示：做三個地點、四個行動和兩個時段，提前顯示每項行動是否推進時間。

「玩家是在衡量线索价值，还是因为不懂计时规则而反复读档？」
出處：`sources/text/narrative-investigation-time-slots.json` 字元 3747-3774 `prototype.test.zh`
顯示：玩家是在衡量線索價值，還是因爲不懂計時規則而反覆讀檔？

「不要在玩家刚读完一大段文字后，才突然告知时间已经耗尽。」
出處：`sources/text/narrative-investigation-time-slots.json` 字元 3590-3617 `prototype.pitfall.zh`
顯示：不要在玩家剛讀完一大段文字後，才突然告知時間已經耗盡。

## 相關模式

- [背景事件對話進出](narrative-background-dialogue-access.md)
- [延遲選擇後果](narrative-delayed-choice-consequences.md)
- [循環事件時程](narrative-loop-event-schedule.md)
- [視角交接](narrative-perspective-handoff.md)

## 參考來源

- [Allocate limited time among leads — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/narrative-investigation-time-slots/) — 查閱：2026-11-02；取得方式：page-text。
