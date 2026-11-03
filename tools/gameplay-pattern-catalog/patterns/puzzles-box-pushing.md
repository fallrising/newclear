---
{
  "schema_version": 2,
  "id": "puzzles-box-pushing",
  "title": "不可逆推動與位置可達性",
  "title_en": "Box pushing and positional traps",
  "category": "puzzles",
  "source_category": "puzzles",
  "tags": [
    "state-space",
    "deadlock",
    "action-order"
  ],
  "summary": "讓每一步同時改變物件位置與玩家之後能站的位置。",
  "note_status": "draft",
  "related": [
    "inventory-shape-packing",
    "building-structural-support"
  ],
  "sources": [
    {
      "title": "Box pushing and positional traps — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/puzzles-box-pushing/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 來源摘要

原站描述從相鄰格推動箱子，某些推法可能封住對側站位或困住箱子；操作順序與撤銷有關。核心循環：找目標與死角 → 規劃站位 → 按順序推動 → 判定或撤銷。

## 問題與情境（本地分析）

適用於低操作門檻、重視推理與先後順序的空間謎題。評估一個動作時，必須把玩家可達區域與箱子位置一起納入狀態。

## 核心循環（本地分析）

- 玩家行動：先找出目標位置與會困死箱子的死角，規劃自己要站在哪一格才能往正確方向推。
- 系統回饋：每推一步，箱子與玩家的新位置都會改變之後的可達範圍；某些推法可能封住對側站位或困住箱子，使後續操作空間改變。
- 下一個決策：判斷局面是否仍可解：還能解就照順序繼續推，已經封死就撤銷回到出錯前的那一步。

## 解法與取捨（本地分析）

- 把狀態表示為箱子位置集合加玩家位置；重新計算可達區域，不只檢查目標格是否空。
- 提供可靠撤銷降低探索成本；死鎖提示可作為教學選項，而非直接代解。

## 可調參數（本地分析）

- 來源參數：箱子特殊性質——少量例外可擴展解法；太多例外削弱可讀性。
- 本地測試旋鈕：可推或可拉、箱子數量、通道寬度、目標位置與撤銷深度。
- 先以幾個可辨識死角建立難度，再考慮複雜連鎖條件。

## 失敗模式（本地分析）

- 關卡沒有可達解或撤銷遺失部分狀態，會讓試錯無法信任。
- 只增加箱子數，可能擴大搜尋量卻沒有增加有趣的推理。

## 最小原型與驗收（本地提案）

此原型尚未實玩驗證。其中的數量是本地測試設定，不是來源遊戲參數。

- 本地提案：一張小網格、兩個箱子、兩個目標、完整撤銷紀錄。
- 驗收：Given 推箱後封住回路，When 撤銷一次，Then 玩家與所有箱子精確回到前一狀態；另以小型狀態搜尋證明範例關卡可解。

## 相關模式

- [形狀式背包配置](inventory-shape-packing.md)：推箱與形狀背包都是在格子裡移動輪廓，差別是推箱還會擋住自己的站位。
- [支撐約束與結構失效](building-structural-support.md)：錯誤的推動與過長的跨度都會把退路一起拆掉，而且失敗原因必須能讀出來。

## 參考來源

- [Box pushing and positional traps — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/puzzles-box-pushing/) — 查閱：2026-11-02；取得方式：page-text。
