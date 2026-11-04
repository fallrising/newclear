---
{
  "schema_version": 2,
  "id": "combat-timed-parry",
  "title": "限時招架",
  "title_en": "Timed parries",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "timing",
    "precision",
    "risk"
  ],
  "summary": "把防御从持续按住，变成一次有风险的时机判断。",
  "note_status": "draft",
  "related": [
    "combat-posture-break",
    "combat-stamina-budget",
    "combat-weakpoint-aim",
    "combat-combo-variation"
  ],
  "sources": [
    {
      "title": "Timed parries — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-timed-parry/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把防御从持续按住，变成一次有风险的时机判断。」
出處：`sources/text/combat-timed-parry.json` 字元 157-179 `summary.zh`
顯示：把防禦從持續按住，變成一次有風險的時機判斷。

## 規則

「观察攻击前摇，在命中前的短窗口输入招架。成功改变双方优势或返还进攻机会；过早可能只是普通格挡，过晚则受伤，具体结果由游戏规则决定。」
出處：`sources/text/combat-timed-parry.json` 字元 290-355 `rules.zh`
顯示：觀察攻擊前搖，在命中前的短窗口輸入招架。成功改變雙方優勢或返還進攻機會；過早可能只是普通格擋，過晚則受傷，具體結果由遊戲規則決定。

## 核心循環

「识别来招」
出處：`sources/text/combat-timed-parry.json` 字元 594-598 `loop[0].zh`
顯示：識別來招

「等待命中窗口」
出處：`sources/text/combat-timed-parry.json` 字元 661-667 `loop[1].zh`

「输入招架」
出處：`sources/text/combat-timed-parry.json` 字元 737-741 `loop[2].zh`
顯示：輸入招架

「利用反击机会」
出處：`sources/text/combat-timed-parry.json` 字元 804-810 `loop[3].zh`
顯示：利用反擊機會

## 玩家取捨

「招架可换取优势，但躲开往往更稳；对陌生招式要不要冒险？」
出處：`sources/text/combat-timed-parry.json` 字元 894-921 `decisions[0].zh`
顯示：招架可換取優勢，但躲開往往更穩；對陌生招式要不要冒險？

「连续攻击要求分辨节奏，不能用一次成功代替整串判断。」
出處：`sources/text/combat-timed-parry.json` 字元 1055-1080 `decisions[1].zh`
顯示：連續攻擊要求分辨節奏，不能用一次成功代替整串判斷。

## 可調參數

「判定宽度」
出處：`sources/text/combat-timed-parry.json` 字元 1246-1250 `parameters[0].name.zh`
顯示：判定寬度

「窗口越窄，熟练度差异越大，也更依赖清楚的音画提示。」
出處：`sources/text/combat-timed-parry.json` 字元 1325-1350 `parameters[0].effect.zh`
顯示：窗口越窄，熟練度差異越大，也更依賴清楚的音畫提示。

「失败保底」
出處：`sources/text/combat-timed-parry.json` 字元 1503-1507 `parameters[1].name.zh`
顯示：失敗保底

「过早输入仍能格挡，可鼓励新手尝试；完全失防则提高赌博感。」
出處：`sources/text/combat-timed-parry.json` 字元 1585-1613 `parameters[1].effect.zh`
顯示：過早輸入仍能格擋，可鼓勵新手嘗試；完全失防則提高賭博感。

## 原型

「先做一名敌人的两种可辨认招式、招架判定和明确的成功反馈。」
出處：`sources/text/combat-timed-parry.json` 字元 3119-3147 `prototype.firstStep.zh`
顯示：先做一名敵人的兩種可辨認招式、招架判定和明確的成功反饋。

「失败后让玩家说明按早还是按晚，检查他们能否凭反馈修正下一次操作。」
出處：`sources/text/combat-timed-parry.json` 字元 3449-3481 `prototype.test.zh`
顯示：失敗後讓玩家說明按早還是按晚，檢查他們能否憑反饋修正下一次操作。

「动画、命中时刻和输入判定必须对齐；先别用随机延迟增加难度。」
出處：`sources/text/combat-timed-parry.json` 字元 3290-3319 `prototype.pitfall.zh`
顯示：動畫、命中時刻和輸入判定必須對齊；先別用隨機延遲增加難度。

## 相關模式

- [架勢崩解](combat-posture-break.md)
- [攻守共用資源預算](combat-stamina-budget.md)
- [弱點瞄準](combat-weakpoint-aim.md)
- [連段變化](combat-combo-variation.md)

## 參考來源

- [Timed parries — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-timed-parry/) — 查閱：2026-11-02；取得方式：page-text。
