---
{
  "schema_version": 1,
  "id": "cooking-recipe-learning",
  "title": "知識與材料雙重解鎖",
  "title_en": "Recipe knowledge unlocks",
  "category": "cooking",
  "tags": [
    "knowledge-gate",
    "progression",
    "resource-budget"
  ],
  "summary": "把「知道怎麼做」與「有能力做」分成兩個可組合的進度條件。",
  "related": [
    "gathering-tool-hardness",
    "relationships-gift-allocation"
  ],
  "sources": [
    {
      "title": "Recipe knowledge unlocks — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooking-recipe-learning/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 來源摘要

原站將配方知識與材料取得視為不同門檻；玩家先尋找配方，再湊齊資源製作。核心循環：找到知識線索 → 學會配方 → 取得材料 → 製作並使用。

## 問題與情境（本地分析）

適用於探索、角色互動與製作要互相帶動的系統。只有材料稀缺時，所有進度容易收斂為刷資源；加入知識門檻可讓尋路與發現有獨立價值。

## 解法與取捨（本地分析）

- 用明確狀態區分未知配方、已知但缺料、可製作；不要把所有失敗都顯示為同一個灰色按鈕。
- 允許玩家追蹤缺少的材料或知識來源，讓下一步行動可理解。

## 可調參數（本地分析）

- 配方取得方式、材料替代規則、一次性知識與消耗性圖紙的差異。
- 配方效果的預覽程度，以及解鎖後是否仍需要製作設施。

## 失敗模式（本地分析）

- 多個不可見門檻疊加，玩家只會不斷嘗試而無法形成計畫。
- 知識解鎖沒有新用途，只增加同質產物數量。

## 最小原型與驗收（本地提案）

- 本地提案：三個配方、三種材料、單一工作台；用探索或對話解鎖其中一個。
- 驗收：Given 材料齊全但尚未學會配方，When 嘗試製作，Then 回饋缺的是知識；學會後材料相同即可製作。

## 相關模式

- [工具能力門檻](gathering-tool-hardness.md)
- [偏好探索與禮物分配](relationships-gift-allocation.md)

## 參考來源

- [Recipe knowledge unlocks — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooking-recipe-learning/) — 查閱：2026-11-02；取得方式：page-text。
