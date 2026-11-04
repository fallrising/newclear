---
{
  "schema_version": 2,
  "id": "allocation-shop-reservation",
  "title": "商店保留與選項成本",
  "title_en": "Reserve a shop item for a later purchase",
  "category": "allocation",
  "source_category": "commerce",
  "tags": [
    "option-value",
    "opportunity-cost",
    "future-planning"
  ],
  "summary": "保留買不起的商品，同時犧牲發現新選項的槽位。",
  "note_status": "draft",
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

## 核心循環（本地分析）

- 玩家行動：看到一件現在買不起、或還湊不成組合的商品，決定花一個保留位把它鎖住，而不是讓它在下次刷新時消失。
- 系統回饋：刷新後，被保留的商品留在原位，其餘槽位換上新貨；玩家能直接比較「鎖住的那件」與「新出現的選項」，也看得出保留位擠掉了多少探索空間。
- 下一個決策：資金或組合到位就買下；若新貨更好或等待太久，就釋放保留位，把空間還給刷新。

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

此原型尚未實玩驗證。下列通過與否是本地判斷。

- 最小範圍：（本地分析）做一個小場景，讓玩家依序經歷「找到暫時無法購買的目標」、「標記保留並重新整理其他格」、「獲得資金或改變需求」、「購買目標或解除保留」。來源的原型第一步是「四格商店、刷新按鈕、金幣和保留標記，先做兩輪即可」。
- 驗收：（本地分析）對照來源規則「玩家標記商店中的某個物品，使它在刷新或下一輪補貨時保留，未保留的格子繼續更新」。通過要能滿足「玩家是否會主動解除不再需要的保留，而非永遠佔著格子」，並分得出「為未來組合保留一件，會不會錯過本輪更實用的新貨」。做不到就算失敗。
- 邊界驗收：（本地分析）來源指出要避開的情況是「保留和購買必須有明確區分，避免誤以為已經擁有物品」。通過要直接檢查這件事：踩進這個情況時，結果必須和避開時不同；看不出差別，就不算測到這個邊界。

## 相關模式

- [形狀式背包配置](inventory-shape-packing.md)：（本地分析）兩者都在有限格子裡放棄一個未來選項；保留商品放棄的是下一輪貨架，形狀背包放棄的是之後還放得下的輪廓。
- [以回饋進行價格探索](commerce-price-discovery.md)：（本地分析）保留是在資金不足時先佔住選項，價格探索是在成交與資訊之間報價；都能把「現在買不起或不確定」變成可管理的行動。

## 參考來源

- [Reserve a shop item for a later purchase — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/allocation-shop-reservation/) — 查閱：2026-11-02；取得方式：page-text。
