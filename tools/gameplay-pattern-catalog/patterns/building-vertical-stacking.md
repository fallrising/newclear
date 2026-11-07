---
{
  "schema_version": 2,
  "id": "building-vertical-stacking",
  "title": "垂直疊高",
  "title_en": "Vertical stacking",
  "category": "building",
  "source_category": "building",
  "tags": [
    "spatial",
    "creativity",
    "optimization"
  ],
  "summary": "平面放不下时，把功能层叠起来，再解决上下连接。",
  "note_status": "draft",
  "related": [
    "building-access-network",
    "building-modular-snapping",
    "building-service-coverage",
    "building-terrain-shaping"
  ],
  "sources": [
    {
      "title": "Vertical stacking — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/building-vertical-stacking/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「平面放不下时，把功能层叠起来，再解决上下连接。」
出處：`sources/text/building-vertical-stacking.json` 字元 173-196 `summary.zh`
顯示：平面放不下時，把功能層疊起來，再解決上下連接。

## 規則

「玩家在可承载的平台或结构上继续建设，把同一地块用于多层功能。可叠建资格与上下通路限制布局；通过可用面积和运输便利检验成果。」
出處：`sources/text/building-vertical-stacking.json` 字元 302-363 `rules.zh`
顯示：玩家在可承載的平臺或結構上繼續建設，把同一地塊用於多層功能。可疊建資格與上下通路限制佈局；通過可用面積和運輸便利檢驗成果。

## 核心循環

「选择有效底座」
出處：`sources/text/building-vertical-stacking.json` 字元 597-603 `loop[0].zh`
顯示：選擇有效底座

「分配楼层功能」
出處：`sources/text/building-vertical-stacking.json` 字元 666-672 `loop[1].zh`
顯示：分配樓層功能

「建设竖向通路」
出處：`sources/text/building-vertical-stacking.json` 字元 738-744 `loop[2].zh`
顯示：建設豎向通路

「检验通行供料」
出處：`sources/text/building-vertical-stacking.json` 字元 809-815 `loop[3].zh`
顯示：檢驗通行供料

## 玩家取捨

「向上扩建省土地，却增加层间移动。」
出處：`sources/text/building-vertical-stacking.json` 字元 903-919 `decisions[0].zh`
顯示：向上擴建省土地，卻增加層間移動。

「预留竖井方便扩张，但降低当前空间利用率。」
出處：`sources/text/building-vertical-stacking.json` 字元 1019-1039 `decisions[1].zh`
顯示：預留豎井方便擴張，但降低當前空間利用率。

## 可調參數

「高度限制」
出處：`sources/text/building-vertical-stacking.json` 字元 1176-1180 `parameters[0].name.zh`

「低上限强调楼层分配，高上限容许复杂竖向城市。」
出處：`sources/text/building-vertical-stacking.json` 字元 1254-1276 `parameters[0].effect.zh`
顯示：低上限強調樓層分配，高上限容許複雜豎向城市。

「竖向运输成本」
出處：`sources/text/building-vertical-stacking.json` 字元 1416-1422 `parameters[1].name.zh`
顯示：豎向運輸成本

「上下运输昂贵时，相邻工序更值得放在同层。」
出處：`sources/text/building-vertical-stacking.json` 字元 1506-1526 `parameters[1].effect.zh`
顯示：上下運輸昂貴時，相鄰工序更值得放在同層。

## 原型

「先做两层固定网格、可承载标记和一个楼梯节点，用层切换代替复杂3D。」
出處：`sources/text/building-vertical-stacking.json` 字元 2981-3014 `prototype.firstStep.zh`
顯示：先做兩層固定網格、可承載標記和一個樓梯節點，用層切換代替複雜3D。

「玩家是否会为楼梯预留位置，并因搬运路线调整某层用途？」
出處：`sources/text/building-vertical-stacking.json` 字元 3370-3396 `prototype.test.zh`
顯示：玩家是否會爲樓梯預留位置，並因搬運路線調整某層用途？

「楼层遮挡、承重、跨层寻路与输入选择容易互相干扰，先用清楚的层视图。」
出處：`sources/text/building-vertical-stacking.json` 字元 3183-3216 `prototype.pitfall.zh`
顯示：樓層遮擋、承重、跨層尋路與輸入選擇容易互相干擾，先用清楚的層視圖。

## 相關模式

- [進出網路](building-access-network.md)
- [模組吸附決策](building-modular-snapping.md)
- [服務覆蓋](building-service-coverage.md)
- [地形塑形](building-terrain-shaping.md)

## 參考來源

- [Vertical stacking — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/building-vertical-stacking/) — 查閱：2026-11-02；取得方式：page-text。
