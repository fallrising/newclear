---
{
  "schema_version": 2,
  "id": "matching-complete-lines",
  "title": "完成整行",
  "title_en": "Complete a line to reclaim space",
  "category": "matching",
  "source_category": "matching",
  "tags": [
    "planning",
    "spatial",
    "optimization"
  ],
  "summary": "落下或放入的形状占地方，凑满一行才能把空间拿回来。",
  "note_status": "draft",
  "related": [
    "matching-merge-three-upgrade",
    "matching-pattern-creates-power",
    "matching-swap-to-align",
    "matching-tap-connected-group"
  ],
  "sources": [
    {
      "title": "Complete a line to reclaim space — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/matching-complete-lines/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「落下或放入的形状占地方，凑满一行才能把空间拿回来。」
出處：`sources/text/matching-complete-lines.json` 字元 188-213 `summary.zh`
顯示：落下或放入的形狀佔地方，湊滿一行才能把空間拿回來。

## 規則

「玩家把给定形状放进有限棋盘，填满规定的整行、整列或区域后，这些格子一起清空。每次放置都会占用未来空间，因此要兼顾眼前能清的线、留下的洞以及下一块能否放下。」
出處：`sources/text/matching-complete-lines.json` 字元 336-413 `rules.zh`
顯示：玩家把給定形狀放進有限棋盤，填滿規定的整行、整列或區域後，這些格子一起清空。每次放置都會佔用未來空間，因此要兼顧眼前能清的線、留下的洞以及下一塊能否放下。

## 核心循環

「查看当前形状和空缺」
出處：`sources/text/matching-complete-lines.json` 字元 686-695 `loop[0].zh`
顯示：查看當前形狀和空缺

「选择朝向与放置位置」
出處：`sources/text/matching-complete-lines.json` 字元 771-780 `loop[1].zh`
顯示：選擇朝向與放置位置

「清除填满的线或区域」
出處：`sources/text/matching-complete-lines.json` 字元 856-865 `loop[2].zh`
顯示：清除填滿的線或區域

「用腾出的空间接下一块」
出處：`sources/text/matching-complete-lines.json` 字元 941-951 `loop[3].zh`
顯示：用騰出的空間接下一塊

## 玩家取捨

「先清一行保住空间，还是积攒结构争取一次清多行？」
出處：`sources/text/matching-complete-lines.json` 字元 1059-1082 `decisions[0].zh`
顯示：先清一行保住空間，還是積攢結構爭取一次清多行？

「贴边放置更整齐，但会不会留下以后难以补上的洞？」
出處：`sources/text/matching-complete-lines.json` 字元 1198-1221 `decisions[1].zh`
顯示：貼邊放置更整齊，但會不會留下以後難以補上的洞？

## 可調參數

「形状预告数量」
出處：`sources/text/matching-complete-lines.json` 字元 1374-1380 `parameters[0].name.zh`
顯示：形狀預告數量

「知道更多后续形状，玩家就能规划多步；无预告更重视通用空位。」
出處：`sources/text/matching-complete-lines.json` 字元 1461-1490 `parameters[0].effect.zh`
顯示：知道更多後續形狀，玩家就能規劃多步；無預告更重視通用空位。

「清除条件」
出處：`sources/text/matching-complete-lines.json` 字元 1645-1649 `parameters[1].name.zh`
顯示：清除條件

「只清整行更集中；同时允许整列或小区域，会出现交叉清除机会。」
出處：`sources/text/matching-complete-lines.json` 字元 1727-1756 `parameters[1].effect.zh`
顯示：只清整行更集中；同時允許整列或小區域，會出現交叉清除機會。

## 原型

「先用六乘六静态棋盘、三种形状和整行清除，不加实时下落。」
出處：`sources/text/matching-complete-lines.json` 字元 3265-3292 `prototype.firstStep.zh`
顯示：先用六乘六靜態棋盤、三種形狀和整行清除，不加實時下落。

「玩家能否在放置前指出这一步会留下哪种难填空缺？」
出處：`sources/text/matching-complete-lines.json` 字元 3618-3641 `prototype.test.zh`
顯示：玩家能否在放置前指出這一步會留下哪種難填空缺？

「形状旋转、预告和随机发牌会显著改变难度，先固定其中两项。」
出處：`sources/text/matching-complete-lines.json` 字元 3439-3467 `prototype.pitfall.zh`
顯示：形狀旋轉、預告和隨機發牌會顯著改變難度，先固定其中兩項。

## 相關模式

- [合成三消升級](matching-merge-three-upgrade.md)
- [圖形生成電力](matching-pattern-creates-power.md)
- [交換對齊](matching-swap-to-align.md)
- [點選相連群組](matching-tap-connected-group.md)

## 參考來源

- [Complete a line to reclaim space — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/matching-complete-lines/) — 查閱：2026-11-02；取得方式：page-text。
