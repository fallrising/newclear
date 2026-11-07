---
{
  "schema_version": 2,
  "id": "combat-pause-orders",
  "title": "暫停指令",
  "title_en": "Pausing to issue orders",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "planning",
    "information",
    "time"
  ],
  "summary": "事情同时发生太多时，暂停一下，把队伍安排明白。",
  "note_status": "draft",
  "related": [
    "combat-simultaneous-orders",
    "combat-intent-preview",
    "automation-item-filtering",
    "combat-action-points"
  ],
  "sources": [
    {
      "title": "Pausing to issue orders — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-pause-orders/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「事情同时发生太多时，暂停一下，把队伍安排明白。」
出處：`sources/text/combat-pause-orders.json` 字元 173-196 `summary.zh`
顯示：事情同時發生太多時，暫停一下，把隊伍安排明白。

## 規則

「战斗平时实时进行，玩家随时暂停观察局面，并给不同角色或系统下令。解除暂停后命令在实时环境中执行；出现新的伤情、目标或故障，再暂停调整。暂停不自动解决问题，关键是它允许玩家处理并行任务。」
出處：`sources/text/combat-pause-orders.json` 字元 302-394 `rules.zh`
顯示：戰鬥平時實時進行，玩家隨時暫停觀察局面，並給不同角色或系統下令。解除暫停後命令在實時環境中執行；出現新的傷情、目標或故障，再暫停調整。暫停不自動解決問題，關鍵是它允許玩家處理並行任務。

## 核心循環

「发现同时发生的问题」
出處：`sources/text/combat-pause-orders.json` 字元 703-712 `loop[0].zh`
顯示：發現同時發生的問題

「暂停并确定优先级」
出處：`sources/text/combat-pause-orders.json` 字元 784-792 `loop[1].zh`
顯示：暫停並確定優先級

「分配多个指令」
出處：`sources/text/combat-pause-orders.json` 字元 856-862 `loop[2].zh`
顯示：分配多個指令

「继续时间检查效果」
出處：`sources/text/combat-pause-orders.json` 字元 927-935 `loop[3].zh`
顯示：繼續時間檢查效果

## 玩家取捨

「先救危险队员，还是先打断敌人的下一次攻击？」
出處：`sources/text/combat-pause-orders.json` 字元 1029-1050 `decisions[0].zh`
顯示：先救危險隊員，還是先打斷敵人的下一次攻擊？

「指令已经够用，要继续时间验证，还是还要调整其他角色？」
出處：`sources/text/combat-pause-orders.json` 字元 1154-1180 `decisions[1].zh`
顯示：指令已經夠用，要繼續時間驗證，還是還要調整其他角色？

## 可調參數

「自动暂停事件」
出處：`sources/text/combat-pause-orders.json` 字元 1330-1336 `parameters[0].name.zh`
顯示：自動暫停事件

「关键事件自动暂停能降低漏看风险，过多则会切碎节奏。」
出處：`sources/text/combat-pause-orders.json` 字元 1415-1440 `parameters[0].effect.zh`
顯示：關鍵事件自動暫停能降低漏看風險，過多則會切碎節奏。

「指令队列深度」
出處：`sources/text/combat-pause-orders.json` 字元 1603-1609 `parameters[1].name.zh`
顯示：指令隊列深度

「一次只能给一条更直观；多条队列提升规划能力也增加修改成本。」
出處：`sources/text/combat-pause-orders.json` 字元 1688-1717 `parameters[1].effect.zh`
顯示：一次只能給一條更直觀；多條隊列提升規劃能力也增加修改成本。

## 原型

「用三个房间、两名角色、火灾和维修两类任务，先验证暂停下令到恢复执行。」
出處：`sources/text/combat-pause-orders.json` 字元 3154-3188 `prototype.firstStep.zh`
顯示：用三個房間、兩名角色、火災和維修兩類任務，先驗證暫停下令到恢復執行。

「让试玩者处理两个同时发生的事件，检查他能否说清每个人恢复后会做什么。」
出處：`sources/text/combat-pause-orders.json` 字元 3478-3512 `prototype.test.zh`
顯示：讓試玩者處理兩個同時發生的事件，檢查他能否說清每個人恢復後會做什麼。

「暂停期间的目标变化或旧指令覆盖不清，会让玩家以为命令没生效。」
出處：`sources/text/combat-pause-orders.json` 字元 3321-3351 `prototype.pitfall.zh`
顯示：暫停期間的目標變化或舊指令覆蓋不清，會讓玩家以爲命令沒生效。

## 相關模式

- [同時指令](combat-simultaneous-orders.md)
- [意圖預覽](combat-intent-preview.md)
- [物品篩選](automation-item-filtering.md)
- [行動點數](combat-action-points.md)

## 參考來源

- [Pausing to issue orders — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-pause-orders/) — 查閱：2026-11-02；取得方式：page-text。
