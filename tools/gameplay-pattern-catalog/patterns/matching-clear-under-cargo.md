---
{
  "schema_version": 2,
  "id": "matching-clear-under-cargo",
  "title": "清除下方貨物",
  "title_en": "Clear support beneath cargo to reach an exit",
  "category": "matching",
  "source_category": "matching",
  "tags": [
    "planning",
    "spatial",
    "time"
  ],
  "summary": "目标不能直接消除，要改变它下面的地形让它继续往下走。",
  "note_status": "draft",
  "related": [
    "matching-complete-lines",
    "matching-gravity-cascade",
    "matching-merge-three-upgrade",
    "matching-pattern-creates-power"
  ],
  "sources": [
    {
      "title": "Clear support beneath cargo to reach an exit — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/matching-clear-under-cargo/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「目标不能直接消除，要改变它下面的地形让它继续往下走。」
出處：`sources/text/matching-clear-under-cargo.json` 字元 208-234 `summary.zh`
顯示：目標不能直接消除，要改變它下面的地形讓它繼續往下走。

## 規則

「目标物件受重力影响，只有到达指定出口才算收集。玩家消除它下方或侧下方的物件来打开通路；无关位置的大面积消除可能得分很高，却没有推进运输目标。」
出處：`sources/text/matching-clear-under-cargo.json` 字元 359-429 `rules.zh`
顯示：目標物件受重力影響，只有到達指定出口才算收集。玩家消除它下方或側下方的物件來打開通路；無關位置的大面積消除可能得分很高，卻沒有推進運輸目標。

## 核心循環

「找到目标与出口之间的阻挡」
出處：`sources/text/matching-clear-under-cargo.json` 字元 685-697 `loop[0].zh`
顯示：找到目標與出口之間的阻擋

「选择能打开通路的消除」
出處：`sources/text/matching-clear-under-cargo.json` 字元 779-789 `loop[1].zh`
顯示：選擇能打開通路的消除

「观察目标掉落与停靠」
出處：`sources/text/matching-clear-under-cargo.json` 字元 868-877 `loop[2].zh`
顯示：觀察目標掉落與停靠

「继续处理下一个支撑点」
出處：`sources/text/matching-clear-under-cargo.json` 字元 959-969 `loop[3].zh`
顯示：繼續處理下一個支撐點

## 玩家取捨

「清目标正下方的小组，还是制造特殊块一次打穿多层？」
出處：`sources/text/matching-clear-under-cargo.json` 字元 1067-1091 `decisions[0].zh`
顯示：清目標正下方的小組，還是製造特殊塊一次打穿多層？

「出口不在正下方时，要先横向调整目标，还是先清另一条路线？」
出處：`sources/text/matching-clear-under-cargo.json` 字元 1226-1254 `decisions[1].zh`
顯示：出口不在正下方時，要先橫向調整目標，還是先清另一條路線？

## 可調參數

「出口数量与位置」
出處：`sources/text/matching-clear-under-cargo.json` 字元 1414-1421 `parameters[0].name.zh`
顯示：出口數量與位置

「多个出口更宽容；偏置或狭窄出口让路径准备更重要。」
出處：`sources/text/matching-clear-under-cargo.json` 字元 1497-1521 `parameters[0].effect.zh`
顯示：多個出口更寬容；偏置或狹窄出口讓路徑準備更重要。

「途中固定障碍」
出處：`sources/text/matching-clear-under-cargo.json` 字元 1673-1679 `parameters[1].name.zh`
顯示：途中固定障礙

「障碍增加分阶段规划，但必须让玩家清楚哪些格子可以通过。」
出處：`sources/text/matching-clear-under-cargo.json` 字元 1762-1789 `parameters[1].effect.zh`
顯示：障礙增加分階段規劃，但必須讓玩家清楚哪些格子可以通過。

## 原型

「做一个固定棋盘、一个目标和一个出口，只保留消除与重力。」
出處：`sources/text/matching-clear-under-cargo.json` 字元 3381-3408 `prototype.firstStep.zh`
顯示：做一個固定棋盤、一個目標和一個出口，只保留消除與重力。

「玩家会不会选择较小的消除，因为它能让目标真正前进一步？」
出處：`sources/text/matching-clear-under-cargo.json` 字元 3727-3754 `prototype.test.zh`
顯示：玩家會不會選擇較小的消除，因爲它能讓目標真正前進一步？

「斜向掉落和传送规则容易让路径难预测；先用直落和清楚的出口标记。」
出處：`sources/text/matching-clear-under-cargo.json` 字元 3546-3577 `prototype.pitfall.zh`
顯示：斜向掉落和傳送規則容易讓路徑難預測；先用直落和清楚的出口標記。

## 相關模式

- [完成整行](matching-complete-lines.md)
- [重力連鎖](matching-gravity-cascade.md)
- [合成三消升級](matching-merge-three-upgrade.md)
- [圖形生成電力](matching-pattern-creates-power.md)

## 參考來源

- [Clear support beneath cargo to reach an exit — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/matching-clear-under-cargo/) — 查閱：2026-11-02；取得方式：page-text。
