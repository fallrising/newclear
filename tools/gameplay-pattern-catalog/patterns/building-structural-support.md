---
{
  "schema_version": 2,
  "id": "building-structural-support",
  "title": "支撐約束與結構失效",
  "title_en": "Structural support and collapse",
  "category": "building",
  "source_category": "building",
  "tags": [
    "constraint-graph",
    "stability",
    "spatial-planning"
  ],
  "summary": "讓建造自由受到可讀的承重關係約束，產生空間與安全的取捨。",
  "note_status": "draft",
  "related": [
    "automation-belt-routing",
    "puzzles-box-pushing"
  ],
  "sources": [
    {
      "title": "Structural support and collapse — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/building-structural-support/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 來源摘要

原站描述牆、樑與樓板受支撐規則約束，跨度過大或支撐不足可能崩塌。核心循環：建立支撐 → 延伸結構 → 讀取穩定回饋 → 補強或改形。

## 問題與情境（本地分析）

適用於希望建築形狀具有遊戲意義而非純裝飾的系統。規則需要可預測，否則失效只會被理解為隨機懲罰。

## 核心循環（本地分析）

- 玩家行動：先立柱或打基礎，再把牆、樑或樓板往外延伸，每多一格跨度都在消耗支撐餘裕。
- 系統回饋：系統即時顯示每段結構的穩定程度，快撐不住的部分在崩塌前就能被辨認出來，而不是等倒了才知道。
- 下一個決策：看到哪裡接近極限，就決定加一支柱子補強、縮短跨度改形，或接受風險繼續往外蓋。

## 解法與取捨（本地分析）

- 先採簡化的支撐圖與最大跨度，而非承諾完整物理模擬；放置前預覽結果。
- 支柱提高安全但佔用空間；更強材料需要額外投入，讓兩種解法都保有用途。

## 可調參數（本地分析）

- 支撐傳遞距離、最大跨度、材料等級、失效傳播順序與拆除回收。
- 是否提供撤銷、警告期或局部失效，以控制試錯成本。

## 失敗模式（本地分析）

- 一個隱藏規則觸發全屋連鎖毀損，會破壞玩家對系統的信任。
- 預覽與實際結算採用不同規則，導致明示安全仍失敗。

## 最小原型與驗收（本地提案）

此原型尚未實玩驗證。這裡只說明要觀察的差異，不另設來源沒有寫出的數量。

- 最小範圍：做一個小場景，讓玩家依序經歷「建立支撐」、「延伸結構」、「讀取穩定回饋」、「補強或改形」。只保留能分辨這些狀態的回饋，不加入來源沒有寫出的計數、時間或門檻。
- 驗收：玩家走完這個順序時，回饋要指出目前落在哪一步，以及下一步因此有什麼不同。若兩種做法看起來一樣，就不算通過。
- 邊界驗收：玩家跳過其中一步，或讓兩種做法得到同一種回饋時，結果必須與走完順序不同。若這時仍然看不出差異，這個原型就還沒測到取捨。

## 相關模式

- [受限空間中的物流路由](automation-belt-routing.md)：支撐不足與物流堵塞都是延後才爆開的空間失敗，讀回饋的方式不同，不能互相取代。
- [不可逆推動與位置可達性](puzzles-box-pushing.md)：延伸結構與推箱子都會讓下一步的可站位置變少；前者看的是承重，後者看的是格子是否被自己封死。

## 參考來源

- [Structural support and collapse — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/building-structural-support/) — 查閱：2026-11-02；取得方式：page-text。
