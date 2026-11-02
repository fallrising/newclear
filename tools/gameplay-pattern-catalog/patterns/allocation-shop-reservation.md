---
{
  "schema_version": 1,
  "id": "allocation-shop-reservation",
  "title": "商店保留與選項成本",
  "title_en": "Reserve a shop item for a later purchase",
  "category": "allocation",
  "tags": [
    "option-value",
    "opportunity-cost",
    "future-planning"
  ],
  "summary": "保留買不起的商品，同時犧牲發現新選項的槽位。",
  "related": [
    "inventory-shape-packing",
    "commerce-price-discovery"
  ],
  "sources": [
    {
      "title": "Reserve a shop item for a later purchase — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/allocation-shop-reservation/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 來源摘要

原站描述保留的商品跨刷新留在商店，未保留的槽位仍更新；保留可等待資金或組合，也會佔掉探索新商品的位置。核心循環：看到未能購買的商品 → 保留 → 重新評估 → 購買或釋放。

## 問題與情境（本地分析）

適用於隨機商店與配置成長系統。設計問題是如何讓短期資金不足不立即消滅計畫，同時避免保留成為沒有代價的必選操作。

## 解法與取捨（本地分析）

- 把保留當作有限選擇權，而不是免費倉庫；明確顯示它阻擋的是哪個新選項。
- 取消保留是正常決策，應能清楚操作；購買後需一致釋放槽位並結算資金。

## 可調參數（本地分析）

- 商店槽位數、可保留上限、刷新成本、保留期限與取消費用。
- 保留是否鎖價格需明文定義，不能由介面外觀暗示。

## 失敗模式（本地分析）

- 全部商品都可無限保留，取捨消失。
- 刷新時誤替換已保留商品，會破壞核心承諾。

## 最小原型與驗收（本地提案）

- 本地提案：三個商品槽、最多保留一個、兩輪收入與固定刷新操作。
- 驗收：Given 一格已保留，When 刷新商店，Then 該格商品 ID 不變、其餘格可更新；取消後下一次刷新恢復可替換。

## 相關模式

- [形狀式背包配置](inventory-shape-packing.md)
- [以回饋進行價格探索](commerce-price-discovery.md)

## 參考來源

- [Reserve a shop item for a later purchase — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/allocation-shop-reservation/) — 查閱：2026-11-02；取得方式：page-text。
