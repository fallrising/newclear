---
{
  "schema_version": 2,
  "id": "narrative-evidence-rebuttal",
  "title": "證據反駁",
  "title_en": "Use evidence to challenge a specific statement",
  "category": "narrative",
  "source_category": "narrative",
  "tags": [
    "information",
    "narrative",
    "discovery"
  ],
  "summary": "不是猜凶手，而是指出这句话与哪条事实冲突。",
  "note_status": "draft",
  "related": [
    "narrative-background-dialogue-access",
    "narrative-conversation-intervention",
    "narrative-deliberate-silence",
    "narrative-loop-event-schedule"
  ],
  "sources": [
    {
      "title": "Use evidence to challenge a specific statement — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/narrative-evidence-rebuttal/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「不是猜凶手，而是指出这句话与哪条事实冲突。」
出處：`sources/text/narrative-evidence-rebuttal.json` 字元 207-228 `summary.zh`
顯示：不是猜兇手，而是指出這句話與哪條事實衝突。

## 規則

「对方给出一组可以逐句审视的陈述，玩家将某份证据对应到其中一句。只有证据内容与该陈述确实冲突时，质询才推进；成功后证词被补充或改写，产生下一处可检查的矛盾。」
出處：`sources/text/narrative-evidence-rebuttal.json` 字元 363-440 `rules.zh`
顯示：對方給出一組可以逐句審視的陳述，玩家將某份證據對應到其中一句。只有證據內容與該陳述確實衝突時，質詢才推進；成功後證詞被補充或改寫，產生下一處可檢查的矛盾。

## 核心循環

「阅读一段陈述」
出處：`sources/text/narrative-evidence-rebuttal.json` 字元 724-730 `loop[0].zh`
顯示：閱讀一段陳述

「比较证据里的事实」
出處：`sources/text/narrative-evidence-rebuttal.json` 字元 790-798 `loop[1].zh`
顯示：比較證據裏的事實

「在矛盾处出示证据」
出處：`sources/text/narrative-evidence-rebuttal.json` 字元 871-879 `loop[2].zh`
顯示：在矛盾處出示證據

「检查更新后的说法」
出處：`sources/text/narrative-evidence-rebuttal.json` 字元 960-968 `loop[3].zh`
顯示：檢查更新後的說法

## 玩家取捨

「已经找到明确矛盾就反驳，还是先追问补齐上下文？」
出處：`sources/text/narrative-evidence-rebuttal.json` 字元 1060-1083 `decisions[0].zh`
顯示：已經找到明確矛盾就反駁，還是先追問補齊上下文？

「两份证据都相关时，哪份能直接推翻这句话？」
出處：`sources/text/narrative-evidence-rebuttal.json` 字元 1193-1213 `decisions[1].zh`
顯示：兩份證據都相關時，哪份能直接推翻這句話？

## 可調參數

「证据与陈述的对应范围」
出處：`sources/text/narrative-evidence-rebuttal.json` 字元 1366-1376 `parameters[0].name.zh`
顯示：證據與陳述的對應範圍

「一份证据可反驳多个合理陈述，会减少“只认作者指定句”的挫败感。」
出處：`sources/text/narrative-evidence-rebuttal.json` 字元 1465-1496 `parameters[0].effect.zh`
顯示：一份證據可反駁多個合理陳述，會減少“只認作者指定句”的挫敗感。

「错误质询成本」
出處：`sources/text/narrative-evidence-rebuttal.json` 字元 1662-1668 `parameters[1].name.zh`
顯示：錯誤質詢成本

「轻罚鼓励验证假设；重罚要求更清楚的文字与复查机会。」
出處：`sources/text/narrative-evidence-rebuttal.json` 字元 1755-1780 `parameters[1].effect.zh`
顯示：輕罰鼓勵驗證假設；重罰要求更清楚的文字與複查機會。

## 原型

「做三句证词、三张证据卡和一次改口，不先写完整案件。」
出處：`sources/text/narrative-evidence-rebuttal.json` 字元 3365-3390 `prototype.firstStep.zh`
顯示：做三句證詞、三張證據卡和一次改口，不先寫完整案件。

「玩家能否不用穷举，就用自己的话解释这一对为什么冲突？」
出處：`sources/text/narrative-evidence-rebuttal.json` 字元 3728-3754 `prototype.test.zh`
顯示：玩家能否不用窮舉，就用自己的話解釋這一對爲什麼衝突？

「相关不等于矛盾；需要说明证据如何否定陈述，避免猜作者意图。」
出處：`sources/text/narrative-evidence-rebuttal.json` 字元 3534-3563 `prototype.pitfall.zh`
顯示：相關不等於矛盾；需要說明證據如何否定陳述，避免猜作者意圖。

## 相關模式

- [背景事件對話進出](narrative-background-dialogue-access.md)
- [對話介入](narrative-conversation-intervention.md)
- [刻意沉默](narrative-deliberate-silence.md)
- [循環事件時程](narrative-loop-event-schedule.md)

## 參考來源

- [Use evidence to challenge a specific statement — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/narrative-evidence-rebuttal/) — 查閱：2026-11-02；取得方式：page-text。
