---
{
  "schema_version": 2,
  "id": "puzzles-paper-folding",
  "title": "摺疊地形以連接路線",
  "title_en": "Folding terrain to connect routes",
  "category": "puzzles",
  "source_category": "puzzles",
  "tags": [
    "spatial",
    "planning",
    "creativity"
  ],
  "summary": "把远处的两块地形折到一起，再让角色通过。",
  "note_status": "draft",
  "related": [
    "puzzles-beam-routing",
    "puzzles-box-pushing",
    "puzzles-gravity",
    "puzzles-linked-portals"
  ],
  "sources": [
    {
      "title": "Folding terrain to connect routes — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/puzzles-paper-folding/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把远处的两块地形折到一起，再让角色通过。」
出處：`sources/text/puzzles-paper-folding.json` 字元 183-203 `summary.zh`
顯示：把遠處的兩塊地形折到一起，再讓角色通過。

## 規則

「玩家沿允许的边缘折叠或展开纸面世界，让分离的路径相接。折叠会遮住区域、改变连接，角色位置与机关状态需要配合；新通路出现后才能继续前进。」
出處：`sources/text/puzzles-paper-folding.json` 字元 295-362 `rules.zh`
顯示：玩家沿允許的邊緣摺疊或展開紙面世界，讓分離的路徑相接。摺疊會遮住區域、改變連接，角色位置與機關狀態需要配合；新通路出現後才能繼續前進。

## 核心循環

「观察可用路径」
出處：`sources/text/puzzles-paper-folding.json` 字元 591-597 `loop[0].zh`
顯示：觀察可用路徑

「选择折叠边缘」
出處：`sources/text/puzzles-paper-folding.json` 字元 664-670 `loop[1].zh`
顯示：選擇摺疊邊緣

「拼接可走通道」
出處：`sources/text/puzzles-paper-folding.json` 字元 735-741 `loop[2].zh`

「移动角色后调整」
出處：`sources/text/puzzles-paper-folding.json` 字元 810-817 `loop[3].zh`
顯示：移動角色後調整

## 玩家取捨

「连接终点的折叠会不会遮住必经入口？」
出處：`sources/text/puzzles-paper-folding.json` 字元 911-928 `decisions[0].zh`
顯示：連接終點的摺疊會不會遮住必經入口？

「先站在哪块地形才能完成下一次折叠？」
出處：`sources/text/puzzles-paper-folding.json` 字元 1032-1049 `decisions[1].zh`
顯示：先站在哪塊地形才能完成下一次摺疊？

## 可調參數

「折叠自由度」
出處：`sources/text/puzzles-paper-folding.json` 字元 1185-1190 `parameters[0].name.zh`
顯示：摺疊自由度

「预设折线便于理解；更多折叠方式增加空间搜索。」
出處：`sources/text/puzzles-paper-folding.json` 字元 1267-1289 `parameters[0].effect.zh`
顯示：預設折線便於理解；更多摺疊方式增加空間搜索。

「双面信息」
出處：`sources/text/puzzles-paper-folding.json` 字元 1425-1429 `parameters[1].name.zh`
顯示：雙面信息

「查看背面降低记忆负担；隐藏背面要求预判。」
出處：`sources/text/puzzles-paper-folding.json` 字元 1512-1532 `parameters[1].effect.zh`
顯示：查看背面降低記憶負擔；隱藏背面要求預判。

## 原型

「做两块可折叠区域，使用离散网格连接而非自由纸张物理。」
出處：`sources/text/puzzles-paper-folding.json` 字元 2894-2920 `prototype.firstStep.zh`
顯示：做兩塊可摺疊區域，使用離散網格連接而非自由紙張物理。

「观察玩家是否先安排角色站位再折纸，并能预测被遮住的路线。」
出處：`sources/text/puzzles-paper-folding.json` 字元 3254-3282 `prototype.test.zh`
顯示：觀察玩家是否先安排角色站位再摺紙，並能預測被遮住的路線。

「必须统一角色所在层与可行走边缘；先别支持任意角度和多层交叠。」
出處：`sources/text/puzzles-paper-folding.json` 字元 3070-3100 `prototype.pitfall.zh`
顯示：必須統一角色所在層與可行走邊緣；先別支持任意角度和多層交疊。

## 相關模式

- [光束路由](puzzles-beam-routing.md)
- [不可逆推動與位置可達性](puzzles-box-pushing.md)
- [重力決策](puzzles-gravity.md)
- [聯動傳送門](puzzles-linked-portals.md)

## 參考來源

- [Folding terrain to connect routes — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/puzzles-paper-folding/) — 查閱：2026-11-02；取得方式：page-text。
