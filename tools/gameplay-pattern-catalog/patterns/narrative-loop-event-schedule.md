---
{
  "schema_version": 2,
  "id": "narrative-loop-event-schedule",
  "title": "循環事件時程",
  "title_en": "Repeat a time window with a different event plan",
  "category": "narrative",
  "source_category": "narrative",
  "tags": [
    "time",
    "information",
    "discovery"
  ],
  "summary": "世界回到起点，玩家用上一轮的发现改变下一轮安排。",
  "note_status": "draft",
  "related": [
    "narrative-evidence-rebuttal",
    "narrative-investigation-time-slots",
    "narrative-background-dialogue-access",
    "narrative-conversation-intervention"
  ],
  "sources": [
    {
      "title": "Repeat a time window with a different event plan — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/narrative-loop-event-schedule/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「世界回到起点，玩家用上一轮的发现改变下一轮安排。」
出處：`sources/text/narrative-loop-event-schedule.json` 字元 217-241 `summary.zh`
顯示：世界回到起點，玩家用上一輪的發現改變下一輪安排。

## 規則

「一段时间内的事件按规则推进，到终点或失败后世界状态重置，玩家保留已经理解的信息。下一轮可以更早赶到地点、先处理前置条件或尝试新对话，观察事件链如何改变。重点是重新安排整段事件，不是逐帧撤销刚才的动作。」
出處：`sources/text/narrative-loop-event-schedule.json` 字元 378-478 `rules.zh`
顯示：一段時間內的事件按規則推進，到終點或失敗後世界狀態重置，玩家保留已經理解的信息。下一輪可以更早趕到地點、先處理前置條件或嘗試新對話，觀察事件鏈如何改變。重點是重新安排整段事件，不是逐幀撤銷剛纔的動作。

## 核心循環

「观察这一轮的事件顺序」
出處：`sources/text/narrative-loop-event-schedule.json` 字元 804-814 `loop[0].zh`
顯示：觀察這一輪的事件順序

「记住障碍与时间条件」
出處：`sources/text/narrative-loop-event-schedule.json` 字元 881-890 `loop[1].zh`
顯示：記住障礙與時間條件

「重置后改变行动安排」
出處：`sources/text/narrative-loop-event-schedule.json` 字元 974-983 `loop[2].zh`
顯示：重置後改變行動安排

「验证变化并获得下一条线索」
出處：`sources/text/narrative-loop-event-schedule.json` 字元 1049-1061 `loop[3].zh`
顯示：驗證變化並獲得下一條線索

## 玩家取捨

「本轮继续追一个新发现，还是先验证已经想到的解法？」
出處：`sources/text/narrative-loop-event-schedule.json` 字元 1163-1187 `decisions[0].zh`
顯示：本輪繼續追一個新發現，還是先驗證已經想到的解法？

「提早改变一个事件，是否会错过原本想观察的后续？」
出處：`sources/text/narrative-loop-event-schedule.json` 字元 1301-1324 `decisions[1].zh`
顯示：提早改變一個事件，是否會錯過原本想觀察的後續？

## 可調參數

「循环长度」
出處：`sources/text/narrative-loop-event-schedule.json` 字元 1483-1487 `parameters[0].name.zh`
顯示：循環長度

「短循环便于试验；长循环需要跳过已知流程的办法，减少重复劳动。」
出處：`sources/text/narrative-loop-event-schedule.json` 字元 1560-1590 `parameters[0].effect.zh`
顯示：短循環便於試驗；長循環需要跳過已知流程的辦法，減少重複勞動。

「跨循环保留的内容」
出處：`sources/text/narrative-loop-event-schedule.json` 字元 1741-1749 `parameters[1].name.zh`
顯示：跨循環保留的內容

「只保留知识会强调理解；保留部分物品或关系会改变解题方式，需要明确说明。」
出處：`sources/text/narrative-loop-event-schedule.json` 字元 1838-1873 `parameters[1].effect.zh`
顯示：只保留知識會強調理解；保留部分物品或關係會改變解題方式，需要明確說明。

## 原型

「做一张小地图、三个定时事件和一个循环重置按钮，知识记在简单笔记里。」
出處：`sources/text/narrative-loop-event-schedule.json` 字元 3541-3574 `prototype.firstStep.zh`
顯示：做一張小地圖、三個定時事件和一個循環重置按鈕，知識記在簡單筆記裏。

「每次重来时，玩家是否带着新假设，而非重复同一套操作？」
出處：`sources/text/narrative-loop-event-schedule.json` 字元 3902-3928 `prototype.test.zh`
顯示：每次重來時，玩家是否帶着新假設，而非重複同一套操作？

「若关键状态没有正确重置，因果规则会变得无法信任；长段重复对白也要能跳过。」
出處：`sources/text/narrative-loop-event-schedule.json` 字元 3726-3762 `prototype.pitfall.zh`
顯示：若關鍵狀態沒有正確重置，因果規則會變得無法信任；長段重複對白也要能跳過。

## 相關模式

- [證據反駁](narrative-evidence-rebuttal.md)
- [調查時間時段](narrative-investigation-time-slots.md)
- [背景事件對話進出](narrative-background-dialogue-access.md)
- [對話介入](narrative-conversation-intervention.md)

## 參考來源

- [Repeat a time window with a different event plan — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/narrative-loop-event-schedule/) — 查閱：2026-11-02；取得方式：page-text。
