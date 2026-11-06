---
{
  "schema_version": 2,
  "id": "relationships-daily-contact",
  "title": "每日接觸",
  "title_en": "Daily contact rhythm",
  "category": "relationships",
  "source_category": "relationships",
  "tags": [
    "time",
    "planning",
    "narrative"
  ],
  "summary": "用每日有限的交流收益，让“顺路看看朋友”成为路线选择。",
  "note_status": "draft",
  "related": [
    "relationships-date-itinerary",
    "relationships-bond-scenes",
    "relationships-dynastic-marriage",
    "commerce-timed-contracts"
  ],
  "sources": [
    {
      "title": "Daily contact rhythm — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/relationships-daily-contact/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「用每日有限的交流收益，让“顺路看看朋友”成为路线选择。」
出處：`sources/text/relationships-daily-contact.json` 字元 182-209 `summary.zh`
顯示：用每日有限的交流收益，讓“順路看看朋友”成爲路線選擇。

## 規則

「玩家找到角色并交谈；同一天重复互动通常不会反复刷同样的收益。新台词和关系变化提供反馈，行程时间则是隐形成本。」
出處：`sources/text/relationships-daily-contact.json` 字元 338-392 `rules.zh`
顯示：玩家找到角色並交談；同一天重複互動通常不會反覆刷同樣的收益。新臺詞和關係變化提供反饋，行程時間則是隱形成本。

## 核心循環

「查看今日行程」
出處：`sources/text/relationships-daily-contact.json` 字元 607-613 `loop[0].zh`

「找到角色」
出處：`sources/text/relationships-daily-contact.json` 字元 676-680 `loop[1].zh`

「完成一次交流」
出處：`sources/text/relationships-daily-contact.json` 字元 740-746 `loop[2].zh`

「安排下一站」
出處：`sources/text/relationships-daily-contact.json` 字元 809-814 `loop[3].zh`

## 玩家取捨

「为了一个人绕远路，还是兼顾几位顺路的朋友？」
出處：`sources/text/relationships-daily-contact.json` 字元 897-918 `decisions[0].zh`
顯示：爲了一個人繞遠路，還是兼顧幾位順路的朋友？

「把时间留给挣钱，还是维持熟悉的人际关系？」
出處：`sources/text/relationships-daily-contact.json` 字元 1016-1036 `decisions[1].zh`
顯示：把時間留給掙錢，還是維持熟悉的人際關係？

## 可調參數

「每日收益次数」
出處：`sources/text/relationships-daily-contact.json` 字元 1167-1173 `parameters[0].name.zh`
顯示：每日收益次數

「限一次可抑制刷对话，但需要足够丰富的日常内容。」
出處：`sources/text/relationships-daily-contact.json` 字元 1253-1276 `parameters[0].effect.zh`
顯示：限一次可抑制刷對話，但需要足夠豐富的日常內容。

「角色可达性」
出處：`sources/text/relationships-daily-contact.json` 字元 1411-1416 `parameters[1].name.zh`
顯示：角色可達性

「分散的日程增加路线规划，固定集合点更轻松。」
出處：`sources/text/relationships-daily-contact.json` 字元 1501-1522 `parameters[1].effect.zh`
顯示：分散的日程增加路線規劃，固定集合點更輕鬆。

## 原型

「做三个有固定行程的角色、一天三个时段与每人每日一次有效交流。」
出處：`sources/text/relationships-daily-contact.json` 字元 3007-3037 `prototype.firstStep.zh`
顯示：做三個有固定行程的角色、一天三個時段與每人每日一次有效交流。

「观察玩家是否调整自己的路线照顾关系，而非交流收益只靠反复点击。」
出處：`sources/text/relationships-daily-contact.json` 字元 3394-3425 `prototype.test.zh`
顯示：觀察玩家是否調整自己的路線照顧關係，而非交流收益只靠反覆點擊。

「如果只是每天点同一句话，关系会变签到；先加入可见的日程或对话变化。」
出處：`sources/text/relationships-daily-contact.json` 字元 3204-3237 `prototype.pitfall.zh`
顯示：如果只是每天點同一句話，關係會變簽到；先加入可見的日程或對話變化。

## 相關模式

- [約會行程](relationships-date-itinerary.md)
- [關係門檻後的場景](relationships-bond-scenes.md)
- [聯姻作為長期承諾](relationships-dynastic-marriage.md)
- [限時合約](commerce-timed-contracts.md)

## 參考來源

- [Daily contact rhythm — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/relationships-daily-contact/) — 查閱：2026-11-02；取得方式：page-text。
