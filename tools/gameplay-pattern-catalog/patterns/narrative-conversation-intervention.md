---
{
  "schema_version": 2,
  "id": "narrative-conversation-intervention",
  "title": "對話介入",
  "title_en": "Intervene before the other person finishes",
  "category": "narrative",
  "source_category": "narrative",
  "tags": [
    "timing",
    "narrative",
    "information"
  ],
  "summary": "何时开口或行动，也能改变正在发生的对话。",
  "note_status": "draft",
  "related": [
    "narrative-background-dialogue-access",
    "narrative-deliberate-silence",
    "narrative-evidence-rebuttal",
    "narrative-perspective-handoff"
  ],
  "sources": [
    {
      "title": "Intervene before the other person finishes — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/narrative-conversation-intervention/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「何时开口或行动，也能改变正在发生的对话。」
出處：`sources/text/narrative-conversation-intervention.json` 字元 210-230 `summary.zh`
顯示：何時開口或行動，也能改變正在發生的對話。

## 規則

「对方说话或事件演出期间出现短暂的介入机会。玩家可以立即插话或行动，改变正在进行的场景；也可以放过机会，听完或让原进程继续。它关注是否打断当前行为，而非只是轮到自己时选一句回答。」
出處：`sources/text/narrative-conversation-intervention.json` 字元 342-430 `rules.zh`
顯示：對方說話或事件演出期間出現短暫的介入機會。玩家可以立即插話或行動，改變正在進行的場景；也可以放過機會，聽完或讓原進程繼續。它關注是否打斷當前行爲，而非只是輪到自己時選一句回答。

## 核心循環

「观察正在发生的言行」
出處：`sources/text/narrative-conversation-intervention.json` 字元 750-759 `loop[0].zh`
顯示：觀察正在發生的言行

「识别可介入的机会」
出處：`sources/text/narrative-conversation-intervention.json` 字元 839-847 `loop[1].zh`
顯示：識別可介入的機會

「打断或让过程继续」
出處：`sources/text/narrative-conversation-intervention.json` 字元 925-933 `loop[2].zh`
顯示：打斷或讓過程繼續

「处理改变后的对话局面」
出處：`sources/text/narrative-conversation-intervention.json` 字元 1005-1015 `loop[3].zh`
顯示：處理改變後的對話局面

## 玩家取捨

「现在制止能避免风险，但是否会漏听重要信息？」
出處：`sources/text/narrative-conversation-intervention.json` 字元 1111-1132 `decisions[0].zh`
顯示：現在制止能避免風險，但是否會漏聽重要信息？

「用行动表达立场，还是让对方把话说完再决定？」
出處：`sources/text/narrative-conversation-intervention.json` 字元 1250-1271 `decisions[1].zh`
顯示：用行動表達立場，還是讓對方把話說完再決定？

## 可調參數

「介入提示的预告量」
出處：`sources/text/narrative-conversation-intervention.json` 字元 1423-1431 `parameters[0].name.zh`
顯示：介入提示的預告量

「有足够预告才能让玩家做判断；突然闪一下更像反应测试。」
出處：`sources/text/narrative-conversation-intervention.json` 字元 1508-1534 `parameters[0].effect.zh`
顯示：有足夠預告才能讓玩家做判斷；突然閃一下更像反應測試。

「放弃介入的后续」
出處：`sources/text/narrative-conversation-intervention.json` 字元 1685-1692 `parameters[1].name.zh`
顯示：放棄介入的後續

「不介入也应产生可理解的剧情，而不总是直接失败。」
出處：`sources/text/narrative-conversation-intervention.json` 字元 1787-1810 `parameters[1].effect.zh`
顯示：不介入也應產生可理解的劇情，而不總是直接失敗。

## 原型

「写一段可中断的台词和两条后续；先用字幕和按钮验证，不制作复杂演出。」
出處：`sources/text/narrative-conversation-intervention.json` 字元 3282-3315 `prototype.firstStep.zh`
顯示：寫一段可中斷的臺詞和兩條後續；先用字幕和按鈕驗證，不製作複雜演出。

「玩家能否清楚说明自己选择了介入时机，而非误以为必须抢按？」
出處：`sources/text/narrative-conversation-intervention.json` 字元 3652-3680 `prototype.test.zh`
顯示：玩家能否清楚說明自己選擇了介入時機，而非誤以爲必須搶按？

「必须处理被打断台词、字幕和动作的状态，不让角色同时说两句话。」
出處：`sources/text/narrative-conversation-intervention.json` 字元 3474-3504 `prototype.pitfall.zh`
顯示：必須處理被打斷臺詞、字幕和動作的狀態，不讓角色同時說兩句話。

## 相關模式

- [背景事件對話進出](narrative-background-dialogue-access.md)
- [刻意沉默](narrative-deliberate-silence.md)
- [證據反駁](narrative-evidence-rebuttal.md)
- [視角交接](narrative-perspective-handoff.md)

## 參考來源

- [Intervene before the other person finishes — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/narrative-conversation-intervention/) — 查閱：2026-11-02；取得方式：page-text。
