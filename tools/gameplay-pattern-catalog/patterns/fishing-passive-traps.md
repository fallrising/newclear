---
{
  "schema_version": 2,
  "id": "fishing-passive-traps",
  "title": "被動陷阱組",
  "title_en": "Passive fishing traps",
  "category": "fishing",
  "source_category": "fishing",
  "tags": [
    "planning",
    "time",
    "optimization"
  ],
  "summary": "把即时操作换成选点、等待与回收路线。",
  "note_status": "draft",
  "related": [
    "fishing-timed-contest",
    "automation-aerial-logistics",
    "automation-belt-routing",
    "automation-blueprint-reuse"
  ],
  "sources": [
    {
      "title": "Passive fishing traps — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/fishing-passive-traps/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把即时操作换成选点、等待与回收路线。」
出處：`sources/text/fishing-passive-traps.json` 字元 171-189 `summary.zh`
顯示：把即時操作換成選點、等待與回收路線。

## 規則

「玩家把捕捞装置放进水域，在离开期间积累渔获，再回来收取、补充或维修。装置数量与维护成本限制规模；收益取决于布点环境和回访频率。」
出處：`sources/text/fishing-passive-traps.json` 字元 313-376 `rules.zh`
顯示：玩家把捕撈裝置放進水域，在離開期間積累漁獲，再回來收取、補充或維修。裝置數量與維護成本限制規模；收益取決於布點環境和回訪頻率。

## 核心循環

「选择投放水域」
出處：`sources/text/fishing-passive-traps.json` 字元 606-612 `loop[0].zh`
顯示：選擇投放水域

「布置装置并满足启动条件」
出處：`sources/text/fishing-passive-traps.json` 字元 679-690 `loop[1].zh`
顯示：佈置裝置並滿足啓動條件

「完成其他活动」
出處：`sources/text/fishing-passive-traps.json` 字元 758-764 `loop[2].zh`
顯示：完成其他活動

「回收渔获并维护」
出處：`sources/text/fishing-passive-traps.json` 字元 827-834 `loop[3].zh`
顯示：回收漁獲並維護

## 玩家取捨

「高收益远点是否值得绕路，要按整条回收路线计算。」
出處：`sources/text/fishing-passive-traps.json` 字元 927-950 `decisions[0].zh`
顯示：高收益遠點是否值得繞路，要按整條回收路線計算。

「放太多陷阱可能把休闲副业变成每日维护工作。」
出處：`sources/text/fishing-passive-traps.json` 字元 1067-1088 `decisions[1].zh`
顯示：放太多陷阱可能把休閒副業變成每日維護工作。

## 可調參數

「容量上限」
出處：`sources/text/fishing-passive-traps.json` 字元 1240-1244 `parameters[0].name.zh`

「低容量推动高频回访，高容量允许长途探索。」
出處：`sources/text/fishing-passive-traps.json` 字元 1320-1340 `parameters[0].effect.zh`
顯示：低容量推動高頻回訪，高容量允許長途探索。

「维护方式」
出處：`sources/text/fishing-passive-traps.json` 字元 1494-1498 `parameters[1].name.zh`
顯示：維護方式

「补饵消耗资源，维修制造停机，二者会形成不同节奏。」
出處：`sources/text/fishing-passive-traps.json` 字元 1576-1600 `parameters[1].effect.zh`
顯示：補餌消耗資源，維修製造停機，二者會形成不同節奏。

## 原型

「用地图上的3个点、固定往返时间和捕笼库存计时，测试布点与回收安排。」
出處：`sources/text/fishing-passive-traps.json` 字元 3015-3048 `prototype.firstStep.zh`
顯示：用地圖上的3個點、固定往返時間和捕籠庫存計時，測試布點與回收安排。

「玩家是否按总路程重新分布捕笼，而不只盯着单个点的最高产量？」
出處：`sources/text/fishing-passive-traps.json` 字元 3395-3424 `prototype.test.zh`
顯示：玩家是否按總路程重新分佈捕籠，而不只盯着單個點的最高產量？

「过多强制日常维护会把自主规划变成打卡；先检查回访频率是否有弹性。」
出處：`sources/text/fishing-passive-traps.json` 字元 3202-3234 `prototype.pitfall.zh`
顯示：過多強制日常維護會把自主規劃變成打卡；先檢查回訪頻率是否有彈性。

## 相關模式

- [限時競賽](fishing-timed-contest.md)
- [空中搬運物流](automation-aerial-logistics.md)
- [受限空間中的物流路由](automation-belt-routing.md)
- [藍圖重用](automation-blueprint-reuse.md)

## 參考來源

- [Passive fishing traps — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/fishing-passive-traps/) — 查閱：2026-11-02；取得方式：page-text。
