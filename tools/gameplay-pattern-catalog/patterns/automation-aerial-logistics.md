---
{
  "schema_version": 2,
  "id": "automation-aerial-logistics",
  "title": "空中搬運物流",
  "title_en": "Autonomous aerial logistics",
  "category": "automation",
  "source_category": "automation",
  "tags": [
    "planning",
    "spatial",
    "optimization"
  ],
  "summary": "把重复搬运交给飞行单位，再围绕覆盖、能源和吞吐重新规划。",
  "note_status": "draft",
  "related": [
    "automation-belt-routing",
    "automation-flow-splitting",
    "automation-blueprint-reuse",
    "automation-byproduct-loop"
  ],
  "sources": [
    {
      "title": "Autonomous aerial logistics — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/automation-aerial-logistics/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把重复搬运交给飞行单位，再围绕覆盖、能源和吞吐重新规划。」
出處：`sources/text/automation-aerial-logistics.json` 字元 186-214 `summary.zh`
顯示：把重複搬運交給飛行單位，再圍繞覆蓋、能源和吞吐重新規劃。

## 規則

「玩家设置供给点、需求点与运输设施，让飞行单位搬运物品。覆盖或航线、充能和装卸能力限制效率；运输队列与缺货提示需要扩容的位置。」
出處：`sources/text/automation-aerial-logistics.json` 字元 342-404 `rules.zh`
顯示：玩家設置供給點、需求點與運輸設施，讓飛行單位搬運物品。覆蓋或航線、充能和裝卸能力限制效率；運輸隊列與缺貨提示需要擴容的位置。

## 核心循環

「建立供需端点」
出處：`sources/text/automation-aerial-logistics.json` 字元 651-657 `loop[0].zh`
顯示：建立供需端點

「部署飞行运力」
出處：`sources/text/automation-aerial-logistics.json` 字元 732-738 `loop[1].zh`
顯示：部署飛行運力

「补充能源」
出處：`sources/text/automation-aerial-logistics.json` 字元 805-809 `loop[2].zh`
顯示：補充能源

「观察拥堵并扩容」
出處：`sources/text/automation-aerial-logistics.json` 字元 867-874 `loop[3].zh`
顯示：觀察擁堵並擴容

## 玩家取捨

「飞行可以绕开地形，但长距离与频繁小批量可能拖低效率。」
出處：`sources/text/automation-aerial-logistics.json` 字元 964-990 `decisions[0].zh`
顯示：飛行可以繞開地形，但長距離與頻繁小批量可能拖低效率。

「集中枢纽易管理，分散节点更接近消费者。」
出處：`sources/text/automation-aerial-logistics.json` 字元 1119-1138 `decisions[1].zh`
顯示：集中樞紐易管理，分散節點更接近消費者。

## 可調參數

「单次载量」
出處：`sources/text/automation-aerial-logistics.json` 字元 1297-1301 `parameters[0].name.zh`
顯示：單次載量

「载量增大适合大宗运输，载量小会放大往返成本。」
出處：`sources/text/automation-aerial-logistics.json` 字元 1370-1392 `parameters[0].effect.zh`
顯示：載量增大適合大宗運輸，載量小會放大往返成本。

「补能约束」
出處：`sources/text/automation-aerial-logistics.json` 字元 1541-1545 `parameters[1].name.zh`
顯示：補能約束

「充能点稀疏会让节点位置比直线距离更关键。」
出處：`sources/text/automation-aerial-logistics.json` 字元 1624-1644 `parameters[1].effect.zh`
顯示：充能點稀疏會讓節點位置比直線距離更關鍵。

## 原型

「用地图节点、固定航程时间和一架带充电状态的运输机，先不用自由飞行寻路。」
出處：`sources/text/automation-aerial-logistics.json` 字元 3107-3142 `prototype.firstStep.zh`
顯示：用地圖節點、固定航程時間和一架帶充電狀態的運輸機，先不用自由飛行尋路。

「在远近需求同时出现时，玩家是否能通过改库存或线路减少缺货等待？」
出處：`sources/text/automation-aerial-logistics.json` 字元 3504-3535 `prototype.test.zh`
顯示：在遠近需求同時出現時，玩家是否能通過改庫存或線路減少缺貨等待？

「大量自主单位、碰撞和动态航线容易带来性能问题，先验证订单分配规则。」
出處：`sources/text/automation-aerial-logistics.json` 字元 3305-3338 `prototype.pitfall.zh`
顯示：大量自主單位、碰撞和動態航線容易帶來性能問題，先驗證訂單分配規則。

## 相關模式

- [受限空間中的物流路由](automation-belt-routing.md)
- [流量分流](automation-flow-splitting.md)
- [藍圖重用](automation-blueprint-reuse.md)
- [副產品循環](automation-byproduct-loop.md)

## 參考來源

- [Autonomous aerial logistics — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/automation-aerial-logistics/) — 查閱：2026-11-02；取得方式：page-text。
