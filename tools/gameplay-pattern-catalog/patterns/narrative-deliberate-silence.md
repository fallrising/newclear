---
{
  "schema_version": 2,
  "id": "narrative-deliberate-silence",
  "title": "刻意沉默",
  "title_en": "Choose silence and let the other person continue",
  "category": "narrative",
  "source_category": "narrative",
  "tags": [
    "information",
    "narrative",
    "risk"
  ],
  "summary": "不提供信息也是一种回应，但未必能避免后果。",
  "note_status": "draft",
  "related": [
    "narrative-background-dialogue-access",
    "narrative-conversation-intervention",
    "narrative-evidence-rebuttal",
    "narrative-perspective-handoff"
  ],
  "sources": [
    {
      "title": "Choose silence and let the other person continue — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/narrative-deliberate-silence/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「不提供信息也是一种回应，但未必能避免后果。」
出處：`sources/text/narrative-deliberate-silence.json` 字元 212-233 `summary.zh`
顯示：不提供信息也是一種回應，但未必能避免後果。

## 規則

「在对话中保留明确的不回答路径。玩家可以拒绝透露立场，让对方继续说、自行猜测或改变问题；系统要为沉默写出有意义的反馈，而非把它当成漏按按钮。即使没有倒计时，这个规则也可以成立。」
出處：`sources/text/narrative-deliberate-silence.json` 字元 352-439 `rules.zh`
顯示：在對話中保留明確的不回答路徑。玩家可以拒絕透露立場，讓對方繼續說、自行猜測或改變問題；系統要爲沉默寫出有意義的反饋，而非把它當成漏按按鈕。即使沒有倒計時，這個規則也可以成立。

## 核心循環

「判断是否愿意透露立场」
出處：`sources/text/narrative-deliberate-silence.json` 字元 759-769 `loop[0].zh`
顯示：判斷是否願意透露立場

「回答或保持沉默」
出處：`sources/text/narrative-deliberate-silence.json` 字元 848-855 `loop[1].zh`

「观察对方如何理解」
出處：`sources/text/narrative-deliberate-silence.json` 字元 920-928 `loop[2].zh`
顯示：觀察對方如何理解

「决定继续隐瞒还是开口」
出處：`sources/text/narrative-deliberate-silence.json` 字元 1013-1023 `loop[3].zh`
顯示：決定繼續隱瞞還是開口

## 玩家取捨

「不撒谎也不坦白，是否值得承受对方的不信任？」
出處：`sources/text/narrative-deliberate-silence.json` 字元 1131-1152 `decisions[0].zh`
顯示：不撒謊也不坦白，是否值得承受對方的不信任？

「先让对方说出更多，还是及时澄清误会？」
出處：`sources/text/narrative-deliberate-silence.json` 字元 1265-1283 `decisions[1].zh`
顯示：先讓對方說出更多，還是及時澄清誤會？

## 可調參數

「沉默反馈的明确程度」
出處：`sources/text/narrative-deliberate-silence.json` 字元 1442-1451 `parameters[0].name.zh`
顯示：沉默反饋的明確程度

「让角色追问或移开话题，可表明游戏确实接收到了这个选择。」
出處：`sources/text/narrative-deliberate-silence.json` 字元 1540-1567 `parameters[0].effect.zh`
顯示：讓角色追問或移開話題，可表明遊戲確實接收到了這個選擇。

「沉默能保留多少信息」
出處：`sources/text/narrative-deliberate-silence.json` 字元 1714-1723 `parameters[1].name.zh`

「若每次沉默都被准确猜中，隐藏信息就失去作用。」
出處：`sources/text/narrative-deliberate-silence.json` 字元 1817-1839 `parameters[1].effect.zh`
顯示：若每次沉默都被準確猜中，隱藏信息就失去作用。

## 原型

「写两次连续问话，为回答、撒谎、沉默分别保留一条可见反应。」
出處：`sources/text/narrative-deliberate-silence.json` 字元 3325-3353 `prototype.firstStep.zh`
顯示：寫兩次連續問話，爲回答、撒謊、沉默分別保留一條可見反應。

「玩家是否能预测沉默保护了什么、又损失了什么？」
出處：`sources/text/narrative-deliberate-silence.json` 字元 3632-3654 `prototype.test.zh`
顯示：玩家是否能預測沉默保護了什麼、又損失了什麼？

「不要把沉默统一写成“坏回答”，否则它只是一个陷阱按钮。」
出處：`sources/text/narrative-deliberate-silence.json` 字元 3486-3513 `prototype.pitfall.zh`
顯示：不要把沉默統一寫成“壞回答”，否則它只是一個陷阱按鈕。

## 相關模式

- [背景事件對話進出](narrative-background-dialogue-access.md)
- [對話介入](narrative-conversation-intervention.md)
- [證據反駁](narrative-evidence-rebuttal.md)
- [視角交接](narrative-perspective-handoff.md)

## 參考來源

- [Choose silence and let the other person continue — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/narrative-deliberate-silence/) — 查閱：2026-11-02；取得方式：page-text。
