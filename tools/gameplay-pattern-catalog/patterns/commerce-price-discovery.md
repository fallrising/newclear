---
{
  "schema_version": 2,
  "id": "commerce-price-discovery",
  "title": "以回饋進行價格探索",
  "title_en": "Price discovery",
  "category": "commerce",
  "source_category": "commerce",
  "tags": [
    "information-gain",
    "exploration-exploitation",
    "pricing"
  ],
  "summary": "讓一次報價同時帶來收益或資訊，形成成交與試探的取捨。",
  "note_status": "reviewed",
  "related": [
    "relationships-gift-allocation",
    "allocation-shop-reservation"
  ],
  "sources": [
    {
      "title": "Price discovery — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/commerce-price-discovery/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 來源摘要

公開頁面描述玩家為待售物訂價，觀察顧客是否接受以及情緒反應，再把觀察用於下一輪報價。較高價格提高單筆收益，也可能失去成交。核心循環：選品並估價 → 報出試探價格 → 觀察顧客反應 → 調整下一次報價。本次對照的是頁面內嵌的公開條目；先前精選版只核到搜尋索引摘錄，該限制已由這次直接取得取代。

## 問題與情境（本地分析）

適用於把未知需求轉化為可學習決策的商業玩法。重點是讓玩家知道每次失敗也可能縮小不確定性，而非單純猜一個隱藏標準答案。

## 核心循環（本地分析）

- 玩家行動：進行「估價、試價」。這是玩家在看到後果前就付出去的承諾。
- 系統回饋：讓「觀察」變成可區分的結果，而不是只告知成功或失敗。
- 下一個決策：依據該結果選擇「更新下一次選擇。此筆僅核對搜尋摘錄，未取得完整互動頁」，或改走成本不同的下一步。回饋若不能改變這個選擇，就不構成循環。

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

此原型尚未實玩驗證。其中的數量是本地測試設定，不是來源遊戲參數。

- 本地提案：一種商品、兩類顧客、有限庫存與報價紀錄；不建立完整市場模擬。
- 驗收：Given 同類顧客與固定預算規則，When 提高到超過接受範圍的價格，Then 拒絕並提供一致回饋；觀察玩家是否依歷史結果縮小試價範圍。

## 相關模式

- [偏好探索與禮物分配](relationships-gift-allocation.md)：報價與贈禮都用一次具體付出換取對方反應，重點是反應能不能指導下一次分配。
- [商店保留與選項成本](allocation-shop-reservation.md)：試探價格與保留商品都處理「現在不確定值不值得承諾」；一個改變報價，一個佔住貨架。

## 參考來源

- [Price discovery — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/commerce-price-discovery/) — 查閱：2026-11-02；取得方式：page-text。
