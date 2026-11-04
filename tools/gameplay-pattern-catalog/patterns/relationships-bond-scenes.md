---
{
  "schema_version": 2,
  "id": "relationships-bond-scenes",
  "title": "關係門檻後的場景",
  "title_en": "Relationship-gated scenes",
  "category": "relationships",
  "source_category": "relationships",
  "tags": [
    "narrative",
    "progression",
    "time"
  ],
  "summary": "通过持续互动解锁人物片段，让数值进度变成可感知的关系变化。",
  "note_status": "draft",
  "related": [
    "relationships-daily-contact",
    "relationships-date-itinerary",
    "relationships-dynastic-marriage",
    "relationships-relationship-commitment"
  ],
  "sources": [
    {
      "title": "Relationship-gated scenes — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/relationships-bond-scenes/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「通过持续互动解锁人物片段，让数值进度变成可感知的关系变化。」
出處：`sources/text/relationships-bond-scenes.json` 字元 187-216 `summary.zh`
顯示：通過持續互動解鎖人物片段，讓數值進度變成可感知的關係變化。

## 規則

「玩家投入互动时间积累关系；达到门槛后，还要满足人物在场、日期或地点条件。完成事件得到新的认识或能力，下一阶段提供新的目标。」
出處：`sources/text/relationships-bond-scenes.json` 字元 353-414 `rules.zh`
顯示：玩家投入互動時間積累關係；達到門檻後，還要滿足人物在場、日期或地點條件。完成事件得到新的認識或能力，下一階段提供新的目標。

## 核心循環

「选择想了解的人」
出處：`sources/text/relationships-bond-scenes.json` 字元 657-664 `loop[0].zh`
顯示：選擇想了解的人

「积累关系」
出處：`sources/text/relationships-bond-scenes.json` 字元 726-730 `loop[1].zh`
顯示：積累關係

「满足事件条件」
出處：`sources/text/relationships-bond-scenes.json` 字元 786-792 `loop[2].zh`
顯示：滿足事件條件

「经历事件与新目标」
出處：`sources/text/relationships-bond-scenes.json` 字元 857-865 `loop[3].zh`
顯示：經歷事件與新目標

## 玩家取捨

「优先看完一个人的故事，还是浅度了解更多人？」
出處：`sources/text/relationships-bond-scenes.json` 字元 950-971 `decisions[0].zh`
顯示：優先看完一個人的故事，還是淺度瞭解更多人？

「门槛满足后主动找事件，还是等日常自然相遇？」
出處：`sources/text/relationships-bond-scenes.json` 字元 1062-1083 `decisions[1].zh`
顯示：門檻滿足後主動找事件，還是等日常自然相遇？

## 可調參數

「阶段间距」
出處：`sources/text/relationships-bond-scenes.json` 字元 1237-1241 `parameters[0].name.zh`
顯示：階段間距

「间距越大，单次事件要承担更强的回报感。」
出處：`sources/text/relationships-bond-scenes.json` 字元 1320-1339 `parameters[0].effect.zh`
顯示：間距越大，單次事件要承擔更強的回報感。

「触发条件透明度」
出處：`sources/text/relationships-bond-scenes.json` 字元 1454-1461 `parameters[1].name.zh`
顯示：觸發條件透明度

「隐藏条件增加发现感，也可能让已投入的玩家卡住。」
出處：`sources/text/relationships-bond-scenes.json` 字元 1543-1566 `parameters[1].effect.zh`
顯示：隱藏條件增加發現感，也可能讓已投入的玩家卡住。

## 原型

「做一位角色、两个关系阶段和一个明确的时间地点触发条件。」
出處：`sources/text/relationships-bond-scenes.json` 字元 3028-3055 `prototype.firstStep.zh`
顯示：做一位角色、兩個關係階段和一個明確的時間地點觸發條件。

「达到门槛后，玩家能否不查攻略找到事件，并记住事件带来的新信息。」
出處：`sources/text/relationships-bond-scenes.json` 字元 3358-3389 `prototype.test.zh`
顯示：達到門檻後，玩家能否不查攻略找到事件，並記住事件帶來的新信息。

「事件条件太隐蔽会让进度看似卡住；先提供能理解的线索。」
出處：`sources/text/relationships-bond-scenes.json` 字元 3193-3219 `prototype.pitfall.zh`
顯示：事件條件太隱蔽會讓進度看似卡住；先提供能理解的線索。

## 相關模式

- [每日接觸](relationships-daily-contact.md)
- [約會行程](relationships-date-itinerary.md)
- [聯姻作為長期承諾](relationships-dynastic-marriage.md)
- [關係承諾](relationships-relationship-commitment.md)

## 參考來源

- [Relationship-gated scenes — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/relationships-bond-scenes/) — 查閱：2026-11-02；取得方式：page-text。
