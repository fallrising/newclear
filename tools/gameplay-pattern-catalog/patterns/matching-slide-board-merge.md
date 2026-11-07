---
{
  "schema_version": 2,
  "id": "matching-slide-board-merge",
  "title": "滑動盤面合成",
  "title_en": "Slide the whole board to merge numbers",
  "category": "matching",
  "source_category": "matching",
  "tags": [
    "planning",
    "spatial",
    "risk"
  ],
  "summary": "一次方向输入会影响多排物件，不能只盯着眼前的一对。",
  "note_status": "draft",
  "related": [
    "matching-clear-under-cargo",
    "matching-combine-power-pieces",
    "matching-complete-lines",
    "matching-gravity-cascade"
  ],
  "sources": [
    {
      "title": "Slide the whole board to merge numbers — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/matching-slide-board-merge/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「一次方向输入会影响多排物件，不能只盯着眼前的一对。」
出處：`sources/text/matching-slide-board-merge.json` 字元 200-225 `summary.zh`
顯示：一次方向輸入會影響多排物件，不能只盯着眼前的一對。

## 規則

「玩家选择一个方向，让棋盘上的可移动物件一起滑动；满足配对条件的物件相遇后合并。有效移动还会加入新物件，因此每次腾出的空间也在被重新消耗，玩家必须维持整盘的可操作性。」
出處：`sources/text/matching-slide-board-merge.json` 字元 363-445 `rules.zh`
顯示：玩家選擇一個方向，讓棋盤上的可移動物件一起滑動；滿足配對條件的物件相遇後合併。有效移動還會加入新物件，因此每次騰出的空間也在被重新消耗，玩家必須維持整盤的可操作性。

## 核心循環

「预测整盘滑动结果」
出處：`sources/text/matching-slide-board-merge.json` 字元 740-748 `loop[0].zh`
顯示：預測整盤滑動結果

「选择一个方向」
出處：`sources/text/matching-slide-board-merge.json` 字元 821-827 `loop[1].zh`
顯示：選擇一個方向

「结算合并与新物件」
出處：`sources/text/matching-slide-board-merge.json` 字元 889-897 `loop[2].zh`
顯示：結算合併與新物件

「检查下一步仍能移动吗」
出處：`sources/text/matching-slide-board-merge.json` 字元 978-988 `loop[3].zh`
顯示：檢查下一步仍能移動嗎

## 玩家取捨

「合并眼前的大数字，是否会把小数字夹在角落无法配对？」
出處：`sources/text/matching-slide-board-merge.json` 字元 1087-1112 `decisions[0].zh`
顯示：合併眼前的大數字，是否會把小數字夾在角落無法配對？

「要先腾出一格，还是维持整齐的数字顺序等待下一块？」
出處：`sources/text/matching-slide-board-merge.json` 字元 1224-1248 `decisions[1].zh`
顯示：要先騰出一格，還是維持整齊的數字順序等待下一塊？

## 可調參數

「单次滑动距离」
出處：`sources/text/matching-slide-board-merge.json` 字元 1401-1407 `parameters[0].name.zh`
顯示：單次滑動距離

「滑到尽头变化大；只走一格更容易做细微调整，但新物件会更快挤占空间。」
出處：`sources/text/matching-slide-board-merge.json` 字元 1487-1520 `parameters[0].effect.zh`
顯示：滑到盡頭變化大；只走一格更容易做細微調整，但新物件會更快擠佔空間。

「新物件预告」
出處：`sources/text/matching-slide-board-merge.json` 字元 1712-1717 `parameters[1].name.zh`
顯示：新物件預告

「预告让玩家能安排入口；完全未知时需要保留更多通用空位。」
出處：`sources/text/matching-slide-board-merge.json` 字元 1801-1828 `parameters[1].effect.zh`
顯示：預告讓玩家能安排入口；完全未知時需要保留更多通用空位。

## 原型

「做四乘四数字棋盘，使用固定的新块序列，先比较四个方向的可读性。」
出處：`sources/text/matching-slide-board-merge.json` 字元 3369-3400 `prototype.firstStep.zh`
顯示：做四乘四數字棋盤，使用固定的新塊序列，先比較四個方向的可讀性。

「玩家能否在输入前预测至少两排会如何变化？」
出處：`sources/text/matching-slide-board-merge.json` 字元 3758-3778 `prototype.test.zh`
顯示：玩家能否在輸入前預測至少兩排會如何變化？

「同一回合新合成的物件能否再次合并必须明确，否则预测和结算会不一致。」
出處：`sources/text/matching-slide-board-merge.json` 字元 3567-3600 `prototype.pitfall.zh`
顯示：同一回合新合成的物件能否再次合併必須明確，否則預測和結算會不一致。

## 相關模式

- [清除下方貨物](matching-clear-under-cargo.md)
- [合併電力棋子](matching-combine-power-pieces.md)
- [完成整行](matching-complete-lines.md)
- [重力連鎖](matching-gravity-cascade.md)

## 參考來源

- [Slide the whole board to merge numbers — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/matching-slide-board-merge/) — 查閱：2026-11-02；取得方式：page-text。
