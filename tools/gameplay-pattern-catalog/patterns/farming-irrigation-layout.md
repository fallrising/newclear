---
{
  "schema_version": 2,
  "id": "farming-irrigation-layout",
  "title": "灌溉配置",
  "title_en": "Irrigation coverage",
  "category": "farming",
  "source_category": "farming",
  "tags": [
    "spatial",
    "optimization",
    "planning"
  ],
  "summary": "用占地与建造成本，交换重复浇水的时间。",
  "note_status": "draft",
  "related": [
    "automation-aerial-logistics",
    "automation-belt-routing",
    "automation-flow-splitting",
    "building-access-network"
  ],
  "sources": [
    {
      "title": "Irrigation coverage — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/farming-irrigation-layout/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「用占地与建造成本，交换重复浇水的时间。」
出處：`sources/text/farming-irrigation-layout.json` 字元 173-192 `summary.zh`
顯示：用佔地與建造成本，交換重複澆水的時間。

## 規則

「玩家把灌溉装置放入田地，让覆盖范围内的作物自动得到水。装置本身占位，覆盖形状与供水条件形成布局约束；漏水地块会暴露设计中的空隙。」
出處：`sources/text/farming-irrigation-layout.json` 字元 303-367 `rules.zh`
顯示：玩家把灌溉裝置放入田地，讓覆蓋範圍內的作物自動得到水。裝置本身佔位，覆蓋形狀與供水條件形成佈局約束；漏水地塊會暴露設計中的空隙。

## 核心循環

「标出种植范围」
出處：`sources/text/farming-irrigation-layout.json` 字元 586-592 `loop[0].zh`
顯示：標出種植範圍

「放置灌溉与供水设施」
出處：`sources/text/farming-irrigation-layout.json` 字元 654-663 `loop[1].zh`
顯示：放置灌溉與供水設施

「检查边角覆盖」
出處：`sources/text/farming-irrigation-layout.json` 字元 740-746 `loop[2].zh`
顯示：檢查邊角覆蓋

「扩田并重排装置」
出處：`sources/text/farming-irrigation-layout.json` 字元 809-816 `loop[3].zh`
顯示：擴田並重排裝置

## 玩家取捨

「最大种植密度不一定便于收获，必须留出通路。」
出處：`sources/text/farming-irrigation-layout.json` 字元 901-922 `decisions[0].zh`
顯示：最大種植密度不一定便於收穫，必須留出通路。

「先覆盖已有地块还是为扩张预留管线，决定短期与长期成本。」
出處：`sources/text/farming-irrigation-layout.json` 字元 1037-1064 `decisions[1].zh`
顯示：先覆蓋已有地塊還是爲擴張預留管線，決定短期與長期成本。

## 可調參數

「覆盖形状」
出處：`sources/text/farming-irrigation-layout.json` 字元 1237-1241 `parameters[0].name.zh`
顯示：覆蓋形狀

「十字、方形与圆形会产生不同的留白和拼接问题。」
出處：`sources/text/farming-irrigation-layout.json` 字元 1317-1339 `parameters[0].effect.zh`
顯示：十字、方形與圓形會產生不同的留白和拼接問題。

「供水依赖」
出處：`sources/text/farming-irrigation-layout.json` 字元 1489-1493 `parameters[1].name.zh`
顯示：供水依賴

「加入水源或水箱后，单点摆放升级为网络规划。」
出處：`sources/text/farming-irrigation-layout.json` 字元 1572-1593 `parameters[1].effect.zh`
顯示：加入水源或水箱後，單點擺放升級爲網絡規劃。

## 原型

「做固定网格、一种十字覆盖喷头和干湿两种地块状态，实时显示遗漏数。」
出處：`sources/text/farming-irrigation-layout.json` 字元 2987-3019 `prototype.firstStep.zh`
顯示：做固定網格、一種十字覆蓋噴頭和乾溼兩種地塊狀態，實時顯示遺漏數。

「给相同数量的喷头，观察玩家能否改位置减少手浇，而不是只能继续买设备。」
出處：`sources/text/farming-irrigation-layout.json` 字元 3367-3401 `prototype.test.zh`
顯示：給相同數量的噴頭，觀察玩家能否改位置減少手澆，而不是隻能繼續買設備。

「水压、地下管线与可旋转喷头会增加另一套规则，可在布局本身好玩后再加。」
出處：`sources/text/farming-irrigation-layout.json` 字元 3172-3206 `prototype.pitfall.zh`
顯示：水壓、地下管線與可旋轉噴頭會增加另一套規則，可在佈局本身好玩後再加。

## 相關模式

- [空中搬運物流](automation-aerial-logistics.md)
- [受限空間中的物流路由](automation-belt-routing.md)
- [流量分流](automation-flow-splitting.md)
- [進出網路](building-access-network.md)

## 參考來源

- [Irrigation coverage — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/farming-irrigation-layout/) — 查閱：2026-11-02；取得方式：page-text。
