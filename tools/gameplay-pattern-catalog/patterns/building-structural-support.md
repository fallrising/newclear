---
{
  "schema_version": 1,
  "id": "building-structural-support",
  "title": "支撐約束與結構失效",
  "title_en": "Structural support and collapse",
  "category": "building",
  "tags": [
    "constraint-graph",
    "stability",
    "spatial-planning"
  ],
  "summary": "讓建造自由受到可讀的承重關係約束，產生空間與安全的取捨。",
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

- 本地提案：地基、樑、樓板三種元件；二維網格與固定跨度上限。
- 驗收：Given 接近跨度上限的樓板，When 再延伸一格，Then 預覽標出失效區；加入支柱後預覽與實際結果一致。

## 相關模式

- [受限空間中的物流路由](automation-belt-routing.md)
- [不可逆推動與位置可達性](puzzles-box-pushing.md)

## 參考來源

- [Structural support and collapse — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/building-structural-support/) — 查閱：2026-11-02；取得方式：page-text。
