---
{
  "schema_version": 2,
  "id": "narrative-service-as-response",
  "title": "用產出代替對白回應",
  "title_en": "Respond through what you make and serve",
  "category": "narrative",
  "source_category": "narrative",
  "tags": [
    "narrative",
    "information",
    "creativity"
  ],
  "summary": "选择递出什么，也是在决定对话往哪走。",
  "note_status": "draft",
  "related": [
    "narrative-background-dialogue-access",
    "narrative-conversation-intervention",
    "narrative-deliberate-silence",
    "narrative-evidence-rebuttal"
  ],
  "sources": [
    {
      "title": "Respond through what you make and serve — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/narrative-service-as-response/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「选择递出什么，也是在决定对话往哪走。」
出處：`sources/text/narrative-service-as-response.json` 字元 203-221 `summary.zh`
顯示：選擇遞出什麼，也是在決定對話往哪走。

## 規則

「角色通过需求和谈话提供线索，玩家用制作并递交的物品表达回应。系统读取实际交付结果，改变角色反应或后续故事；重点不只是订单是否合格，而是操作结果承担了对白选择的作用。」
出處：`sources/text/narrative-service-as-response.json` 字元 334-416 `rules.zh`
顯示：角色通過需求和談話提供線索，玩家用製作並遞交的物品表達回應。系統讀取實際交付結果，改變角色反應或後續故事；重點不只是訂單是否合格，而是操作結果承擔了對白選擇的作用。

## 核心循環

「听取需求与心情线索」
出處：`sources/text/narrative-service-as-response.json` 字元 707-716 `loop[0].zh`
顯示：聽取需求與心情線索

「选择要制作的东西」
出處：`sources/text/narrative-service-as-response.json` 字元 795-803 `loop[1].zh`
顯示：選擇要製作的東西

「交付并观察角色反应」
出處：`sources/text/narrative-service-as-response.json` 字元 866-875 `loop[2].zh`
顯示：交付並觀察角色反應

「把新信息用于下一次服务」
出處：`sources/text/narrative-service-as-response.json` 字元 952-963 `loop[3].zh`
顯示：把新信息用於下一次服務

## 玩家取捨

「严格照做，还是根据对方的处境做一点调整？」
出處：`sources/text/narrative-service-as-response.json` 字元 1071-1091 `decisions[0].zh`
顯示：嚴格照做，還是根據對方的處境做一點調整？

「想得到某个回应时，是否值得牺牲眼前的满意度？」
出處：`sources/text/narrative-service-as-response.json` 字元 1201-1223 `decisions[1].zh`
顯示：想得到某個回應時，是否值得犧牲眼前的滿意度？

## 可調參數

「物品与回应的关系」
出處：`sources/text/narrative-service-as-response.json` 字元 1370-1378 `parameters[0].name.zh`
顯示：物品與回應的關係

「线索明确，玩家才会觉得自己通过行动表达，而非碰巧触发分支。」
出處：`sources/text/narrative-service-as-response.json` 字元 1464-1493 `parameters[0].effect.zh`
顯示：線索明確，玩家纔會覺得自己通過行動表達，而非碰巧觸發分支。

「影响故事的交付节点」
出處：`sources/text/narrative-service-as-response.json` 字元 1650-1659 `parameters[1].name.zh`
顯示：影響故事的交付節點

「少量重要节点能控制写作量；若每次配方都改剧情，分支会迅速增长。」
出處：`sources/text/narrative-service-as-response.json` 字元 1745-1776 `parameters[1].effect.zh`
顯示：少量重要節點能控制寫作量；若每次配方都改劇情，分支會迅速增長。

## 原型

「做两名顾客、三种成品和一个因交付不同而变化的后续对话。」
出處：`sources/text/narrative-service-as-response.json` 字元 3398-3425 `prototype.firstStep.zh`
顯示：做兩名顧客、三種成品和一個因交付不同而變化的後續對話。

「玩家能否解释自己为何做这件东西，并从回应看出表达是否被接收？」
出處：`sources/text/narrative-service-as-response.json` 字元 3734-3764 `prototype.test.zh`
顯示：玩家能否解釋自己爲何做這件東西，並從回應看出表達是否被接收？

「若看不出物品如何影响人物，玩家只能逐个试配方。」
出處：`sources/text/narrative-service-as-response.json` 字元 3572-3595 `prototype.pitfall.zh`
顯示：若看不出物品如何影響人物，玩家只能逐個試配方。

## 相關模式

- [背景事件對話進出](narrative-background-dialogue-access.md)
- [對話介入](narrative-conversation-intervention.md)
- [刻意沉默](narrative-deliberate-silence.md)
- [證據反駁](narrative-evidence-rebuttal.md)

## 參考來源

- [Respond through what you make and serve — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/narrative-service-as-response/) — 查閱：2026-11-02；取得方式：page-text。
