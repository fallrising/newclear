---
{
  "schema_version": 1,
  "id": "commerce-price-discovery",
  "title": "以回饋進行價格探索",
  "title_en": "Price discovery",
  "category": "commerce",
  "tags": [
    "information-gain",
    "exploration-exploitation",
    "pricing"
  ],
  "summary": "讓一次報價同時帶來收益或資訊，形成成交與試探的取捨。",
  "related": [
    "relationships-gift-allocation",
    "allocation-shop-reservation"
  ],
  "sources": [
    {
      "title": "Price discovery — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/commerce-price-discovery/",
      "accessed": "2026-11-02",
      "access_method": "search-index-excerpt"
    }
  ]
}
---

## 來源摘要

原站的搜尋索引摘錄描述：玩家提出售價，觀察顧客是否接受與其反應，再調整報價。核心循環：估價 → 試價 → 觀察 → 更新下一次選擇。此筆僅核對搜尋摘錄，未取得完整互動頁。

## 問題與情境（本地分析）

適用於把未知需求轉化為可學習決策的商業玩法。重點是讓玩家知道每次失敗也可能縮小不確定性，而非單純猜一個隱藏標準答案。

## 解法與取捨（本地分析）

- 將成交收益與資訊價值分開考慮；為顧客差異提供可觀察的分類或線索。
- 保存報價與反應紀錄，讓調價基於證據；不要將單一客人的接受價當成全市場真值。

## 可調參數（本地分析）

- 顧客預算分布、需求變動、回饋精度、庫存成本與試價機會數。
- 市場變動與隨機雜訊需區分，否則玩家無法判斷是否應修正模型。

## 失敗模式（本地分析）

- 完全隨機的反應會破壞可學習性；直接告知最優價格則消除探索。
- 顧客種類隱藏而且變動過大，容易把合理試探誤導成錯誤規則。

## 最小原型與驗收（本地提案）

- 本地提案：一種商品、兩類顧客、有限庫存與報價紀錄；不建立完整市場模擬。
- 驗收：Given 同類顧客與固定預算規則，When 提高到超過接受範圍的價格，Then 拒絕並提供一致回饋；觀察玩家是否依歷史結果縮小試價範圍。

## 相關模式

- [偏好探索與禮物分配](relationships-gift-allocation.md)
- [商店保留與選項成本](allocation-shop-reservation.md)

## 參考來源

- [Price discovery — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/commerce-price-discovery/) — 查閱：2026-11-02；取得方式：search-index-excerpt。
