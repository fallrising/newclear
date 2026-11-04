---
{
  "schema_version": 2,
  "id": "ecology-plant-crossbreeding",
  "title": "植物雜交",
  "title_en": "Arrange neighbors to breed plants",
  "category": "ecology",
  "source_category": "ecology",
  "tags": [
    "planning",
    "discovery",
    "spatial"
  ],
  "summary": "想得到新植物，先决定哪些植物一起生长、哪些必须隔开。",
  "note_status": "draft",
  "related": [
    "ecology-breeding-conditions",
    "ecology-habitat-capacity",
    "ecology-species-compatibility",
    "farming-substrate-match"
  ],
  "sources": [
    {
      "title": "Arrange neighbors to breed plants — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/ecology-plant-crossbreeding/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「想得到新植物，先决定哪些植物一起生长、哪些必须隔开。」
出處：`sources/text/ecology-plant-crossbreeding.json` 字元 192-218 `summary.zh`
顯示：想得到新植物，先決定哪些植物一起生長、哪些必須隔開。

## 規則

「种植布局会影响交配或授粉的结果。玩家选定亲本或相邻品种，等待一次生长或授粉，再检查结果并保留有用样本；产量地块与实验地块因此可能需要分开。」
出處：`sources/text/ecology-plant-crossbreeding.json` 字元 345-414 `rules.zh`
顯示：種植佈局會影響交配或授粉的結果。玩家選定親本或相鄰品種，等待一次生長或授粉，再檢查結果並保留有用樣本；產量地塊與實驗地塊因此可能需要分開。

## 核心循環

「选择想获得的品种或性状」
出處：`sources/text/ecology-plant-crossbreeding.json` 字元 685-696 `loop[0].zh`
顯示：選擇想獲得的品種或性狀

「安排能相互影响的植株」
出處：`sources/text/ecology-plant-crossbreeding.json` 字元 772-782 `loop[1].zh`
顯示：安排能相互影響的植株

「等待生长或授粉结果」
出處：`sources/text/ecology-plant-crossbreeding.json` 字元 867-876 `loop[2].zh`
顯示：等待生長或授粉結果

「保留结果并调整下一组」
出處：`sources/text/ecology-plant-crossbreeding.json` 字元 950-960 `loop[3].zh`
顯示：保留結果並調整下一組

## 玩家取捨

「用有限地块稳定收成，还是留一块试验未知组合？」
出處：`sources/text/ecology-plant-crossbreeding.json` 字元 1066-1088 `decisions[0].zh`
顯示：用有限地塊穩定收成，還是留一塊試驗未知組合？

「保留已经不错的植株，还是继续杂交争取更合适的性状？」
出處：`sources/text/ecology-plant-crossbreeding.json` 字元 1205-1230 `decisions[1].zh`
顯示：保留已經不錯的植株，還是繼續雜交爭取更合適的性狀？

## 可調參數

「相互影响范围」
出處：`sources/text/ecology-plant-crossbreeding.json` 字元 1375-1381 `parameters[0].name.zh`
顯示：相互影響範圍

「按邻格、半径或蜂箱活动范围判断，会产生不同的隔离布局。」
出處：`sources/text/ecology-plant-crossbreeding.json` 字元 1460-1487 `parameters[0].effect.zh`
顯示：按鄰格、半徑或蜂箱活動範圍判斷，會產生不同的隔離佈局。

「结果可预测程度」
出處：`sources/text/ecology-plant-crossbreeding.json` 字元 1628-1635 `parameters[1].name.zh`
顯示：結果可預測程度

「能看到亲本和候选结果时，玩法偏规划；隐藏结果则需提供可保存的实验记录。」
出處：`sources/text/ecology-plant-crossbreeding.json` 字元 1718-1753 `parameters[1].effect.zh`
顯示：能看到親本和候選結果時，玩法偏規劃；隱藏結果則需提供可保存的實驗記錄。

## 原型

「用四种花、三格苗圃和一张固定组合表，不先做真实遗传模拟。」
出處：`sources/text/ecology-plant-crossbreeding.json` 字元 3335-3363 `prototype.firstStep.zh`
顯示：用四種花、三格苗圃和一張固定組合表，不先做真實遺傳模擬。

「给一块生产地和一块实验地，观察玩家能否保留亲本并重复成功组合。」
出處：`sources/text/ecology-plant-crossbreeding.json` 字元 3700-3731 `prototype.test.zh`
顯示：給一塊生產地和一塊實驗地，觀察玩家能否保留親本並重覆成功組合。

「如果所有相邻植物都随机混合且无法隔离，玩家会失去实验控制感。」
出處：`sources/text/ecology-plant-crossbreeding.json` 字元 3521-3551 `prototype.pitfall.zh`
顯示：如果所有相鄰植物都隨機混合且無法隔離，玩家會失去實驗控制感。

## 相關模式

- [繁育條件組](ecology-breeding-conditions.md)
- [棲地容量](ecology-habitat-capacity.md)
- [物種共容](ecology-species-compatibility.md)
- [基質對應](farming-substrate-match.md)

## 參考來源

- [Arrange neighbors to breed plants — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/ecology-plant-crossbreeding/) — 查閱：2026-11-02；取得方式：page-text。
