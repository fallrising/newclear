---
{
  "schema_version": 2,
  "id": "cooking-station-handoff",
  "title": "工作站交接",
  "title_en": "Kitchen station handoffs",
  "category": "cooking",
  "source_category": "cooking",
  "tags": [
    "cooperation",
    "spatial",
    "optimization"
  ],
  "summary": "把半成品交到对的人手里，比每个人各做一道菜更有效。",
  "note_status": "draft",
  "related": [
    "cooking-preparation-chain",
    "automation-aerial-logistics",
    "automation-belt-routing",
    "automation-flow-splitting"
  ],
  "sources": [
    {
      "title": "Kitchen station handoffs — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooking-station-handoff/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把半成品交到对的人手里，比每个人各做一道菜更有效。」
出處：`sources/text/cooking-station-handoff.json` 字元 176-201 `summary.zh`
顯示：把半成品交到對的人手裏，比每個人各做一道菜更有效。

## 規則

「厨师共享空间和工作站，角色可按备料、加热、送餐分工。半成品需要明确交接；阻塞的台面、错放的材料和同时抢设备会制造拥堵。」
出處：`sources/text/cooking-station-handoff.json` 字元 314-373 `rules.zh`
顯示：廚師共享空間和工作站，角色可按備料、加熱、送餐分工。半成品需要明確交接；阻塞的檯面、錯放的材料和同時搶設備會製造擁堵。

## 核心循環

「分配岗位」
出處：`sources/text/cooking-station-handoff.json` 字元 619-623 `loop[0].zh`
顯示：分配崗位

「准备交接物」
出處：`sources/text/cooking-station-handoff.json` 字元 682-687 `loop[1].zh`
顯示：準備交接物

「传递或放到缓冲位」
出處：`sources/text/cooking-station-handoff.json` 字元 753-761 `loop[2].zh`
顯示：傳遞或放到緩衝位

「确认接收并补位」
出處：`sources/text/cooking-station-handoff.json` 字元 828-835 `loop[3].zh`
顯示：確認接收並補位

## 玩家取捨

「固定岗位减少沟通，还是随瓶颈临时换班？」
出處：`sources/text/cooking-station-handoff.json` 字元 930-949 `decisions[0].zh`
顯示：固定崗位減少溝通，還是隨瓶頸臨時換班？

「用最短路线抢道，还是绕路保持其他人的流量？」
出處：`sources/text/cooking-station-handoff.json` 字元 1045-1066 `decisions[1].zh`
顯示：用最短路線搶道，還是繞路保持其他人的流量？

## 可調參數

「通道宽度」
出處：`sources/text/cooking-station-handoff.json` 字元 1208-1212 `parameters[0].name.zh`
顯示：通道寬度

「窄路强化协调，也容易把错误放大为互相阻挡。」
出處：`sources/text/cooking-station-handoff.json` 字元 1284-1305 `parameters[0].effect.zh`
顯示：窄路強化協調，也容易把錯誤放大爲互相阻擋。

「交接距离」
出處：`sources/text/cooking-station-handoff.json` 字元 1434-1438 `parameters[1].name.zh`
顯示：交接距離

「可投掷能跨越障碍；只能贴身传递更依赖布局。」
出處：`sources/text/cooking-station-handoff.json` 字元 1513-1534 `parameters[1].effect.zh`
顯示：可投擲能跨越障礙；只能貼身傳遞更依賴佈局。

## 原型

「先做同屏双人、两个岗位和一个交接格；只验证传递与堵塞，不加入联网。」
出處：`sources/text/cooking-station-handoff.json` 字元 3024-3057 `prototype.firstStep.zh`
顯示：先做同屏雙人、兩個崗位和一個交接格；只驗證傳遞與堵塞，不加入聯網。

「观察两人是否主动约定交接位置，并在某岗位积压时调整分工。」
出處：`sources/text/cooking-station-handoff.json` 字元 3401-3429 `prototype.test.zh`
顯示：觀察兩人是否主動約定交接位置，並在某崗位積壓時調整分工。

「联网同步、自由物理碰撞和大量菜谱会同时扩大范围，应与岗位协作分开验证。」
出處：`sources/text/cooking-station-handoff.json` 字元 3222-3257 `prototype.pitfall.zh`
顯示：聯網同步、自由物理碰撞和大量菜譜會同時擴大範圍，應與崗位協作分開驗證。

## 相關模式

- [備料連鎖](cooking-preparation-chain.md)
- [空中搬運物流](automation-aerial-logistics.md)
- [受限空間中的物流路由](automation-belt-routing.md)
- [流量分流](automation-flow-splitting.md)

## 參考來源

- [Kitchen station handoffs — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooking-station-handoff/) — 查閱：2026-11-02；取得方式：page-text。
