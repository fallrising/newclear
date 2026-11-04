---
{
  "schema_version": 2,
  "id": "building-access-network",
  "title": "進出網路",
  "title_en": "Road and entrance connectivity",
  "category": "building",
  "source_category": "building",
  "tags": [
    "spatial",
    "planning",
    "optimization"
  ],
  "summary": "建筑摆下去不等于能工作，还要让人和货到达入口。",
  "note_status": "draft",
  "related": [
    "building-service-coverage",
    "automation-aerial-logistics",
    "automation-belt-routing",
    "automation-flow-splitting"
  ],
  "sources": [
    {
      "title": "Road and entrance connectivity — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/building-access-network/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「建筑摆下去不等于能工作，还要让人和货到达入口。」
出處：`sources/text/building-access-network.json` 字元 184-207 `summary.zh`
顯示：建築擺下去不等於能工作，還要讓人和貨到達入口。

## 規則

「玩家把建筑入口接入道路或步行网络。断路、朝向和绕行距离影响使用；观察不可达提示与移动路线后重新布局。」
出處：`sources/text/building-access-network.json` 字元 314-364 `rules.zh`
顯示：玩家把建築入口接入道路或步行網絡。斷路、朝向和繞行距離影響使用；觀察不可達提示與移動路線後重新佈局。

## 核心循環

「确认入口」
出處：`sources/text/building-access-network.json` 字元 562-566 `loop[0].zh`
顯示：確認入口

「接入主路径」
出處：`sources/text/building-access-network.json` 字元 625-630 `loop[1].zh`
顯示：接入主路徑

「检查可达性」
出處：`sources/text/building-access-network.json` 字元 692-697 `loop[2].zh`
顯示：檢查可達性

「缩短高频行程」
出處：`sources/text/building-access-network.json` 字元 754-760 `loop[3].zh`
顯示：縮短高頻行程

## 玩家取捨

「密集地块能多放建筑，却容易绕行。」
出處：`sources/text/building-access-network.json` 字元 847-863 `decisions[0].zh`
顯示：密集地塊能多放建築，卻容易繞行。

「多开道路增加连通性，也挤占生产空间。」
出處：`sources/text/building-access-network.json` 字元 957-975 `decisions[1].zh`
顯示：多開道路增加連通性，也擠佔生產空間。

## 可調參數

「路径成本」
出處：`sources/text/building-access-network.json` 字元 1122-1126 `parameters[0].name.zh`
顯示：路徑成本

「移动越耗时，近邻选址越重要。」
出處：`sources/text/building-access-network.json` 字元 1199-1213 `parameters[0].effect.zh`
顯示：移動越耗時，近鄰選址越重要。

「入口数量」
出處：`sources/text/building-access-network.json` 字元 1334-1338 `parameters[1].name.zh`
顯示：入口數量

「多入口减少死角，单入口强调朝向。」
出處：`sources/text/building-access-network.json` 字元 1414-1430 `parameters[1].effect.zh`
顯示：多入口減少死角，單入口強調朝向。

## 原型

「做小网格寻路、两个带入口的建筑和一名搬运者，同时显示路径长度。」
出處：`sources/text/building-access-network.json` 字元 2839-2870 `prototype.firstStep.zh`
顯示：做小網格尋路、兩個帶入口的建築和一名搬運者，同時顯示路徑長度。

「玩家能否区分直线距离与真实路线，并通过改入口减少搬运时间？」
出處：`sources/text/building-access-network.json` 字元 3205-3234 `prototype.test.zh`
顯示：玩家能否區分直線距離與真實路線，並通過改入口減少搬運時間？

「大量单位避让与复杂交通可以另做；先验证入口和道路断开时的反馈。」
出處：`sources/text/building-access-network.json` 字元 3023-3054 `prototype.pitfall.zh`
顯示：大量單位避讓與複雜交通可以另做；先驗證入口和道路斷開時的反饋。

## 相關模式

- [服務覆蓋](building-service-coverage.md)
- [空中搬運物流](automation-aerial-logistics.md)
- [受限空間中的物流路由](automation-belt-routing.md)
- [流量分流](automation-flow-splitting.md)

## 參考來源

- [Road and entrance connectivity — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/building-access-network/) — 查閱：2026-11-02；取得方式：page-text。
