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
  "summary": "每多打一刀，都在花掉下一次闪避的余量。",
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

## 摘要

「每多打一刀，都在花掉下一次闪避的余量。」
出處：`sources/text/combat-stamina-budget.json` 字元 178-197 `summary.zh`
顯示：每多打一刀，都在花掉下一次閃避的餘量。

## 規則

「攻击、翻滚和受击格挡消耗同一资源；停止消耗后恢复。玩家既要打出伤害，也要为敌人的下一轮反击留下行动额度，耐力条直接暴露透支风险。」
出處：`sources/text/combat-stamina-budget.json` 字元 295-359 `rules.zh`
顯示：攻擊、翻滾和受擊格擋消耗同一資源；停止消耗後恢復。玩家既要打出傷害，也要爲敵人的下一輪反擊留下行動額度，耐力條直接暴露透支風險。

## 核心循環

「观察敌人收招」
出處：`sources/text/combat-stamina-budget.json` 字元 585-591 `loop[0].zh`
顯示：觀察敵人收招

「分配攻击与防守余量」
出處：`sources/text/combat-stamina-budget.json` 字元 659-668 `loop[1].zh`
顯示：分配攻擊與防守餘量

「出手后撤或格挡」
出處：`sources/text/combat-stamina-budget.json` 字元 737-744 `loop[2].zh`
顯示：出手後撤或格擋

「恢复后再进场」
出處：`sources/text/combat-stamina-budget.json` 字元 819-825 `loop[3].zh`
顯示：恢復後再進場

## 玩家取捨

「追击残血还是保留翻滚？击杀收益与被反打风险直接冲突。」
出處：`sources/text/combat-stamina-budget.json` 字元 911-937 `decisions[0].zh`
顯示：追擊殘血還是保留翻滾？擊殺收益與被反打風險直接衝突。

「举盾安全但恢复较慢时，何时放下盾成为主动决策。」
出處：`sources/text/combat-stamina-budget.json` 字元 1068-1091 `decisions[1].zh`
顯示：舉盾安全但恢復較慢時，何時放下盾成爲主動決策。

## 可調參數

「恢复延迟」
出處：`sources/text/combat-stamina-budget.json` 字元 1257-1261 `parameters[0].name.zh`
顯示：恢復延遲

「延迟越长，连续贪刀后的空窗越危险。」
出處：`sources/text/combat-stamina-budget.json` 字元 1337-1354 `parameters[0].effect.zh`
顯示：延遲越長，連續貪刀後的空窗越危險。

「动作成本差」
出處：`sources/text/combat-stamina-budget.json` 字元 1491-1496 `parameters[1].name.zh`
顯示：動作成本差

「重击成本高，玩家更重视命中把握和敌人的硬直。」
出處：`sources/text/combat-stamina-budget.json` 字元 1574-1596 `parameters[1].effect.zh`
顯示：重擊成本高，玩家更重視命中把握和敵人的硬直。

## 原型

「做一个固定节奏敌人、攻击和翻滚两个按钮，以及会恢复的耐力条。」
出處：`sources/text/combat-stamina-budget.json` 字元 3031-3061 `prototype.firstStep.zh`
顯示：做一個固定節奏敵人、攻擊和翻滾兩個按鈕，以及會恢復的耐力條。

「观察玩家是否会在耐力没空时主动停手，并能说出保留耐力的原因。」
出處：`sources/text/combat-stamina-budget.json` 字元 3363-3393 `prototype.test.zh`
顯示：觀察玩家是否會在耐力沒空時主動停手，並能說出保留耐力的原因。

「先别加武器库；动作成本与敌人节奏没配好，更多武器只会放大问题。」
出處：`sources/text/combat-stamina-budget.json` 字元 3209-3240 `prototype.pitfall.zh`
顯示：先別加武器庫；動作成本與敵人節奏沒配好，更多武器只會放大問題。

## 相關模式

- [訊號辨識與反應窗口](fishing-bite-window.md)
- [商店保留與選項成本](allocation-shop-reservation.md)

## 參考來源

- [Shared attack–defense stamina — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-stamina-budget/) — 查閱：2026-11-02；取得方式：page-text。
