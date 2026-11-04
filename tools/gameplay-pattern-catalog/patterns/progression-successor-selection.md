---
{
  "schema_version": 2,
  "id": "progression-successor-selection",
  "title": "繼承者選拔",
  "title_en": "Choose the next heir",
  "category": "progression",
  "source_category": "progression",
  "tags": [
    "randomness",
    "progression",
    "planning"
  ],
  "summary": "每次重新出发先换个人，适应新角色的长处与毛病。",
  "note_status": "draft",
  "related": [
    "progression-random-level-choices",
    "progression-challenge-tiers",
    "progression-death-loses-training",
    "progression-evolution-recipes"
  ],
  "sources": [
    {
      "title": "Choose the next heir — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/progression-successor-selection/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「每次重新出发先换个人，适应新角色的长处与毛病。」
出處：`sources/text/progression-successor-selection.json` 字元 189-212 `summary.zh`
顯示：每次重新出發先換個人，適應新角色的長處與毛病。

## 規則

「当前角色结束冒险后，系统提供几位带不同职业和特征的后继人选。玩家选择一个开始下一次，既利用已有长期积累，也要适应新限制；重点是从候选人中挑选，不是安排配对繁殖。」
出處：`sources/text/progression-successor-selection.json` 字元 325-405 `rules.zh`
顯示：當前角色結束冒險後，系統提供幾位帶不同職業和特徵的後繼人選。玩家選擇一個開始下一次，既利用已有長期積累，也要適應新限制；重點是從候選人中挑選，不是安排配對繁殖。

## 核心循環

「结束当前角色的冒险」
出處：`sources/text/progression-successor-selection.json` 字元 700-709 `loop[0].zh`
顯示：結束當前角色的冒險

「查看继承者特征」
出處：`sources/text/progression-successor-selection.json` 字元 776-783 `loop[1].zh`
顯示：查看繼承者特徵

「选一个适合当前目标的人」
出處：`sources/text/progression-successor-selection.json` 字元 851-862 `loop[2].zh`
顯示：選一個適合當前目標的人

「调整打法再出发」
出處：`sources/text/progression-successor-selection.json` 字元 930-937 `loop[3].zh`
顯示：調整打法再出發

## 玩家取捨

「选自己熟悉的职业，还是接受陌生特征尝试新办法？」
出處：`sources/text/progression-successor-selection.json` 字元 1019-1042 `decisions[0].zh`
顯示：選自己熟悉的職業，還是接受陌生特徵嘗試新辦法？

「选更适合当前难关的人，还是选择能探索另一条路线的人？」
出處：`sources/text/progression-successor-selection.json` 字元 1142-1168 `decisions[1].zh`
顯示：選更適合當前難關的人，還是選擇能探索另一條路線的人？

## 可調參數

「候选人数」
出處：`sources/text/progression-successor-selection.json` 字元 1319-1323 `parameters[0].name.zh`
顯示：候選人數

「人选多更容易避开不喜欢的特征，但也会降低被迫适应的频率。」
出處：`sources/text/progression-successor-selection.json` 字元 1400-1428 `parameters[0].effect.zh`
顯示：人選多更容易避開不喜歡的特徵，但也會降低被迫適應的頻率。

「特征影响范围」
出處：`sources/text/progression-successor-selection.json` 字元 1575-1581 `parameters[1].name.zh`
顯示：特徵影響範圍

「只改数值容易同质化；改移动或感知更鲜明，也更需要可读的说明。」
出處：`sources/text/progression-successor-selection.json` 字元 1655-1685 `parameters[1].effect.zh`
顯示：只改數值容易同質化；改移動或感知更鮮明，也更需要可讀的說明。

## 原型

「做三个固定候选人，每人只有一个明显长处和一个限制，再接同一短关卡。」
出處：`sources/text/progression-successor-selection.json` 字元 3277-3310 `prototype.firstStep.zh`
顯示：做三個固定候選人，每人只有一個明顯長處和一個限制，再接同一短關卡。

「换人后玩家是否真的改变一次行动节奏，而不只是读了不同姓名？」
出處：`sources/text/progression-successor-selection.json` 字元 3645-3674 `prototype.test.zh`
顯示：換人後玩家是否真的改變一次行動節奏，而不只是讀了不同姓名？

「先别随机组合几十种特征；先排除会让关卡完全不可通行的搭配。」
出處：`sources/text/progression-successor-selection.json` 字元 3471-3500 `prototype.pitfall.zh`
顯示：先別隨機組合幾十種特徵；先排除會讓關卡完全不可通行的搭配。

## 相關模式

- [隨機等級選項](progression-random-level-choices.md)
- [挑戰層級](progression-challenge-tiers.md)
- [死亡失去訓練](progression-death-loses-training.md)
- [進化配方鏈](progression-evolution-recipes.md)

## 參考來源

- [Choose the next heir — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/progression-successor-selection/) — 查閱：2026-11-02；取得方式：page-text。
