---
{
  "schema_version": 2,
  "id": "matching-swap-to-align",
  "title": "交換對齊",
  "title_en": "Swap neighbors to complete a match",
  "category": "matching",
  "source_category": "matching",
  "tags": [
    "planning",
    "spatial",
    "optimization"
  ],
  "summary": "只换两个位置，却要同时考虑眼前消除和换完后的棋盘。",
  "note_status": "draft",
  "related": [
    "matching-complete-lines",
    "matching-merge-three-upgrade",
    "matching-pattern-creates-power",
    "matching-tap-connected-group"
  ],
  "sources": [
    {
      "title": "Swap neighbors to complete a match — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/matching-swap-to-align/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「只换两个位置，却要同时考虑眼前消除和换完后的棋盘。」
出處：`sources/text/matching-swap-to-align.json` 字元 190-215 `summary.zh`
顯示：只換兩個位置，卻要同時考慮眼前消除和換完後的棋盤。

## 規則

「玩家交换两个相邻物件，让同类物件在横向或纵向连成足够长的一排。匹配的物件消失，上方物件补位；不成组的交换通常退回。玩家在新的排列里继续寻找能推进目标的一步。」
出處：`sources/text/matching-swap-to-align.json` 字元 348-426 `rules.zh`
顯示：玩家交換兩個相鄰物件，讓同類物件在橫向或縱向連成足夠長的一排。匹配的物件消失，上方物件補位；不成組的交換通常退回。玩家在新的排列裏繼續尋找能推進目標的一步。

## 核心循環

「寻找差一个位置的组合」
出處：`sources/text/matching-swap-to-align.json` 字元 713-723 `loop[0].zh`
顯示：尋找差一個位置的組合

「交换相邻两格」
出處：`sources/text/matching-swap-to-align.json` 字元 800-806 `loop[1].zh`
顯示：交換相鄰兩格

「消除并补入物件」
出處：`sources/text/matching-swap-to-align.json` 字元 876-883 `loop[2].zh`
顯示：消除並補入物件

「重新判断下一步」
出處：`sources/text/matching-swap-to-align.json` 字元 943-950 `loop[3].zh`
顯示：重新判斷下一步

## 玩家取捨

「先消除最容易的一组，还是保留它给更大的组合腾位置？」
出處：`sources/text/matching-swap-to-align.json` 字元 1037-1062 `decisions[0].zh`
顯示：先消除最容易的一組，還是保留它給更大的組合騰位置？

「多消几块能得分，但是否真的清到了关卡要求的位置？」
出處：`sources/text/matching-swap-to-align.json` 字元 1178-1202 `decisions[1].zh`
顯示：多消幾塊能得分，但是否真的清到了關卡要求的位置？

## 可調參數

「同类数量门槛」
出處：`sources/text/matching-swap-to-align.json` 字元 1361-1367 `parameters[0].name.zh`
顯示：同類數量門檻

「门槛越高，准备步骤越多，也越需要保证棋盘存在可行解。」
出處：`sources/text/matching-swap-to-align.json` 字元 1444-1470 `parameters[0].effect.zh`
顯示：門檻越高，準備步驟越多，也越需要保證棋盤存在可行解。

「颜色种类」
出處：`sources/text/matching-swap-to-align.json` 字元 1633-1637 `parameters[1].name.zh`
顯示：顏色種類

「颜色少更容易连续消除；颜色多会增加寻找机会的时间。」
出處：`sources/text/matching-swap-to-align.json` 字元 1715-1740 `parameters[1].effect.zh`
顯示：顏色少更容易連續消除；顏色多會增加尋找機會的時間。

## 原型

「做一个六乘六棋盘、四种颜色，只保留交换、匹配、补位和一个收集目标。」
出處：`sources/text/matching-swap-to-align.json` 字元 3280-3313 `prototype.firstStep.zh`
顯示：做一個六乘六棋盤、四種顏色，只保留交換、匹配、補位和一個收集目標。

「玩家能否解释为什么某个交换比另一个更接近目标？」
出處：`sources/text/matching-swap-to-align.json` 字元 3626-3649 `prototype.test.zh`
顯示：玩家能否解釋爲什麼某個交換比另一個更接近目標？

「随机补位可能产生无可行交换的局面，先明确重排或失败规则。」
出處：`sources/text/matching-swap-to-align.json` 字元 3462-3490 `prototype.pitfall.zh`
顯示：隨機補位可能產生無可行交換的局面，先明確重排或失敗規則。

## 相關模式

- [完成整行](matching-complete-lines.md)
- [合成三消升級](matching-merge-three-upgrade.md)
- [圖形生成電力](matching-pattern-creates-power.md)
- [點選相連群組](matching-tap-connected-group.md)

## 參考來源

- [Swap neighbors to complete a match — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/matching-swap-to-align/) — 查閱：2026-11-02；取得方式：page-text。
