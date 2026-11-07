---
{
  "schema_version": 2,
  "id": "commerce-interpret-orders",
  "title": "顧客訂單的解讀",
  "title_en": "Interpreting customer requests",
  "category": "commerce",
  "source_category": "commerce",
  "tags": [
    "information",
    "creativity",
    "narrative"
  ],
  "summary": "从自然表达中识别需求，再用产品属性满足它。",
  "note_status": "draft",
  "related": [
    "commerce-auction-bidding",
    "commerce-price-discovery",
    "cooking-judged-flavor",
    "puzzles-language-decoding"
  ],
  "sources": [
    {
      "title": "Interpreting customer requests — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/commerce-interpret-orders/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「从自然表达中识别需求，再用产品属性满足它。」
出處：`sources/text/commerce-interpret-orders.json` 字元 185-206 `summary.zh`
顯示：從自然表達中識別需求，再用產品屬性滿足它。

## 規則

「顾客不一定直接报出商品名，可能描述症状、口味或用途。玩家解析关键条件，选择或制作合适产品；接受、拒绝与追加报酬反馈理解是否准确。」
出處：`sources/text/commerce-interpret-orders.json` 字元 323-387 `rules.zh`
顯示：顧客不一定直接報出商品名，可能描述症狀、口味或用途。玩家解析關鍵條件，選擇或製作合適產品；接受、拒絕與追加報酬反饋理解是否準確。

## 核心循環

「听取需求」
出處：`sources/text/commerce-interpret-orders.json` 字元 614-618 `loop[0].zh`
顯示：聽取需求

「提取关键属性」
出處：`sources/text/commerce-interpret-orders.json` 字元 683-689 `loop[1].zh`
顯示：提取關鍵屬性

「选择或制作产品」
出處：`sources/text/commerce-interpret-orders.json` 字元 752-759 `loop[2].zh`
顯示：選擇或製作產品

「交付并观察反馈」
出處：`sources/text/commerce-interpret-orders.json` 字元 818-825 `loop[3].zh`
顯示：交付並觀察反饋

## 玩家取捨

「满足最低要求，还是投入稀有材料完成额外偏好？」
出處：`sources/text/commerce-interpret-orders.json` 字元 907-929 `decisions[0].zh`
顯示：滿足最低要求，還是投入稀有材料完成額外偏好？

「模糊描述有多种合理答案时，选成本低还是故事上合适的？」
出處：`sources/text/commerce-interpret-orders.json` 字元 1026-1052 `decisions[1].zh`
顯示：模糊描述有多種合理答案時，選成本低還是故事上合適的？

## 可調參數

「描述含糊度」
出處：`sources/text/commerce-interpret-orders.json` 字元 1194-1199 `parameters[0].name.zh`

「适度含糊制造推理，缺少可识别线索则变猜谜。」
出處：`sources/text/commerce-interpret-orders.json` 字元 1278-1299 `parameters[0].effect.zh`
顯示：適度含糊製造推理，缺少可識別線索則變猜謎。

「可接受答案数量」
出處：`sources/text/commerce-interpret-orders.json` 字元 1440-1447 `parameters[1].name.zh`
顯示：可接受答案數量

「多个答案鼓励创造，唯一答案强调知识识别。」
出處：`sources/text/commerce-interpret-orders.json` 字元 1527-1547 `parameters[1].effect.zh`
顯示：多個答案鼓勵創造，唯一答案強調知識識別。

## 原型

「做五种有两个明确属性的商品、六条自然语言需求和可解释的反馈。」
出處：`sources/text/commerce-interpret-orders.json` 字元 3098-3128 `prototype.firstStep.zh`
顯示：做五種有兩個明確屬性的商品、六條自然語言需求和可解釋的反饋。

「顾客拒绝后，玩家能否指出遗漏的条件，并改选真正符合要求的商品。」
出處：`sources/text/commerce-interpret-orders.json` 字元 3472-3503 `prototype.test.zh`
顯示：顧客拒絕後，玩家能否指出遺漏的條件，並改選真正符合要求的商品。

「先使用人工编写的有限描述；无边界自然语言会让规则验证变困难。」
出處：`sources/text/commerce-interpret-orders.json` 字元 3286-3316 `prototype.pitfall.zh`
顯示：先使用人工編寫的有限描述；無邊界自然語言會讓規則驗證變困難。

## 相關模式

- [拍賣出價](commerce-auction-bidding.md)
- [以回饋進行價格探索](commerce-price-discovery.md)
- [評分風味](cooking-judged-flavor.md)
- [語言解碼](puzzles-language-decoding.md)

## 參考來源

- [Interpreting customer requests — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/commerce-interpret-orders/) — 查閱：2026-11-02；取得方式：page-text。
