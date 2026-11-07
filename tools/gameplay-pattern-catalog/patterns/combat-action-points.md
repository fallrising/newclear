---
{
  "schema_version": 2,
  "id": "combat-action-points",
  "title": "行動點數",
  "title_en": "Shared action points",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "planning",
    "economy",
    "spatial"
  ],
  "summary": "每回合预算有限，走近一点就可能少打一次。",
  "note_status": "draft",
  "related": [
    "combat-cover-flanking",
    "combat-destructible-cover",
    "combat-forced-movement",
    "combat-friendly-fire"
  ],
  "sources": [
    {
      "title": "Shared action points — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-action-points/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「每回合预算有限，走近一点就可能少打一次。」
出處：`sources/text/combat-action-points.json` 字元 171-191 `summary.zh`
顯示：每回合預算有限，走近一點就可能少打一次。

## 規則

「回合开始给角色固定行动点，移动、攻击和辅助动作消耗这份预算。玩家选择动作顺序，并在资源耗尽前完成目的；下一回合恢复预算。各动作是否结束回合必须明确，不能只靠点数暗示。」
出處：`sources/text/combat-action-points.json` 字元 294-377 `rules.zh`
顯示：回合開始給角色固定行動點，移動、攻擊和輔助動作消耗這份預算。玩家選擇動作順序，並在資源耗盡前完成目的；下一回合恢復預算。各動作是否結束回合必須明確，不能只靠點數暗示。

## 核心循環

「查看本回合预算」
出處：`sources/text/combat-action-points.json` 字元 681-688 `loop[0].zh`
顯示：查看本回合預算

「估算位置和动作成本」
出處：`sources/text/combat-action-points.json` 字元 752-761 `loop[1].zh`
顯示：估算位置和動作成本

「按顺序执行」
出處：`sources/text/combat-action-points.json` 字元 839-844 `loop[2].zh`
顯示：按順序執行

「结束回合恢复预算」
出處：`sources/text/combat-action-points.json` 字元 908-916 `loop[3].zh`
顯示：結束回合恢復預算

## 玩家取捨

「多走一步换更好的射角，还是原地多攻击一次？」
出處：`sources/text/combat-action-points.json` 字元 1005-1026 `decisions[0].zh`
顯示：多走一步換更好的射角，還是原地多攻擊一次？

「先装填保证下一轮，还是把最后一点留给当前攻击？」
出處：`sources/text/combat-action-points.json` 字元 1130-1153 `decisions[1].zh`
顯示：先裝填保證下一輪，還是把最後一點留給當前攻擊？

## 可調參數

「每回合点数」
出處：`sources/text/combat-action-points.json` 字元 1301-1306 `parameters[0].name.zh`
顯示：每回合點數

「点数少时取舍明显；点数多时组合丰富，但每回合思考更长。」
出處：`sources/text/combat-action-points.json` 字元 1383-1410 `parameters[0].effect.zh`
顯示：點數少時取捨明顯；點數多時組合豐富，但每回合思考更長。

「动作结束规则」
出處：`sources/text/combat-action-points.json` 字元 1566-1572 `parameters[1].name.zh`
顯示：動作結束規則

「统一消费更易理解，特殊结束回合的动作需要醒目标识。」
出處：`sources/text/combat-action-points.json` 字元 1653-1678 `parameters[1].effect.zh`
顯示：統一消費更易理解，特殊結束回合的動作需要醒目標識。

## 原型

「先做一名角色、三个动作和三个行动点；用数字显示执行后的余额。」
出處：`sources/text/combat-action-points.json` 字元 3029-3059 `prototype.firstStep.zh`
顯示：先做一名角色、三個動作和三個行動點；用數字顯示執行後的餘額。

「观察玩家能否在点击前准确说出还能做几个动作。」
出處：`sources/text/combat-action-points.json` 字元 3331-3353 `prototype.test.zh`
顯示：觀察玩家能否在點擊前準確說出還能做幾個動作。

「不同动作暗藏结束回合效果，容易让玩家误操作。」
出處：`sources/text/combat-action-points.json` 字元 3197-3219 `prototype.pitfall.zh`
顯示：不同動作暗藏結束回合效果，容易讓玩家誤操作。

## 相關模式

- [掩體側擊](combat-cover-flanking.md)
- [可破壞掩體](combat-destructible-cover.md)
- [強制移動](combat-forced-movement.md)
- [範圍攻擊的友方誤傷](combat-friendly-fire.md)

## 參考來源

- [Shared action points — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-action-points/) — 查閱：2026-11-02；取得方式：page-text。
