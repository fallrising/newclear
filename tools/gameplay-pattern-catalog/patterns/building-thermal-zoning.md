---
{
  "schema_version": 2,
  "id": "building-thermal-zoning",
  "title": "熱區分區",
  "title_en": "Thermal zoning and control",
  "category": "building",
  "source_category": "building",
  "tags": [
    "spatial",
    "optimization",
    "risk"
  ],
  "summary": "把热源、冷库和生活区分开，让布局参与温度管理。",
  "note_status": "draft",
  "related": [
    "building-access-network",
    "building-service-coverage",
    "building-structural-support",
    "building-vertical-stacking"
  ],
  "sources": [
    {
      "title": "Thermal zoning and control — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/building-thermal-zoning/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把热源、冷库和生活区分开，让布局参与温度管理。」
出處：`sources/text/building-thermal-zoning.json` 字元 180-203 `summary.zh`
顯示：把熱源、冷庫和生活區分開，讓佈局參與溫度管理。

## 規則

「玩家利用墙、门、通风和温控设备改变区域温度。热源持续工作，开口与材料影响热交换；观察温度后调整边界和设备。」
出處：`sources/text/building-thermal-zoning.json` 字元 338-391 `rules.zh`
顯示：玩家利用牆、門、通風和溫控設備改變區域溫度。熱源持續工作，開口與材料影響熱交換；觀察溫度後調整邊界和設備。

## 核心循環

「定位热源和目标」
出處：`sources/text/building-thermal-zoning.json` 字元 614-621 `loop[0].zh`
顯示：定位熱源和目標

「划分冷热区」
出處：`sources/text/building-thermal-zoning.json` 字元 696-701 `loop[1].zh`
顯示：劃分冷熱區

「配置隔离与温控」
出處：`sources/text/building-thermal-zoning.json` 字元 772-779 `loop[2].zh`
顯示：配置隔離與溫控

「观察温差调整」
出處：`sources/text/building-thermal-zoning.json` 字元 849-855 `loop[3].zh`
顯示：觀察溫差調整

## 玩家取捨

「共享温控省设备，却难满足不同房间。」
出處：`sources/text/building-thermal-zoning.json` 字元 938-955 `decisions[0].zh`
顯示：共享溫控省設備，卻難滿足不同房間。

「严密隔离减少热交换，也增加走路和施工成本。」
出處：`sources/text/building-thermal-zoning.json` 字元 1058-1079 `decisions[1].zh`
顯示：嚴密隔離減少熱交換，也增加走路和施工成本。

## 可調參數

「热惯性」
出處：`sources/text/building-thermal-zoning.json` 字元 1234-1237 `parameters[0].name.zh`
顯示：熱慣性

「变化慢可提前预冷储热，变化快需要及时控制。」
出處：`sources/text/building-thermal-zoning.json` 字元 1314-1335 `parameters[0].effect.zh`
顯示：變化慢可提前預冷儲熱，變化快需要及時控制。

「材料差异」
出處：`sources/text/building-thermal-zoning.json` 字元 1481-1485 `parameters[1].name.zh`
顯示：材料差異

「明显导热差异使材料选择成为布局之外的决策层。」
出處：`sources/text/building-thermal-zoning.json` 字元 1567-1589 `parameters[1].effect.zh`
顯示：明顯導熱差異使材料選擇成爲佈局之外的決策層。

## 原型

「做两个房间的温度值、相连门、热源和制冷器，用简单热交换规则即可。」
出處：`sources/text/building-thermal-zoning.json` 字元 3066-3098 `prototype.firstStep.zh`
顯示：做兩個房間的溫度值、相連門、熱源和製冷器，用簡單熱交換規則即可。

「让制冷一直不达标，玩家能否找到漏热连接，而非只不断加制冷机？」
出處：`sources/text/building-thermal-zoning.json` 字元 3446-3476 `prototype.test.zh`
顯示：讓製冷一直不達標，玩家能否找到漏熱連接，而非只不斷加製冷機？

「每格传热、气体流动和材料相变会迅速扩大范围，先保持房间级计算。」
出處：`sources/text/building-thermal-zoning.json` 字元 3258-3289 `prototype.pitfall.zh`
顯示：每格傳熱、氣體流動和材料相變會迅速擴大範圍，先保持房間級計算。

## 相關模式

- [進出網路](building-access-network.md)
- [服務覆蓋](building-service-coverage.md)
- [支撐約束與結構失效](building-structural-support.md)
- [垂直疊高](building-vertical-stacking.md)

## 參考來源

- [Thermal zoning and control — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/building-thermal-zoning/) — 查閱：2026-11-02；取得方式：page-text。
