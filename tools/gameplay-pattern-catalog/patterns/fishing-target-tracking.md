---
{
  "schema_version": 2,
  "id": "fishing-target-tracking",
  "title": "目標追蹤",
  "title_en": "Tracking a moving fish",
  "category": "fishing",
  "source_category": "fishing",
  "tags": [
    "dexterity",
    "precision",
    "timing"
  ],
  "summary": "持续把控制区覆盖在鱼标上，累积捕获进度。",
  "note_status": "draft",
  "related": [
    "fishing-bite-window",
    "fishing-line-tension",
    "combat-combo-variation",
    "combat-invulnerable-dodge"
  ],
  "sources": [
    {
      "title": "Tracking a moving fish — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/fishing-target-tracking/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「持续把控制区覆盖在鱼标上，累积捕获进度。」
出處：`sources/text/fishing-target-tracking.json` 字元 172-192 `summary.zh`
顯示：持續把控制區覆蓋在魚標上，累積捕獲進度。

## 規則

「玩家通过按住与松开按钮移动控制条，使鱼标尽量留在条内。重力或惯性阻止瞬间精确定位，鱼又会改变位置；覆盖时进度增长，离开时倒退，考验持续纠偏。」
出處：`sources/text/fishing-target-tracking.json` 字元 303-373 `rules.zh`
顯示：玩家通過按住與鬆開按鈕移動控制條，使魚標儘量留在條內。重力或慣性阻止瞬間精確定位，魚又會改變位置；覆蓋時進度增長，離開時倒退，考驗持續糾偏。

## 核心循環

「读取鱼标移动方向」
出處：`sources/text/fishing-target-tracking.json` 字元 631-639 `loop[0].zh`
顯示：讀取魚標移動方向

「短按或持续按压调整控制条」
出處：`sources/text/fishing-target-tracking.json` 字元 707-719 `loop[1].zh`
顯示：短按或持續按壓調整控制條

「保持覆盖累积进度」
出處：`sources/text/fishing-target-tracking.json` 字元 794-802 `loop[2].zh`
顯示：保持覆蓋累積進度

「补救偏离并完成捕获」
出處：`sources/text/fishing-target-tracking.json` 字元 879-888 `loop[3].zh`
顯示：補救偏離並完成捕獲

## 玩家取捨

「追着鱼的当前位置跑容易过冲，预判转向更有效。」
出處：`sources/text/fishing-target-tracking.json` 字元 995-1017 `decisions[0].zh`
顯示：追着魚的當前位置跑容易過沖，預判轉向更有效。

「稳定在鱼的常用区域，还是积极追每次跳动，取决于进度损失速度。」
出處：`sources/text/fishing-target-tracking.json` 字元 1154-1184 `decisions[1].zh`
顯示：穩定在魚的常用區域，還是積極追每次跳動，取決於進度損失速度。

## 可調參數

「控制条宽度」
出處：`sources/text/fishing-target-tracking.json` 字元 1355-1360 `parameters[0].name.zh`
顯示：控制條寬度

「更宽提高容错，更窄强化精准控制。」
出處：`sources/text/fishing-target-tracking.json` 字元 1439-1455 `parameters[0].effect.zh`
顯示：更寬提高容錯，更窄強化精準控制。

「控制惯性」
出處：`sources/text/fishing-target-tracking.json` 字元 1598-1602 `parameters[1].name.zh`
顯示：控制慣性

「惯性越大越需要预判，越小越像直接跟随光标。」
出處：`sources/text/fishing-target-tracking.json` 字元 1679-1700 `parameters[1].effect.zh`
顯示：慣性越大越需要預判，越小越像直接跟隨光標。

## 原型

「做一条纵向轨道、受重力影响的控制条和一种往返鱼标运动，不需要水面场景。」
出處：`sources/text/fishing-target-tracking.json` 字元 3158-3193 `prototype.firstStep.zh`
顯示：做一條縱向軌道、受重力影響的控制條和一種往返魚標運動，不需要水面場景。

「同一条鱼重复试玩时，玩家是否减少过冲，并学会用短按维持位置？」
出處：`sources/text/fishing-target-tracking.json` 字元 3550-3580 `prototype.test.zh`
顯示：同一條魚重複試玩時，玩家是否減少過沖，並學會用短按維持位置？

「大量突然反向或高速跳动会掩盖控制学习；先让一种运动模式稳定可读。」
出處：`sources/text/fishing-target-tracking.json` 字元 3363-3395 `prototype.pitfall.zh`
顯示：大量突然反向或高速跳動會掩蓋控制學習；先讓一種運動模式穩定可讀。

## 相關模式

- [訊號辨識與反應窗口](fishing-bite-window.md)
- [收線張力的持續控制](fishing-line-tension.md)
- [連段變化](combat-combo-variation.md)
- [無敵閃避](combat-invulnerable-dodge.md)

## 參考來源

- [Tracking a moving fish — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/fishing-target-tracking/) — 查閱：2026-11-02；取得方式：page-text。
