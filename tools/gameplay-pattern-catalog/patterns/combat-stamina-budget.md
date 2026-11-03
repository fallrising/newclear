---
{
  "schema_version": 2,
  "id": "combat-stamina-budget",
  "title": "攻守共用資源預算",
  "title_en": "Shared attack–defense stamina",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "shared-budget",
    "risk-reward",
    "recovery-window"
  ],
  "summary": "讓額外一次進攻消耗同一份防守餘裕，形成過度承諾的風險。",
  "note_status": "draft",
  "related": [
    "fishing-bite-window",
    "allocation-shop-reservation"
  ],
  "sources": [
    {
      "title": "Shared attack–defense stamina — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-stamina-budget/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 來源摘要

原站描述攻擊、翻滾與格擋共用會恢復的體力；進攻時要預留對付下一次回擊的額度。核心循環：辨識空檔 → 分配攻守體力 → 行動 → 回復並重新接戰。

## 問題與情境（本地分析）

適用於希望玩家控制節奏，而非只按冷卻好的技能的戰鬥。資源必須真正連接進攻與生存，否則只是多一條需要管理的數值。

## 核心循環（本地分析）

- 玩家行動：看出敵人的空檔後，決定這一波要花多少體力在攻擊上、又要留多少給翻滾或格擋。
- 系統回饋：出手後體力條立刻反映剩餘額度；敵人回擊時，玩家會直接感受到留下的體力夠不夠閃開或擋住。
- 下一個決策：依剩餘體力判斷是退開等回復、趁勢再補一刀，還是改用較省體力的防守重新接戰。

## 解法與取捨（本地分析）

- 用同一預算服務不同用途，並在輸入前提供可讀餘額與成本。
- 敵人回擊前兆與玩家回復規則一起決定風險；不能只單獨調整攻擊成本。

## 可調參數（本地分析）

- 體力上限、攻擊與閃避成本、回復延遲、格擋時回復倍率。
- 是否允許負體力、輸入緩衝與動作取消；這些規則必須先明確。

## 失敗模式（本地分析）

- 唯一最優策略是永遠退後等滿，會讓節奏僵化。
- 體力不足仍播放成功動作但沒有防守效果，會讓玩家誤判。

## 最小原型與驗收（本地提案）

此原型尚未實玩驗證。其中的數量是本地測試設定，不是來源遊戲參數。

- 本地提案：一種敵人、攻擊與閃避兩個動作、固定回擊節奏；數值僅為測試設定。
- 驗收：Given 餘額不足閃避成本，When 請求閃避，Then 明確拒絕且不改變狀態；觀察玩家是否為回擊保留體力。

## 相關模式

- [訊號辨識與反應窗口](fishing-bite-window.md)：兩者都要求在窗口裡做一個難以撤回的動作；體力預算花的是後續退路，咬鉤窗口花的是這一次等待。
- [商店保留與選項成本](allocation-shop-reservation.md)：多打一下與多留一個商品都是把未來的彈性拿來換現在的機會。

## 參考來源

- [Shared attack–defense stamina — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-stamina-budget/) — 查閱：2026-11-02；取得方式：page-text。
