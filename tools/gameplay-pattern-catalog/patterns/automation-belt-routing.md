---
{
  "schema_version": 2,
  "id": "automation-belt-routing",
  "title": "受限空間中的物流路由",
  "title_en": "Conveyor routing",
  "category": "automation",
  "source_category": "automation",
  "tags": [
    "flow-network",
    "throughput",
    "spatial-planning"
  ],
  "summary": "讓產能問題透過輸送路徑、容量與排隊變成可觀察的空間決策。",
  "note_status": "reviewed",
  "related": [
    "building-structural-support",
    "farming-growth-care"
  ],
  "sources": [
    {
      "title": "Conveyor routing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/automation-belt-routing/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 來源摘要

原站以有方向的輸送帶連接生產端與消耗端，容量與空間限制影響路線；缺料和排隊暴露瓶頸。核心循環：確認端點 → 選擇路線 → 投入物料 → 觀察並改線。
本次全量快照已用公開頁面內嵌條目複核。

## 問題與情境（本地分析）

適用於讓玩家透過配置改善流程的建造玩法。重點不是自動化動畫，而是路由決策能否改變可量測的產出。

## 核心循環（本地分析）

- 玩家行動：進行「確認端點、選擇路線」。這是玩家在看到後果前就付出去的承諾。
- 系統回饋：讓「投入物料」變成可區分的結果，而不是只告知成功或失敗。
- 下一個決策：依據該結果選擇「觀察並改線」，或改走成本不同的下一步。回饋若不能改變這個選擇，就不構成循環。

## 解法與取捨（本地分析）

- 建立供給、輸送、消耗三種可分辨的狀態；顯示阻塞與飢餓發生在哪一段。
- 讓短路徑、可擴充路徑與專線各有代價；保持模擬順序確定，避免結果取決於內部遍歷順序。

## 可調參數（本地分析）

- 每回合吞吐量、緩衝格數、交叉規則、混流或專線、拆改成本。
- 物流更新順序與背壓規則應先定義，再增加設備種類。

## 失敗模式（本地分析）

- 瓶頸不可見時，玩家只能亂拆重蓋。
- 視覺上的輸送速度與實際吞吐量不一致，會誤導診斷。

## 最小原型與驗收（本地提案）

此原型尚未實玩驗證。其中的數量是本地測試設定，不是來源遊戲參數。

- 本地提案：兩個來源、一個消耗端、一個交叉口；離散回合模擬，不加入電力。
- 驗收：Given 消耗端低於供給速率，When 持續運行，Then 上游排隊且物料守恆；改線或擴容後吞吐量依規則改變。

## 相關模式

- [支撐約束與結構失效](building-structural-support.md)：輸送路線與結構跨度都是空間承諾：先選一條路徑或一支點，之後才知道堵塞或崩塌出現在哪。
- [照料排程與延遲收成](farming-growth-care.md)：改線與照料都是把等待中的產能重新分配；一邊看的是排隊，一邊看的是作物時程。

## 參考來源

- [Conveyor routing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/automation-belt-routing/) — 查閱：2026-11-02；取得方式：page-text。
