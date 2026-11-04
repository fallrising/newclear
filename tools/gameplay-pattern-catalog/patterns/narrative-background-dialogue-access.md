---
{
  "schema_version": 2,
  "id": "narrative-background-dialogue-access",
  "title": "背景事件對話進出",
  "title_en": "Open extra dialogue through identity and experience",
  "category": "narrative",
  "source_category": "narrative",
  "tags": [
    "narrative",
    "information",
    "planning"
  ],
  "summary": "同一个问题，不同经历的人能提出不同回答。",
  "note_status": "draft",
  "related": [
    "narrative-perspective-handoff",
    "narrative-conversation-intervention",
    "narrative-delayed-choice-consequences",
    "narrative-deliberate-silence"
  ],
  "sources": [
    {
      "title": "Open extra dialogue through identity and experience — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/narrative-background-dialogue-access/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「同一个问题，不同经历的人能提出不同回答。」
出處：`sources/text/narrative-background-dialogue-access.json` 字元 224-244 `summary.zh`
顯示：同一個問題，不同經歷的人能提出不同回答。

## 規則

「玩家的职业、经历或已经取得的身份标签决定哪些话题可用。满足条件便能看到额外问题或解决办法；这些选项仍可能有取舍，不保证必定说服对方。这里判断“有没有这段经历”，与掷骰决定说服成功不同。」
出處：`sources/text/narrative-background-dialogue-access.json` 字元 370-462 `rules.zh`
顯示：玩家的職業、經歷或已經取得的身份標籤決定哪些話題可用。滿足條件便能看到額外問題或解決辦法；這些選項仍可能有取捨，不保證必定說服對方。這裏判斷“有沒有這段經歷”，與擲骰決定說服成功不同。

## 核心循環

「建立角色的经历或身份」
出處：`sources/text/narrative-background-dialogue-access.json` 字元 796-806 `loop[0].zh`
顯示：建立角色的經歷或身份

「遇到相关人物与问题」
出處：`sources/text/narrative-background-dialogue-access.json` 字元 881-890 `loop[1].zh`
顯示：遇到相關人物與問題

「选择由经历打开的话题」
出處：`sources/text/narrative-background-dialogue-access.json` 字元 967-977 `loop[2].zh`
顯示：選擇由經歷打開的話題

「利用回应决定下一条路」
出處：`sources/text/narrative-background-dialogue-access.json` 字元 1051-1061 `loop[3].zh`
顯示：利用回應決定下一條路

## 玩家取捨

「使用专业身份争取解释权，还是避免暴露自己所属的群体？」
出處：`sources/text/narrative-background-dialogue-access.json` 字元 1160-1186 `decisions[0].zh`
顯示：使用專業身份爭取解釋權，還是避免暴露自己所屬的羣體？

「熟悉的回答未必合适，是否改用普通人也能选择的问法？」
出處：`sources/text/narrative-background-dialogue-access.json` 字元 1298-1323 `decisions[1].zh`
顯示：熟悉的回答未必合適，是否改用普通人也能選擇的問法？

## 可調參數

「身份标签的数量」
出處：`sources/text/narrative-background-dialogue-access.json` 字元 1490-1497 `parameters[0].name.zh`
顯示：身份標籤的數量

「少量清楚的标签易于预期；过多交叉条件容易让玩家看不懂选项为何出现。」
出處：`sources/text/narrative-background-dialogue-access.json` 字元 1582-1615 `parameters[0].effect.zh`
顯示：少量清楚的標籤易於預期；過多交叉條件容易讓玩家看不懂選項爲何出現。

「专属选项的优势」
出處：`sources/text/narrative-background-dialogue-access.json` 字元 1777-1784 `parameters[1].name.zh`
顯示：專屬選項的優勢

「提供不同视角比永远给出最优解更能保留角色选择。」
出處：`sources/text/narrative-background-dialogue-access.json` 字元 1876-1899 `parameters[1].effect.zh`
顯示：提供不同視角比永遠給出最優解更能保留角色選擇。

## 原型

「做两个背景标签、三段共用对话和各一条专属话题。」
出處：`sources/text/narrative-background-dialogue-access.json` 字元 3468-3491 `prototype.firstStep.zh`
顯示：做兩個背景標籤、三段共用對話和各一條專屬話題。

「玩家能否从自身背景猜到会出现哪种话题，同时仍认真选择？」
出處：`sources/text/narrative-background-dialogue-access.json` 字元 3810-3837 `prototype.test.zh`
顯示：玩家能否從自身背景猜到會出現哪種話題，同時仍認真選擇？

「专属选项若总是无代价成功，角色身份会变成寻找最优攻略。」
出處：`sources/text/narrative-background-dialogue-access.json` 字元 3637-3664 `prototype.pitfall.zh`
顯示：專屬選項若總是無代價成功，角色身份會變成尋找最優攻略。

## 相關模式

- [視角交接](narrative-perspective-handoff.md)
- [對話介入](narrative-conversation-intervention.md)
- [延遲選擇後果](narrative-delayed-choice-consequences.md)
- [刻意沉默](narrative-deliberate-silence.md)

## 參考來源

- [Open extra dialogue through identity and experience — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/narrative-background-dialogue-access/) — 查閱：2026-11-02；取得方式：page-text。
