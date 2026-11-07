---
{
  "schema_version": 2,
  "id": "building-terrain-shaping",
  "title": "地形塑形",
  "title_en": "Terrain shaping",
  "category": "building",
  "source_category": "building",
  "tags": [
    "spatial",
    "creativity",
    "planning"
  ],
  "summary": "直接改动高低与地面形状，为建筑和水流创造条件。",
  "note_status": "draft",
  "related": [
    "building-access-network",
    "building-modular-snapping",
    "building-room-requirements",
    "building-service-coverage"
  ],
  "sources": [
    {
      "title": "Terrain shaping — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/building-terrain-shaping/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「直接改动高低与地面形状，为建筑和水流创造条件。」
出處：`sources/text/building-terrain-shaping.json` 字元 167-190 `summary.zh`
顯示：直接改動高低與地面形狀，爲建築和水流創造條件。

## 規則

「玩家抬高、削低或填补地形，取得可用空间和通路。工具与材料限制改造，结果改变可建造位置、坡度和水路。」
出處：`sources/text/building-terrain-shaping.json` 字元 288-337 `rules.zh`
顯示：玩家抬高、削低或填補地形，取得可用空間和通路。工具與材料限制改造，結果改變可建造位置、坡度和水路。

## 核心循環

「识别地形问题」
出處：`sources/text/building-terrain-shaping.json` 字元 532-538 `loop[0].zh`
顯示：識別地形問題

「选择挖除或填筑」
出處：`sources/text/building-terrain-shaping.json` 字元 605-612 `loop[1].zh`
顯示：選擇挖除或填築

「局部施工」
出處：`sources/text/building-terrain-shaping.json` 字元 681-685 `loop[2].zh`

「检查改造结果」
出處：`sources/text/building-terrain-shaping.json` 字元 744-750 `loop[3].zh`
顯示：檢查改造結果

## 玩家取捨

「顺应地形省成本，平整后更便于布局。」
出處：`sources/text/building-terrain-shaping.json` 字元 830-847 `decisions[0].zh`
顯示：順應地形省成本，平整後更便於佈局。

「局部改造快，却可能把水路问题推到邻区。」
出處：`sources/text/building-terrain-shaping.json` 字元 950-969 `decisions[1].zh`
顯示：局部改造快，卻可能把水路問題推到鄰區。

## 可調參數

「改造成本」
出處：`sources/text/building-terrain-shaping.json` 字元 1105-1109 `parameters[0].name.zh`

「高成本鼓励适应自然，低成本鼓励造型。」
出處：`sources/text/building-terrain-shaping.json` 字元 1185-1203 `parameters[0].effect.zh`
顯示：高成本鼓勵適應自然，低成本鼓勵造型。

「可逆性」
出處：`sources/text/building-terrain-shaping.json` 字元 1336-1339 `parameters[1].name.zh`

「容易恢复适合实验，不可逆改造需要更清楚的预览。」
出處：`sources/text/building-terrain-shaping.json` 字元 1414-1437 `parameters[1].effect.zh`
顯示：容易恢復適合實驗，不可逆改造需要更清楚的預覽。

## 原型

「先做格子高度、填挖成本和建筑平整条件，暂不加入真实地形网格变形。」
出處：`sources/text/building-terrain-shaping.json` 字元 2873-2905 `prototype.firstStep.zh`
顯示：先做格子高度、填挖成本和建築平整條件，暫不加入真實地形網格變形。

「玩家是否愿意局部改造以节省材料，并能预见哪条通路会受到影响？」
出處：`sources/text/building-terrain-shaping.json` 字元 3256-3286 `prototype.test.zh`
顯示：玩家是否願意局部改造以節省材料，並能預見哪條通路會受到影響？

「若地形变化还联动水流、导航与植被，每次修改都会触发更多系统，需逐层扩展。」
出處：`sources/text/building-terrain-shaping.json` 字元 3065-3101 `prototype.pitfall.zh`
顯示：若地形變化還聯動水流、導航與植被，每次修改都會觸發更多系統，需逐層擴展。

## 相關模式

- [進出網路](building-access-network.md)
- [模組吸附決策](building-modular-snapping.md)
- [房間需求條件](building-room-requirements.md)
- [服務覆蓋](building-service-coverage.md)

## 參考來源

- [Terrain shaping — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/building-terrain-shaping/) — 查閱：2026-11-02；取得方式：page-text。
