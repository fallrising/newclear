---
{
  "schema_version": 2,
  "id": "progression-challenge-tiers",
  "title": "挑戰層級",
  "title_en": "Escalating challenge conditions",
  "category": "progression",
  "source_category": "progression",
  "tags": [
    "progression",
    "risk",
    "planning"
  ],
  "summary": "熟悉规则后，给同一套挑战再加一道限制。",
  "note_status": "draft",
  "related": [
    "progression-death-loses-training",
    "progression-evolution-recipes",
    "progression-permanent-run-currency",
    "progression-practice-based-growth"
  ],
  "sources": [
    {
      "title": "Escalating challenge conditions — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/progression-challenge-tiers/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「熟悉规则后，给同一套挑战再加一道限制。」
出處：`sources/text/progression-challenge-tiers.json` 字元 194-213 `summary.zh`
顯示：熟悉規則後，給同一套挑戰再加一道限制。

## 規則

「玩家完成基础挑战后，解锁更难的层级或自行挑选限制条件，例如更少治疗或更强敌人。新一轮沿用熟悉内容，却要求调整策略；界面应明确本轮额外改变了什么。」
出處：`sources/text/progression-challenge-tiers.json` 字元 316-388 `rules.zh`
顯示：玩家完成基礎挑戰後，解鎖更難的層級或自行挑選限制條件，例如更少治療或更強敵人。新一輪沿用熟悉內容，卻要求調整策略；界面應明確本輪額外改變了什麼。

## 核心循環

「完成当前挑战」
出處：`sources/text/progression-challenge-tiers.json` 字元 664-670 `loop[0].zh`
顯示：完成當前挑戰

「查看新增限制」
出處：`sources/text/progression-challenge-tiers.json` 字元 744-750 `loop[1].zh`

「调整方案再次挑战」
出處：`sources/text/progression-challenge-tiers.json` 字元 820-828 `loop[2].zh`
顯示：調整方案再次挑戰

「记录完成条件并继续加难」
出處：`sources/text/progression-challenge-tiers.json` 字元 887-898 `loop[3].zh`
顯示：記錄完成條件並繼續加難

## 玩家取捨

「提升难度争取新目标，还是停留在熟悉层级练习薄弱环节？」
出處：`sources/text/progression-challenge-tiers.json` 字元 990-1016 `decisions[0].zh`
顯示：提升難度爭取新目標，還是停留在熟悉層級練習薄弱環節？

「如果能自选限制，削减补给和加强敌人，哪一种更能由当前能力承担？」
出處：`sources/text/progression-challenge-tiers.json` 字元 1135-1166 `decisions[1].zh`
顯示：如果能自選限制，削減補給和加強敵人，哪一種更能由當前能力承擔？

## 可調參數

「限制是否累积」
出處：`sources/text/progression-challenge-tiers.json` 字元 1355-1361 `parameters[0].name.zh`
顯示：限制是否累積

「累积限制更考验整体熟练度；独立限制更便于练习单一问题。」
出處：`sources/text/progression-challenge-tiers.json` 字元 1446-1473 `parameters[0].effect.zh`
顯示：累積限制更考驗整體熟練度；獨立限制更便於練習單一問題。

「新增条件的可见性」
出處：`sources/text/progression-challenge-tiers.json` 字元 1621-1629 `parameters[1].name.zh`
顯示：新增條件的可見性

「开局列清改变，能让失败归因于具体限制，而不是感觉游戏突然不公平。」
出處：`sources/text/progression-challenge-tiers.json` 字元 1710-1742 `parameters[1].effect.zh`
顯示：開局列清改變，能讓失敗歸因於具體限制，而不是感覺遊戲突然不公平。

## 原型

「做一个已经能通关的短挑战，再加两项可分别开关的明确限制。」
出處：`sources/text/progression-challenge-tiers.json` 字元 3249-3277 `prototype.firstStep.zh`
顯示：做一個已經能通關的短挑戰，再加兩項可分別開關的明確限制。

「开启限制后，玩家是否改变了一项准备或行动，而非只是多打几次？」
出處：`sources/text/progression-challenge-tiers.json` 字元 3608-3638 `prototype.test.zh`
顯示：開啓限制後，玩家是否改變了一項準備或行動，而非只是多打幾次？

「别只无限加血量；优先让限制改变选择，而不是延长重复操作。」
出處：`sources/text/progression-challenge-tiers.json` 字元 3431-3459 `prototype.pitfall.zh`
顯示：別隻無限加血量；優先讓限制改變選擇，而不是延長重複操作。

## 相關模式

- [死亡失去訓練](progression-death-loses-training.md)
- [進化配方鏈](progression-evolution-recipes.md)
- [跨局保留的永久貨幣](progression-permanent-run-currency.md)
- [練習成長](progression-practice-based-growth.md)

## 參考來源

- [Escalating challenge conditions — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/progression-challenge-tiers/) — 查閱：2026-11-02；取得方式：page-text。
