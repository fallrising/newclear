---
{
  "schema_version": 2,
  "id": "progression-evolution-recipes",
  "title": "進化配方鏈",
  "title_en": "Complete a weapon evolution recipe",
  "category": "progression",
  "source_category": "progression",
  "tags": [
    "planning",
    "progression",
    "discovery"
  ],
  "summary": "一路保留配套零件，等条件满足后把武器变成新形态。",
  "note_status": "draft",
  "related": [
    "progression-challenge-tiers",
    "progression-death-loses-training",
    "progression-knowledge-gates",
    "progression-practice-based-growth"
  ],
  "sources": [
    {
      "title": "Complete a weapon evolution recipe — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/progression-evolution-recipes/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「一路保留配套零件，等条件满足后把武器变成新形态。」
出處：`sources/text/progression-evolution-recipes.json` 字元 200-224 `summary.zh`
顯示：一路保留配套零件，等條件滿足後把武器變成新形態。

## 規則

「某件武器达到要求后，还要持有指定搭配并触发合成，才能变成新形态。玩家要为未来的组合预留位置，也要承受配套零件暂时不够有用的阶段；合成成功应明显改变攻击方式。」
出處：`sources/text/progression-evolution-recipes.json` 字元 323-401 `rules.zh`
顯示：某件武器達到要求後，還要持有指定搭配並觸發合成，才能變成新形態。玩家要爲未來的組合預留位置，也要承受配套零件暫時不夠有用的階段；合成成功應明顯改變攻擊方式。

## 核心循環

「确认目标配方」
出處：`sources/text/progression-evolution-recipes.json` 字元 696-702 `loop[0].zh`
顯示：確認目標配方

「收集并升级必要部件」
出處：`sources/text/progression-evolution-recipes.json` 字元 763-772 `loop[1].zh`
顯示：收集並升級必要部件

「满足条件后触发合成」
出處：`sources/text/progression-evolution-recipes.json` 字元 845-854 `loop[2].zh`
顯示：滿足條件後觸發合成

「用新形态调整战斗」
出處：`sources/text/progression-evolution-recipes.json` 字元 923-931 `loop[3].zh`
顯示：用新形態調整戰鬥

## 玩家取捨

「拿眼下更强的零件，还是留下能完成未来配方的位置？」
出處：`sources/text/progression-evolution-recipes.json` 字元 1017-1041 `decisions[0].zh`
顯示：拿眼下更強的零件，還是留下能完成未來配方的位置？

「继续等缺少的配件，还是放弃已投入的路线解决当前危险？」
出處：`sources/text/progression-evolution-recipes.json` 字元 1159-1185 `decisions[1].zh`
顯示：繼續等缺少的配件，還是放棄已投入的路線解決當前危險？

## 可調參數

「配方提示程度」
出處：`sources/text/progression-evolution-recipes.json` 字元 1337-1343 `parameters[0].name.zh`

「提前知道条件能规划；只给线索会增加发现感，也可能让失败像浪费。」
出處：`sources/text/progression-evolution-recipes.json` 字元 1422-1453 `parameters[0].effect.zh`
顯示：提前知道條件能規劃；只給線索會增加發現感，也可能讓失敗像浪費。

「部件独立价值」
出處：`sources/text/progression-evolution-recipes.json` 字元 1620-1626 `parameters[1].name.zh`
顯示：部件獨立價值

「配件越弱，完成组合前的风险越大，成型收益也要更清楚。」
出處：`sources/text/progression-evolution-recipes.json` 字元 1707-1733 `parameters[1].effect.zh`
顯示：配件越弱，完成組合前的風險越大，成型收益也要更清楚。

## 原型

「做四件部件、两条固定配方和一个合成台，每种成品有明显不同的攻击轨迹。」
出處：`sources/text/progression-evolution-recipes.json` 字元 3334-3368 `prototype.firstStep.zh`
顯示：做四件部件、兩條固定配方和一個合成臺，每種成品有明顯不同的攻擊軌跡。

「玩家是否会为尚未完成的配方保留位置，并在合成后改变站位？」
出處：`sources/text/progression-evolution-recipes.json` 字元 3681-3709 `prototype.test.zh`
顯示：玩家是否會爲尚未完成的配方保留位置，並在合成後改變站位？

「先别做复杂配方百科；如果成品只是数值更高，等待过程很难形成期待。」
出處：`sources/text/progression-evolution-recipes.json` 字元 3521-3553 `prototype.pitfall.zh`
顯示：先別做複雜配方百科；如果成品只是數值更高，等待過程很難形成期待。

## 相關模式

- [挑戰層級](progression-challenge-tiers.md)
- [死亡失去訓練](progression-death-loses-training.md)
- [知識門檻](progression-knowledge-gates.md)
- [練習成長](progression-practice-based-growth.md)

## 參考來源

- [Complete a weapon evolution recipe — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/progression-evolution-recipes/) — 查閱：2026-11-02；取得方式：page-text。
