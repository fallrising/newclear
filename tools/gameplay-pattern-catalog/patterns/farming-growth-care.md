---
{
  "schema_version": 2,
  "id": "farming-growth-care",
  "title": "照料排程與延遲收成",
  "title_en": "Planting and crop care",
  "category": "farming",
  "source_category": "farming",
  "tags": [
    "time-budget",
    "delayed-reward",
    "maintenance"
  ],
  "summary": "把成長等待與日常照料結合，讓擴張受到可用行動時間約束。",
  "note_status": "draft",
  "related": [
    "cooking-recipe-learning",
    "automation-belt-routing"
  ],
  "sources": [
    {
      "title": "Planting and crop care — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/farming-growth-care/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 來源摘要

原站描述播種後持續照料、等待成熟再收成的循環；擴張田地也增加維護負擔。核心循環：準備種植 → 投入照料 → 安排等待期間的活動 → 收成並重選作物。

## 問題與情境（本地分析）

適用於需要讓玩家規劃短期工作與中期回報的經營系統。問題不只是「多久給一次錢」，而是如何讓增加產能同時產生可理解的維護成本。

## 核心循環（本地分析）

- 玩家行動：整地播種後投入澆水等照料，等於先承諾了之後一段時間的維護工作。
- 系統回饋：作物依時間與照料條件逐步成長；芽、成熟外觀與收穫物讓進度可見。本地設計提案是另外顯示每塊田的照料需求與剩餘成熟時間，讓玩家看出哪塊田需要照顧、空檔時間能安排其他活動；快照未說來源遊戲已有此提示。
- 下一個決策：收成後依這輪的收益與維護負擔，決定擴田、縮田或換成生長週期不同的作物。

## 解法與取捨（本地分析）

- 分離成長時鐘與照料條件；明確顯示缺少的條件，而非讓玩家猜測停滯原因。
- 整批收成降低切換成本，錯峰收成改善現金流；兩者應各有合理情境。

## 可調參數（本地分析）

- 照料頻率、每次操作成本、成熟時間、缺水後的延遲幅度。
- 同時可照料的格數與收成窗口；先使用遊戲內回合，避免把現實作息當懲罰。

## 失敗模式（本地分析）

- 每天重複點擊卻沒有取捨，會把規劃退化為例行勞務。
- 失誤直接永久損失全部產出，可能壓過學習回饋。

## 最小原型與驗收（本地提案）

此原型尚未實玩驗證。其中的數量是本地測試設定，不是來源遊戲參數。

- 本地提案：做四塊田、兩種生長週期、每回合三次照料額度，不加入天氣或市場。
- 驗收：Given 同時種滿四塊田，When 照料額度不足，Then 系統指出延遲的作物；觀察玩家是否開始安排錯峰播種。

## 相關模式

- [知識與材料雙重解鎖](cooking-recipe-learning.md)：收成提供材料，配方決定這些材料能不能變成新選項；兩邊的門檻不在同一步。
- [受限空間中的物流路由](automation-belt-routing.md)：田地擴張與輸送擴張都會把維護成本一起放大，不能只看單次產出。

## 參考來源

- [Planting and crop care — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/farming-growth-care/) — 查閱：2026-11-02；取得方式：page-text。
