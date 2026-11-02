---
{
  "schema_version": 2,
  "id": "inventory-adjacency",
  "title": "相鄰關係驅動的組合加成",
  "title_en": "Item adjacency bonuses",
  "category": "inventory",
  "source_category": "inventory",
  "tags": [
    "spatial-synergy",
    "dependency-graph",
    "composition"
  ],
  "summary": "讓物品價值由周圍關係決定，將背包升級為可讀的配置網路。",
  "note_status": "reviewed",
  "related": [
    "inventory-shape-packing",
    "automation-belt-routing"
  ],
  "sources": [
    {
      "title": "Item adjacency bonuses — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/inventory-adjacency/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 來源摘要

原站描述相鄰位置、方向或鄰近物品類型會觸發效果；玩家查看有效連結再依結果調整。核心循環：理解作用範圍 → 安排鄰居 → 檢查連結 → 依結果重排。
本次全量快照已用公開頁面內嵌條目複核。

## 問題與情境（本地分析）

適用於要讓配置方式影響效益的背包或盤面系統。玩家需要能預測局部變動如何影響整體，而不是只能事後讀到總戰力。

## 核心循環（本地分析）

- 玩家行動：進行「理解作用範圍、安排鄰居」。這是玩家在看到後果前就付出去的承諾。
- 系統回饋：讓「檢查連結」變成可區分的結果，而不是只告知成功或失敗。
- 下一個決策：依據該結果選擇「依結果重排」，或改走成本不同的下一步。回饋若不能改變這個選擇，就不構成循環。

## 解法與取捨（本地分析）

- 用可視連結或格子高亮顯示生效條件；區分基礎數值、加成來源與最終數值。
- 先採無循環的規則或固定結算次序；若允許相互增幅，需定義上限與收斂方式。

## 可調參數（本地分析）

- 四向或八向鄰接、影響半徑、方向、種類相容性、疊加上限。
- 放入新物品後是局部重算還是全盤重算，應產生一致結果。

## 失敗模式（本地分析）

- 無上限的相互加成可能導致數值爆炸。
- 介面只顯示總分，不顯示斷掉的連結，會阻礙學習。

## 最小原型與驗收（本地提案）

此原型尚未實玩驗證。其中的數量是本地測試設定，不是來源遊戲參數。

- 本地提案：4×4 盤面、五個物品、一條供能與一條分類加成；不加入戰鬥。
- 驗收：Given 相鄰加成已生效，When 將其中一件移出範圍，Then 連線與增益同步消失；觀察玩家能否在放置前預測結果。

## 相關模式

- [形狀式背包配置](inventory-shape-packing.md)：相鄰加成與形狀裝填都讓背包位置產生價值，但一個看鄰居，一個看輪廓能不能放下。
- [受限空間中的物流路由](automation-belt-routing.md)：相鄰連結與輸送路線都是在擺放之後才看得到阻塞或增益的網路。

## 參考來源

- [Item adjacency bonuses — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/inventory-adjacency/) — 查閱：2026-11-02；取得方式：page-text。
