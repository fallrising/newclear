---
{
  "schema_version": 2,
  "id": "commerce-haggling",
  "title": "議價中的讓步",
  "title_en": "Haggling",
  "category": "commerce",
  "source_category": "commerce",
  "tags": [
    "economy",
    "timing",
    "risk"
  ],
  "summary": "在成交前主动改变报价，用反应、时机或让步换取更好条件。",
  "note_status": "draft",
  "related": [
    "commerce-auction-bidding",
    "commerce-debt-pressure",
    "commerce-dynamic-market",
    "commerce-price-discovery"
  ],
  "sources": [
    {
      "title": "Haggling — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/commerce-haggling/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「在成交前主动改变报价，用反应、时机或让步换取更好条件。」
出處：`sources/text/commerce-haggling.json` 字元 153-180 `summary.zh`
顯示：在成交前主動改變報價，用反應、時機或讓步換取更好條件。

## 規則

「双方围绕同一件货物反复调整交易条件。玩家要在追加收益与交易破裂之间停手；即时反馈告诉玩家当前占优程度。」
出處：`sources/text/commerce-haggling.json` 字元 296-347 `rules.zh`
顯示：雙方圍繞同一件貨物反覆調整交易條件。玩家要在追加收益與交易破裂之間停手；即時反饋告訴玩家當前佔優程度。

## 核心循環

「确认基础报价」
出處：`sources/text/commerce-haggling.json` 字元 555-561 `loop[0].zh`
顯示：確認基礎報價

「尝试争取优势」
出處：`sources/text/commerce-haggling.json` 字元 622-628 `loop[1].zh`
顯示：嘗試爭取優勢

「判断继续或收手」
出處：`sources/text/commerce-haggling.json` 字元 689-696 `loop[2].zh`
顯示：判斷繼續或收手

「确认成交」
出處：`sources/text/commerce-haggling.json` 字元 756-760 `loop[3].zh`
顯示：確認成交

## 玩家取捨

「已经有利润时继续压价，是否值得冒失败风险？」
出處：`sources/text/commerce-haggling.json` 字元 839-860 `decisions[0].zh`
顯示：已經有利潤時繼續壓價，是否值得冒失敗風險？

「以稳妥方式尽快成交，还是投入更多操作争取上限？」
出處：`sources/text/commerce-haggling.json` 字元 954-977 `decisions[1].zh`
顯示：以穩妥方式儘快成交，還是投入更多操作爭取上限？

## 可調參數

「谈判容错」
出處：`sources/text/commerce-haggling.json` 字元 1116-1120 `parameters[0].name.zh`
顯示：談判容錯

「低容错让每次让步更紧张；高容错鼓励摸索。」
出處：`sources/text/commerce-haggling.json` 字元 1203-1223 `parameters[0].effect.zh`
顯示：低容錯讓每次讓步更緊張；高容錯鼓勵摸索。

「操作要求」
出處：`sources/text/commerce-haggling.json` 字元 1365-1369 `parameters[1].name.zh`

「节奏判定强调手感，回合报价强调读人和估值。」
出處：`sources/text/commerce-haggling.json` 字元 1447-1468 `parameters[1].effect.zh`
顯示：節奏判定強調手感，回合報價強調讀人和估值。

## 原型

「用固定卖家底价、有限耐心和三种报价动作做一场短谈判。」
出處：`sources/text/commerce-haggling.json` 字元 2928-2954 `prototype.firstStep.zh`
顯示：用固定賣家底價、有限耐心和三種報價動作做一場短談判。

「观察玩家在已获折扣时能否主动停手，并说明继续谈的风险。」
出處：`sources/text/commerce-haggling.json` 字元 3287-3314 `prototype.test.zh`
顯示：觀察玩家在已獲折扣時能否主動停手，並說明繼續談的風險。

「让反馈能反映接近底线的程度，别把结果藏在完全不可见的随机数后面。」
出處：`sources/text/commerce-haggling.json` 字元 3108-3140 `prototype.pitfall.zh`
顯示：讓反饋能反映接近底線的程度，別把結果藏在完全不可見的隨機數後面。

## 相關模式

- [拍賣出價](commerce-auction-bidding.md)
- [債務壓力](commerce-debt-pressure.md)
- [動態市場](commerce-dynamic-market.md)
- [以回饋進行價格探索](commerce-price-discovery.md)

## 參考來源

- [Haggling — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/commerce-haggling/) — 查閱：2026-11-02；取得方式：page-text。
