---
{
  "schema_version": 2,
  "id": "building-room-requirements",
  "title": "房間需求條件",
  "title_en": "Room qualification rules",
  "category": "building",
  "source_category": "building",
  "tags": [
    "spatial",
    "planning",
    "information"
  ],
  "summary": "用围合空间和指定设施，把普通地块变成有功能的房间。",
  "note_status": "draft",
  "related": [
    "building-access-network",
    "building-service-coverage",
    "building-structural-support",
    "building-terrain-shaping"
  ],
  "sources": [
    {
      "title": "Room qualification rules — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/building-room-requirements/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「用围合空间和指定设施，把普通地块变成有功能的房间。」
出處：`sources/text/building-room-requirements.json` 字元 180-205 `summary.zh`
顯示：用圍合空間和指定設施，把普通地塊變成有功能的房間。

## 規則

「玩家围出空间、设置入口并放置设施。系统按面积、封闭状态和内容判定用途或资格；不达标时无法获得预期功能。」
出處：`sources/text/building-room-requirements.json` 字元 315-366 `rules.zh`
顯示：玩家圍出空間、設置入口並放置設施。系統按面積、封閉狀態和內容判定用途或資格；不達標時無法獲得預期功能。

## 核心循環

「查看要求」
出處：`sources/text/building-room-requirements.json` 字元 579-583 `loop[0].zh`

「围合并留入口」
出處：`sources/text/building-room-requirements.json` 字元 644-650 `loop[1].zh`
顯示：圍合併留入口

「配置设施」
出處：`sources/text/building-room-requirements.json` 字元 713-717 `loop[2].zh`
顯示：配置設施

「检查判定并修正」
出處：`sources/text/building-room-requirements.json` 字元 773-780 `loop[3].zh`
顯示：檢查判定並修正

## 玩家取捨

「紧凑布局便宜，却挤压后续扩容。」
出處：`sources/text/building-room-requirements.json` 字元 861-876 `decisions[0].zh`
顯示：緊湊佈局便宜，卻擠壓後續擴容。

「合用房间省空间，但可能改变识别用途。」
出處：`sources/text/building-room-requirements.json` 字元 968-986 `decisions[1].zh`
顯示：合用房間省空間，但可能改變識別用途。

## 可調參數

「规则透明度」
出處：`sources/text/building-room-requirements.json` 字元 1128-1133 `parameters[0].name.zh`
顯示：規則透明度

「显示缺失条件可减少盲目拆改。」
出處：`sources/text/building-room-requirements.json` 字元 1212-1226 `parameters[0].effect.zh`
顯示：顯示缺失條件可減少盲目拆改。

「资格梯度」
出處：`sources/text/building-room-requirements.json` 字元 1352-1356 `parameters[1].name.zh`
顯示：資格梯度

「二元达标容易理解，多级品质提供持续优化目标。」
出處：`sources/text/building-room-requirements.json` 字元 1437-1459 `parameters[1].effect.zh`
顯示：二元達標容易理解，多級品質提供持續優化目標。

## 原型

「做封闭区域识别、一个入口和两件必需家具，逐条显示达标条件。」
出處：`sources/text/building-room-requirements.json` 字元 2847-2876 `prototype.firstStep.zh`
顯示：做封閉區域識別、一個入口和兩件必需傢俱，逐條顯示達標條件。

「给一个只缺一项条件的房间，玩家能否凭提示修好，并理解原因？」
出處：`sources/text/building-room-requirements.json` 字元 3221-3250 `prototype.test.zh`
顯示：給一個只缺一項條件的房間，玩家能否憑提示修好，並理解原因？

「房间用途冲突、嵌套空间与多层识别会增加边界情况，先限定一个简单平面。」
出處：`sources/text/building-room-requirements.json` 字元 3041-3075 `prototype.pitfall.zh`
顯示：房間用途衝突、嵌套空間與多層識別會增加邊界情況，先限定一個簡單平面。

## 相關模式

- [進出網路](building-access-network.md)
- [服務覆蓋](building-service-coverage.md)
- [支撐約束與結構失效](building-structural-support.md)
- [地形塑形](building-terrain-shaping.md)

## 參考來源

- [Room qualification rules — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/building-room-requirements/) — 查閱：2026-11-02；取得方式：page-text。
