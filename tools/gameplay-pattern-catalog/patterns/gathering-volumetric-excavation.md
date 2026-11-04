---
{
  "schema_version": 2,
  "id": "gathering-volumetric-excavation",
  "title": "體積挖掘",
  "title_en": "Volumetric excavation",
  "category": "gathering",
  "source_category": "gathering",
  "tags": [
    "spatial",
    "creativity",
    "precision"
  ],
  "summary": "资源不是一个按钮，而是埋在可改变地形里的体积。",
  "note_status": "draft",
  "related": [
    "building-modular-snapping",
    "building-terrain-shaping",
    "building-vertical-stacking",
    "gathering-hidden-deposit-clues"
  ],
  "sources": [
    {
      "title": "Volumetric excavation — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/gathering-volumetric-excavation/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「资源不是一个按钮，而是埋在可改变地形里的体积。」
出處：`sources/text/gathering-volumetric-excavation.json` 字元 182-205 `summary.zh`
顯示：資源不是一個按鈕，而是埋在可改變地形裏的體積。

## 規則

「玩家以工具移除一部分地形，逐步暴露或收取资源。工具影响的形状与大小决定开口、坡道和挖掘精度；挖掘也会改变之后的通行路线。」
出處：`sources/text/gathering-volumetric-excavation.json` 字元 325-385 `rules.zh`
顯示：玩家以工具移除一部分地形，逐步暴露或收取資源。工具影響的形狀與大小決定開口、坡道和挖掘精度；挖掘也會改變之後的通行路線。

## 核心循環

「定位埋藏区域」
出處：`sources/text/gathering-volumetric-excavation.json` 字元 602-608 `loop[0].zh`
顯示：定位埋藏區域

「选择挖掘形状」
出處：`sources/text/gathering-volumetric-excavation.json` 字元 674-680 `loop[1].zh`
顯示：選擇挖掘形狀

「逐步移除地形」
出處：`sources/text/gathering-volumetric-excavation.json` 字元 746-752 `loop[2].zh`

「收集并整理出口」
出處：`sources/text/gathering-volumetric-excavation.json` 字元 824-831 `loop[3].zh`
顯示：收集並整理出口

## 玩家取捨

「大范围快速挖开，还是细挖保护通路与目标？」
出處：`sources/text/gathering-volumetric-excavation.json` 字元 929-949 `decisions[0].zh`
顯示：大範圍快速挖開，還是細挖保護通路與目標？

「从上方直挖，还是多花时间做可返回的坡道？」
出處：`sources/text/gathering-volumetric-excavation.json` 字元 1052-1072 `decisions[1].zh`
顯示：從上方直挖，還是多花時間做可返回的坡道？

## 可調參數

「工具作用范围」
出處：`sources/text/gathering-volumetric-excavation.json` 字元 1211-1217 `parameters[0].name.zh`
顯示：工具作用範圍

「大范围提高吞吐量但降低精确度；小范围强化空间规划。」
出處：`sources/text/gathering-volumetric-excavation.json` 字元 1289-1314 `parameters[0].effect.zh`
顯示：大範圍提高吞吐量但降低精確度；小範圍強化空間規劃。

「地形回填能力」
出處：`sources/text/gathering-volumetric-excavation.json` 字元 1480-1486 `parameters[1].name.zh`

「能回填鼓励试验；不可逆地形让玩家更谨慎。」
出處：`sources/text/gathering-volumetric-excavation.json` 字元 1567-1587 `parameters[1].effect.zh`
顯示：能回填鼓勵試驗；不可逆地形讓玩家更謹慎。

## 原型

「先做一小块可挖体素、单一工具与碰撞更新，验证挖后能通行；暂不做无限世界。」
出處：`sources/text/gathering-volumetric-excavation.json` 字元 3069-3105 `prototype.firstStep.zh`
顯示：先做一小塊可挖體素、單一工具與碰撞更新，驗證挖後能通行；暫不做無限世界。

「玩家能否有意挖出可返回的通路，且反复挖掘后不出现穿地或卡住？」
出處：`sources/text/gathering-volumetric-excavation.json` 字元 3477-3507 `prototype.test.zh`
顯示：玩家能否有意挖出可返回的通路，且反覆挖掘後不出現穿地或卡住？

「连续地形重建、碰撞、存档体积和碎块表现都可能成为大工程，应逐项验证。」
出處：`sources/text/gathering-volumetric-excavation.json` 字元 3283-3317 `prototype.pitfall.zh`
顯示：連續地形重建、碰撞、存檔體積和碎塊表現都可能成爲大工程，應逐項驗證。

## 相關模式

- [模組吸附決策](building-modular-snapping.md)
- [地形塑形](building-terrain-shaping.md)
- [垂直疊高](building-vertical-stacking.md)
- [隱藏礦床線索](gathering-hidden-deposit-clues.md)

## 參考來源

- [Volumetric excavation — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/gathering-volumetric-excavation/) — 查閱：2026-11-02；取得方式：page-text。
