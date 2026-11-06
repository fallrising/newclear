---
{
  "schema_version": 2,
  "id": "matching-tap-connected-group",
  "title": "點選相連群組",
  "title_en": "Clear a connected group with one tap",
  "category": "matching",
  "source_category": "matching",
  "tags": [
    "planning",
    "spatial",
    "optimization"
  ],
  "summary": "先改变周围排列，把小团接成大团，再选择何时收掉。",
  "note_status": "draft",
  "related": [
    "matching-complete-lines",
    "matching-merge-three-upgrade",
    "matching-pattern-creates-power",
    "matching-swap-to-align"
  ],
  "sources": [
    {
      "title": "Clear a connected group with one tap — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/matching-tap-connected-group/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先改变周围排列，把小团接成大团，再选择何时收掉。」
出處：`sources/text/matching-tap-connected-group.json` 字元 198-222 `summary.zh`
顯示：先改變周圍排列，把小團接成大團，再選擇何時收掉。

## 規則

「玩家点击一团横纵相连的同色块，只要达到数量门槛，整团就会消失。空位让其他块移动，原本分开的同色块可能接到一起；因此点击位置既决定眼前收益，也决定下一团会长在哪里。」
出處：`sources/text/matching-tap-connected-group.json` 字元 349-430 `rules.zh`
顯示：玩家點擊一團橫縱相連的同色塊，只要達到數量門檻，整團就會消失。空位讓其他塊移動，原本分開的同色塊可能接到一起；因此點擊位置既決定眼前收益，也決定下一團會長在哪裏。

## 核心循環

「找到相连的同色团」
出處：`sources/text/matching-tap-connected-group.json` 字元 740-748 `loop[0].zh`
顯示：找到相連的同色團

「比较当前清除与后续连通」
出處：`sources/text/matching-tap-connected-group.json` 字元 820-831 `loop[1].zh`
顯示：比較當前清除與後續連通

「点击整团并结算」
出處：`sources/text/matching-tap-connected-group.json` 字元 925-932 `loop[2].zh`
顯示：點擊整團並結算

「利用移动后的新团」
出處：`sources/text/matching-tap-connected-group.json` 字元 1003-1011 `loop[3].zh`
顯示：利用移動後的新團

## 玩家取捨

「先清一小团把两侧的大团接起来，还是马上消掉已有的大团？」
出處：`sources/text/matching-tap-connected-group.json` 字元 1109-1136 `decisions[0].zh`
顯示：先清一小團把兩側的大團接起來，還是馬上消掉已有的大團？

「大团离目标很远，靠目标的小团是否更值得这一步？」
出處：`sources/text/matching-tap-connected-group.json` 字元 1263-1286 `decisions[1].zh`
顯示：大團離目標很遠，靠目標的小團是否更值得這一步？

## 可調參數

「最低团块大小」
出處：`sources/text/matching-tap-connected-group.json` 字元 1446-1452 `parameters[0].name.zh`
顯示：最低團塊大小

「较低门槛减少卡死；较高门槛更强调先改变周围布局。」
出處：`sources/text/matching-tap-connected-group.json` 字元 1532-1556 `parameters[0].effect.zh`
顯示：較低門檻減少卡死；較高門檻更強調先改變周圍佈局。

「空位移动规则」
出處：`sources/text/matching-tap-connected-group.json` 字元 1716-1722 `parameters[1].name.zh`
顯示：空位移動規則

「只向下落和整列横向压缩会形成不同的后续连通关系。」
出處：`sources/text/matching-tap-connected-group.json` 字元 1796-1820 `parameters[1].effect.zh`
顯示：只向下落和整列橫向壓縮會形成不同的後續連通關係。

## 原型

「做一个五乘六棋盘，点团后只向下补位，显示点击将影响的整团。」
出處：`sources/text/matching-tap-connected-group.json` 字元 3433-3462 `prototype.firstStep.zh`
顯示：做一個五乘六棋盤，點團後只向下補位，顯示點擊將影響的整團。

「玩家是否愿意先消少量物件，为下一步创造更有用的大团？」
出處：`sources/text/matching-tap-connected-group.json` 字元 3781-3807 `prototype.test.zh`
顯示：玩家是否願意先消少量物件，爲下一步創造更有用的大團？

「不要只奖励团块数量；给一个位置目标，才能观察玩家是否会规划。」
出處：`sources/text/matching-tap-connected-group.json` 字元 3604-3634 `prototype.pitfall.zh`
顯示：不要只獎勵團塊數量；給一個位置目標，才能觀察玩家是否會規劃。

## 相關模式

- [完成整行](matching-complete-lines.md)
- [合成三消升級](matching-merge-three-upgrade.md)
- [圖形生成電力](matching-pattern-creates-power.md)
- [交換對齊](matching-swap-to-align.md)

## 參考來源

- [Clear a connected group with one tap — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/matching-tap-connected-group/) — 查閱：2026-11-02；取得方式：page-text。
