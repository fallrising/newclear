---
{
  "schema_version": 2,
  "id": "puzzles-box-pushing",
  "title": "不可逆推動與位置可達性",
  "title_en": "Box pushing and positional traps",
  "category": "puzzles",
  "source_category": "puzzles",
  "tags": [
    "state-space",
    "deadlock",
    "action-order"
  ],
  "summary": "移动物体之前，先想好自己还能站在哪里。",
  "note_status": "draft",
  "related": [
    "inventory-shape-packing",
    "building-structural-support"
  ],
  "sources": [
    {
      "title": "Box pushing and positional traps — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/puzzles-box-pushing/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「移动物体之前，先想好自己还能站在哪里。」
出處：`sources/text/puzzles-box-pushing.json` 字元 182-201 `summary.zh`
顯示：移動物體之前，先想好自己還能站在哪裏。

## 規則

「玩家从相邻格推动箱子，通过位置变化打开路径或满足目标。推动后可能无法走到反方向，也可能把物体卡入死角，因此解题关注站位与操作顺序；撤销帮助验证方案。」
出處：`sources/text/puzzles-box-pushing.json` 字元 302-376 `rules.zh`
顯示：玩家從相鄰格推動箱子，通過位置變化打開路徑或滿足目標。推動後可能無法走到反方向，也可能把物體卡入死角，因此解題關注站位與操作順序；撤銷幫助驗證方案。

## 核心循環

「辨认目标与死角」
出處：`sources/text/puzzles-box-pushing.json` 字元 620-627 `loop[0].zh`
顯示：辨認目標與死角

「规划可站立位置」
出處：`sources/text/puzzles-box-pushing.json` 字元 699-706 `loop[1].zh`
顯示：規劃可站立位置

「按顺序推动箱子」
出處：`sources/text/puzzles-box-pushing.json` 字元 771-778 `loop[2].zh`
顯示：按順序推動箱子

「检查目标或撤销」
出處：`sources/text/puzzles-box-pushing.json` 字元 846-853 `loop[3].zh`
顯示：檢查目標或撤銷

## 玩家取捨

「先解决远处目标，还是先腾出操作通道？」
出處：`sources/text/puzzles-box-pushing.json` 字元 942-960 `decisions[0].zh`
顯示：先解決遠處目標，還是先騰出操作通道？

「当前动作是否保留反向推动的站位？」
出處：`sources/text/puzzles-box-pushing.json` 字元 1058-1074 `decisions[1].zh`
顯示：當前動作是否保留反向推動的站位？

## 可調參數

「撤销范围」
出處：`sources/text/puzzles-box-pushing.json` 字元 1214-1218 `parameters[0].name.zh`
顯示：撤銷範圍

「无限撤销鼓励推理实验；有限撤销增加执行压力。」
出處：`sources/text/puzzles-box-pushing.json` 字元 1290-1312 `parameters[0].effect.zh`
顯示：無限撤銷鼓勵推理實驗；有限撤銷增加執行壓力。

「箱子特殊性质」
出處：`sources/text/puzzles-box-pushing.json` 字元 1450-1456 `parameters[1].name.zh`
顯示：箱子特殊性質

「少量例外可扩展解法；太多例外削弱可读性。」
出處：`sources/text/puzzles-box-pushing.json` 字元 1532-1552 `parameters[1].effect.zh`
顯示：少量例外可擴展解法；太多例外削弱可讀性。

## 原型

「做一张小格子地图、两个箱子、两个目标与逐步撤销。」
出處：`sources/text/puzzles-box-pushing.json` 字元 2884-2908 `prototype.firstStep.zh`
顯示：做一張小格子地圖、兩個箱子、兩個目標與逐步撤銷。

「观察玩家是否会提前保留站位，能否说出把箱子推入死角的后果。」
出處：`sources/text/puzzles-box-pushing.json` 字元 3211-3240 `prototype.test.zh`
顯示：觀察玩家是否會提前保留站位，能否說出把箱子推入死角的後果。

「先手工验证谜题有解；多加箱子只会增加搜索量，不保证更多好决策。」
出處：`sources/text/puzzles-box-pushing.json` 字元 3032-3063 `prototype.pitfall.zh`
顯示：先手工驗證謎題有解；多加箱子只會增加搜索量，不保證更多好決策。

## 相關模式

- [形狀式背包配置](inventory-shape-packing.md)
- [支撐約束與結構失效](building-structural-support.md)

## 參考來源

- [Box pushing and positional traps — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/puzzles-box-pushing/) — 查閱：2026-11-02；取得方式：page-text。
