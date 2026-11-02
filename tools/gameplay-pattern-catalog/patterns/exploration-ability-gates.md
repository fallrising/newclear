---
{
  "schema_version": 1,
  "id": "exploration-ability-gates",
  "title": "能力解鎖與回訪",
  "title_en": "Ability-gated backtracking",
  "category": "exploration",
  "tags": [
    "capability-gate",
    "backtracking",
    "world-connectivity"
  ],
  "summary": "讓新能力重新解釋舊場景，而不只是打開下一張線性地圖。",
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

- 本地提案：六個房間、一項位移能力、兩個舊障礙與一條可回接捷徑。
- 驗收：Given 未取得能力，When 計算可達區域，Then 兩處障礙不可通過；取得後兩處都可通過，並形成更短的回訪路線。

## 相關模式

- [工具能力門檻](gathering-tool-hardness.md)
- [不可逆推動與位置可達性](puzzles-box-pushing.md)

## 參考來源

- [Ability-gated backtracking — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/exploration-ability-gates/) — 查閱：2026-11-02；取得方式：page-text。
