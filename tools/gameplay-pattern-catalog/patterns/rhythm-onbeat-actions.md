---
{
  "schema_version": 2,
  "id": "rhythm-onbeat-actions",
  "title": "拍點上動作",
  "title_en": "Move or attack on the beat",
  "category": "rhythm",
  "source_category": "rhythm",
  "tags": [
    "timing",
    "planning",
    "dexterity"
  ],
  "summary": "同一招什么时候出手，也会决定它能否奏效。",
  "note_status": "draft",
  "related": [
    "rhythm-sustain-notes",
    "combat-combo-variation",
    "combat-invulnerable-dodge",
    "combat-stamina-budget"
  ],
  "sources": [
    {
      "title": "Move or attack on the beat — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/rhythm-onbeat-actions/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「同一招什么时候出手，也会决定它能否奏效。」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 178-198 `summary.zh`
顯示：同一招什麼時候出手，也會決定它能否奏效。

## 規則

「系统持续给出拍点，玩家要把移动、攻击等操作放在允许的时间窗口内。做对动作但时机偏离，可能无法执行或失去效果加成；下一拍到来前还要重新判断站位和目标。本条关注每次行动的时机，连续多次成功如何累积倍率属于另一条规则。」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 298-404 `rules.zh`
顯示：系統持續給出拍點，玩家要把移動、攻擊等操作放在允許的時間窗口內。做對動作但時機偏離，可能無法執行或失去效果加成；下一拍到來前還要重新判斷站位和目標。本條關注每次行動的時機，連續多次成功如何累積倍率屬於另一條規則。

## 核心循環

「听出稳定拍点」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 759-765 `loop[0].zh`
顯示：聽出穩定拍點

「决定下一拍做什么」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 829-837 `loop[1].zh`
顯示：決定下一拍做什麼

「在窗口内按下操作」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 910-918 `loop[2].zh`
顯示：在窗口內按下操作

「根据新位置与敌情接下一拍」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 990-1002 `loop[3].zh`
顯示：根據新位置與敵情接下一拍

## 玩家取捨

「下一拍用来靠近目标，还是先退开避开攻击？」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 1125-1145 `decisions[0].zh`
顯示：下一拍用來靠近目標，還是先退開避開攻擊？

「现在抢着出手，还是等到合拍窗口再打得更有效？」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 1245-1267 `decisions[1].zh`
顯示：現在搶着出手，還是等到合拍窗口再打得更有效？

## 可調參數

「拍速」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 1427-1429 `parameters[0].name.zh`

「拍速越快，留给观察和选动作的时间越少。」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 1501-1520 `parameters[0].effect.zh`
顯示：拍速越快，留給觀察和選動作的時間越少。

「允许误差」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 1656-1660 `parameters[1].name.zh`
顯示：允許誤差

「窗口变宽能降低操作门槛；过窄则容易让设备延迟掩盖策略判断。」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 1738-1767 `parameters[1].effect.zh`
顯示：窗口變寬能降低操作門檻；過窄則容易讓設備延遲掩蓋策略判斷。

「离拍后果」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 1949-1953 `parameters[2].name.zh`
顯示：離拍後果

「不执行动作与只取消加成会产生不同压力，反馈应立即说明是哪一种。」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 2034-2065 `parameters[2].effect.zh`
顯示：不執行動作與只取消加成會產生不同壓力，反饋應立即說明是哪一種。

## 原型

「做五格小地图、一名按两拍循环的敌人、移动和攻击两个动作；用节拍声与闪光共同提示。」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 3655-3695 `prototype.firstStep.zh`
顯示：做五格小地圖、一名按兩拍循環的敵人、移動和攻擊兩個動作；用節拍聲與閃光共同提示。

「玩家失败后能否说清是选错方向，还是按早或按晚？」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 4047-4070 `prototype.test.zh`
顯示：玩家失敗後能否說清是選錯方向，還是按早或按晚？

「输入、音频与画面时钟不一致，会让正确按拍也被判错；先提供校准与清楚的早晚反馈。」
出處：`sources/text/rhythm-onbeat-actions.json` 字元 3855-3894 `prototype.pitfall.zh`
顯示：輸入、音頻與畫面時鐘不一致，會讓正確按拍也被判錯；先提供校準與清楚的早晚反饋。

## 相關模式

- [按住長音的時值判斷](rhythm-sustain-notes.md)
- [連段變化](combat-combo-variation.md)
- [無敵閃避](combat-invulnerable-dodge.md)
- [攻守共用資源預算](combat-stamina-budget.md)

## 參考來源

- [Move or attack on the beat — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/rhythm-onbeat-actions/) — 查閱：2026-11-02；取得方式：page-text。
