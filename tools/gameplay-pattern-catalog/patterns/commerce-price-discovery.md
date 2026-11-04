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
  "note_status": "draft",
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

公開頁面描述玩家為待售物訂價，觀察顧客是否接受以及情緒反應，再把觀察用於下一輪報價。較高價格提高單筆收益，也可能失去成交。核心循環：選品並估價 → 報出試探價格 → 觀察顧客反應 → 調整下一次報價。

## 問題與情境（本地分析）

適用於把未知需求轉化為可學習決策的商業玩法。重點是讓玩家知道每次失敗也可能縮小不確定性，而非單純猜一個隱藏標準答案。

## 核心循環（本地分析）

- 玩家行動：挑一件要賣的商品，先估出心中價位，再報出一個帶試探意味的價格。
- 系統回饋：顧客接受或拒絕，並露出滿意、猶豫或不悅等反應；這些反應讓玩家知道報價離對方的接受範圍有多遠。
- 下一個決策：依反應調整下一次報價：成交得太輕鬆就往上試，被拒或對方不悅就往回收，同時記下這類顧客的區間。

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

此原型尚未實玩驗證。這裡只說明要觀察的差異，不另設來源沒有寫出的數量。

- 最小範圍：做一個小場景，讓玩家依序經歷「選品並估價」、「報出試探價格」、「觀察顧客反應」、「調整下一次報價」。只保留能分辨這些狀態的回饋，不加入來源沒有寫出的計數、時間或門檻。
- 驗收：玩家走完這個順序時，回饋要指出目前落在哪一步，以及下一步因此有什麼不同。若兩種做法看起來一樣，就不算通過。
- 邊界驗收：玩家跳過其中一步，或讓兩種做法得到同一種回饋時，結果必須與走完順序不同。若這時仍然看不出差異，這個原型就還沒測到取捨。

## 相關模式

- [偏好探索與禮物分配](relationships-gift-allocation.md)：報價與贈禮都用一次具體付出換取對方反應，重點是反應能不能指導下一次分配。
- [商店保留與選項成本](allocation-shop-reservation.md)：試探價格與保留商品都處理「現在不確定值不值得承諾」；一個改變報價，一個佔住貨架。

## 參考來源

- [Price discovery — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/commerce-price-discovery/) — 查閱：2026-11-02；取得方式：page-text。
