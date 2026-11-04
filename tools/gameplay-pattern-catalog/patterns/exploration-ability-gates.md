---
{
  "schema_version": 2,
  "id": "exploration-ability-gates",
  "title": "能力解鎖與回訪",
  "title_en": "Ability-gated backtracking",
  "category": "exploration",
  "source_category": "exploration",
  "tags": [
    "capability-gate",
    "backtracking",
    "world-connectivity"
  ],
  "summary": "讓新能力重新解釋舊場景，而不只是打開下一張線性地圖。",
  "note_status": "draft",
  "related": [
    "gathering-tool-hardness",
    "puzzles-box-pushing"
  ],
  "sources": [
    {
      "title": "Ability-gated backtracking — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/exploration-ability-gates/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 來源摘要

原站描述先遇見不可通過的障礙，獲得能力後返回，開啟房間或新的連通路線。核心循環：辨識障礙 → 記住位置 → 取得能力 → 回訪並改變路網。

## 問題與情境（本地分析）

適用於希望玩家累積空間記憶的探索遊戲。進度的回報可以是世界連通性改變，而非只有數值成長。

## 核心循環（本地分析）

- 玩家行動：遇到暫時過不去的障礙，辨認它需要哪一種能力，並記住位置留待之後回來。
- 系統回饋：取得新能力時，玩家能把它連回先前記住的障礙，地圖上哪些地點可以重新嘗試變得清楚。
- 下一個決策：探索當下要繼續找主路，還是為可疑支路做標記？取得能力後，則決定先回訪哪個舊地點：打開捷徑改變路網、取得藏著的房間，還是繼續往新區域推進。

## 解法與取捨（本地分析）

- 以能力需求標記世界圖的邊，讓新能力同時影響多條可理解的路徑。
- 提供地圖標記或可辨識地標，降低純記憶負擔；回訪應帶來新路線而非只跑長路。

## 可調參數（本地分析）

- 每項能力影響的障礙數、回訪距離、捷徑密度、障礙提示程度。
- 能力能否組合，以及取得能力前是否允許技巧性提早通過。

## 失敗模式（本地分析）

- 升級後玩家不知道哪裡改變，回訪就變成逐格掃地圖。
- 所有障礙只開一扇新門，會退化為換皮鑰匙鏈。

## 最小原型與驗收（本地提案）

此原型尚未實玩驗證。這裡只說明要觀察的差異，不另設來源沒有寫出的數量。

- 最小範圍：做一個小場景，讓玩家依序經歷「辨識障礙」、「記住位置」、「取得能力」、「回訪並改變路網」。只保留能分辨這些狀態的回饋，不加入來源沒有寫出的計數、時間或門檻。
- 驗收：（本地分析）對照來源規則「地圖用跳躍距離、牆面、特殊障礙等限制通行」。通過要能滿足「取得能力後不給任務標記，觀察玩家能否主動想起至少一處舊障礙」，並分得出「繼續尋找主路，還是為可疑支路做標記？玩家在未知收益間分配注意力」。做不到就算失敗。
- 邊界驗收：（本地分析）來源指出的邊界是「地圖沒形成值得回訪的連接時，增加能力只會增加找路負擔」。若「新能力到手後，先推進還是回收舊區域，形成節奏選擇」只剩一種走法，就不算測到這個邊界。

## 相關模式

- [工具能力門檻](gathering-tool-hardness.md)：能力門與工具門都讓玩家先記住一個去不了的地方，升級後再回來。
- [不可逆推動與位置可達性](puzzles-box-pushing.md)：回訪捷徑與推箱順序都依賴先前位置還在不在；一個用新能力重解舊路，一個用站位避免封死。

## 參考來源

- [Ability-gated backtracking — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/exploration-ability-gates/) — 查閱：2026-11-02；取得方式：page-text。
