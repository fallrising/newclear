---
{
  "schema_version": 2,
  "id": "building-service-coverage",
  "title": "服務覆蓋",
  "title_en": "Service coverage placement",
  "category": "building",
  "source_category": "building",
  "tags": [
    "spatial",
    "planning",
    "optimization"
  ],
  "summary": "让关键设施覆盖更多需求，同时减少无效重叠。",
  "note_status": "draft",
  "related": [
    "building-access-network",
    "building-construction-sequencing",
    "building-room-requirements",
    "building-structural-support"
  ],
  "sources": [
    {
      "title": "Service coverage placement — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/building-service-coverage/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「让关键设施覆盖更多需求，同时减少无效重叠。」
出處：`sources/text/building-service-coverage.json` 字元 181-202 `summary.zh`
顯示：讓關鍵設施覆蓋更多需求，同時減少無效重疊。

## 規則

「玩家查看设施作用范围，把需要服务的对象安排在有效区域。边界、路径和容量限制收益；覆盖提示与未服务对象引导下一轮选址。」
出處：`sources/text/building-service-coverage.json` 字元 311-369 `rules.zh`
顯示：玩家查看設施作用範圍，把需要服務的對象安排在有效區域。邊界、路徑和容量限制收益；覆蓋提示與未服務對象引導下一輪選址。

## 核心循環

「找出缺口」
出處：`sources/text/building-service-coverage.json` 字元 576-580 `loop[0].zh`

「预览覆盖」
出處：`sources/text/building-service-coverage.json` 字元 635-639 `loop[1].zh`
顯示：預覽覆蓋

「放置设施」
出處：`sources/text/building-service-coverage.json` 字元 696-700 `loop[2].zh`
顯示：放置設施

「检查边缘与扩张」
出處：`sources/text/building-service-coverage.json` 字元 760-767 `loop[3].zh`
顯示：檢查邊緣與擴張

## 玩家取捨

「中心位置覆盖广，却占据宝贵地块。」
出處：`sources/text/building-service-coverage.json` 字元 854-870 `decisions[0].zh`
顯示：中心位置覆蓋廣，卻佔據寶貴地塊。

「边缘站点减少盲区，却增加重复建设。」
出處：`sources/text/building-service-coverage.json` 字元 964-981 `decisions[1].zh`
顯示：邊緣站點減少盲區，卻增加重複建設。

## 可調參數

「范围形状」
出處：`sources/text/building-service-coverage.json` 字元 1119-1123 `parameters[0].name.zh`
顯示：範圍形狀

「圆形易理解，沿路传播强调路网配合。」
出處：`sources/text/building-service-coverage.json` 字元 1199-1216 `parameters[0].effect.zh`
顯示：圓形易理解，沿路傳播強調路網配合。

「服务容量」
出處：`sources/text/building-service-coverage.json` 字元 1352-1356 `parameters[1].name.zh`
顯示：服務容量

「容量有限时，已覆盖区域也可能需要新设施。」
出處：`sources/text/building-service-coverage.json` 字元 1426-1446 `parameters[1].effect.zh`
顯示：容量有限時，已覆蓋區域也可能需要新設施。

## 原型

「做有限地图、几个需求点和一个可移动覆盖圆，显示覆盖数量与建造成本。」
出處：`sources/text/building-service-coverage.json` 字元 2905-2938 `prototype.firstStep.zh`
顯示：做有限地圖、幾個需求點和一個可移動覆蓋圓，顯示覆蓋數量與建造成本。

「在新增需求点后，玩家是否会重新评估旧设施位置，而不只是继续堆数量？」
出處：`sources/text/building-service-coverage.json` 字元 3281-3314 `prototype.test.zh`
顯示：在新增需求點後，玩家是否會重新評估舊設施位置，而不只是繼續堆數量？

「覆盖范围、服务容量和道路可达是三种限制，首版先清楚区分再逐项加入。」
出處：`sources/text/building-service-coverage.json` 字元 3089-3122 `prototype.pitfall.zh`
顯示：覆蓋範圍、服務容量和道路可達是三種限制，首版先清楚區分再逐項加入。

## 相關模式

- [進出網路](building-access-network.md)
- [施工工序](building-construction-sequencing.md)
- [房間需求條件](building-room-requirements.md)
- [支撐約束與結構失效](building-structural-support.md)

## 參考來源

- [Service coverage placement — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/building-service-coverage/) — 查閱：2026-11-02；取得方式：page-text。
