---
{
  "schema_version": 2,
  "id": "automation-belt-routing",
  "title": "受限空間中的物流路由",
  "title_en": "Conveyor routing",
  "category": "automation",
  "source_category": "automation",
  "tags": [
    "flow-network",
    "throughput",
    "spatial-planning"
  ],
  "summary": "让物料绕过障碍、穿过交叉点，持续抵达机器入口。",
  "note_status": "draft",
  "related": [
    "building-structural-support",
    "farming-growth-care"
  ],
  "sources": [
    {
      "title": "Conveyor routing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/automation-belt-routing/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「让物料绕过障碍、穿过交叉点，持续抵达机器入口。」
出處：`sources/text/automation-belt-routing.json` 字元 172-195 `summary.zh`
顯示：讓物料繞過障礙、穿過交叉點，持續抵達機器入口。

## 規則

「玩家铺设有方向的运输带，把生产端连接到消费端。占地、交叉方式和吞吐上限限制路线；断料与积压直接显示设计是否有效。」
出處：`sources/text/automation-belt-routing.json` 字元 320-376 `rules.zh`
顯示：玩家鋪設有方向的運輸帶，把生產端連接到消費端。佔地、交叉方式和吞吐上限限制路線；斷料與積壓直接顯示設計是否有效。

## 核心循環

「确定起终点」
出處：`sources/text/automation-belt-routing.json` 字元 586-591 `loop[0].zh`
顯示：確定起終點

「选择绕行或跨越」
出處：`sources/text/automation-belt-routing.json` 字元 653-660 `loop[1].zh`
顯示：選擇繞行或跨越

「铺带并供料」
出處：`sources/text/automation-belt-routing.json` 字元 731-736 `loop[2].zh`
顯示：鋪帶並供料

「观察堵点再改线」
出處：`sources/text/automation-belt-routing.json` 字元 800-807 `loop[3].zh`
顯示：觀察堵點再改線

## 玩家取捨

「短路线省空间，但可能堵住未来扩建。」
出處：`sources/text/automation-belt-routing.json` 字元 898-915 `decisions[0].zh`
顯示：短路線省空間，但可能堵住未來擴建。

「专线更易诊断，混线减少铺设量却更难管理。」
出處：`sources/text/automation-belt-routing.json` 字元 1009-1029 `decisions[1].zh`
顯示：專線更易診斷，混線減少鋪設量卻更難管理。

## 可調參數

「交叉自由度」
出處：`sources/text/automation-belt-routing.json` 字元 1196-1201 `parameters[0].name.zh`

「增加高架或地下通道，难点从避障转向吞吐规划。」
出處：`sources/text/automation-belt-routing.json` 字元 1279-1301 `parameters[0].effect.zh`
顯示：增加高架或地下通道，難點從避障轉向吞吐規劃。

「单带容量」
出處：`sources/text/automation-belt-routing.json` 字元 1461-1465 `parameters[1].name.zh`
顯示：單帶容量

「较低容量促使并行扩线，较高容量允许集中主干。」
出處：`sources/text/automation-belt-routing.json` 字元 1540-1562 `parameters[1].effect.zh`
顯示：較低容量促使並行擴線，較高容量允許集中主幹。

## 原型

「做小网格、一个物料源、一个接收器和有方向的带格，物料用点表示即可。」
出處：`sources/text/automation-belt-routing.json` 字元 3009-3042 `prototype.firstStep.zh`
顯示：做小網格、一個物料源、一個接收器和有方向的帶格，物料用點表示即可。

「让玩家修一条只有一处反向的线路，观察他能否通过积压位置找到问题。」
出處：`sources/text/automation-belt-routing.json` 字元 3384-3416 `prototype.test.zh`
顯示：讓玩家修一條只有一處反向的線路，觀察他能否通過積壓位置找到問題。

「先验证方向与堵塞，再加多层运输和复杂交叉，否则很难查出断料原因。」
出處：`sources/text/automation-belt-routing.json` 字元 3189-3221 `prototype.pitfall.zh`
顯示：先驗證方向與堵塞，再加多層運輸和複雜交叉，否則很難查出斷料原因。

## 相關模式

- [支撐約束與結構失效](building-structural-support.md)
- [照料排程與延遲收成](farming-growth-care.md)

## 參考來源

- [Conveyor routing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/automation-belt-routing/) — 查閱：2026-11-02；取得方式：page-text。
