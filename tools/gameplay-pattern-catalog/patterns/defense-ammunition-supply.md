---
{
  "schema_version": 2,
  "id": "defense-ammunition-supply",
  "title": "彈藥供給",
  "title_en": "Keep defensive guns supplied",
  "category": "defense",
  "source_category": "defense",
  "tags": [
    "planning",
    "economy",
    "optimization"
  ],
  "summary": "塔建好了还不算完成，子弹断供时，再强的防线也会停火。",
  "note_status": "draft",
  "related": [
    "defense-day-night-investment",
    "defense-maze-routing",
    "defense-target-priority",
    "defense-tower-upgrade-budget"
  ],
  "sources": [
    {
      "title": "Keep defensive guns supplied — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/defense-ammunition-supply/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「塔建好了还不算完成，子弹断供时，再强的防线也会停火。」
出處：`sources/text/defense-ammunition-supply.json` 字元 184-210 `summary.zh`
顯示：塔建好了還不算完成，子彈斷供時，再強的防線也會停火。

## 規則

「需要弹药的炮塔把库存转成攻击，玩家负责制造、运输和补充消耗品。敌人密集时消耗突然增加，供给路线和缓冲库存决定防线能坚持多久；弹药量、运输拥堵和停火直接反馈瓶颈。」
出處：`sources/text/defense-ammunition-supply.json` 字元 338-418 `rules.zh`
顯示：需要彈藥的炮塔把庫存轉成攻擊，玩家負責製造、運輸和補充消耗品。敵人密集時消耗突然增加，供給路線和緩衝庫存決定防線能堅持多久；彈藥量、運輸擁堵和停火直接反饋瓶頸。

## 核心循環

「估计敌袭的弹药需求」
出處：`sources/text/defense-ammunition-supply.json` 字元 720-729 `loop[0].zh`
顯示：估計敵襲的彈藥需求

「制造并送到炮塔」
出處：`sources/text/defense-ammunition-supply.json` 字元 799-806 `loop[1].zh`
顯示：製造並送到炮塔

「战斗中观察消耗与补给」
出處：`sources/text/defense-ammunition-supply.json` 字元 880-890 `loop[2].zh`
顯示：戰鬥中觀察消耗與補給

「补库存或修运输瓶颈」
出處：`sources/text/defense-ammunition-supply.json` 字元 969-978 `loop[3].zh`
顯示：補庫存或修運輸瓶頸

## 玩家取捨

「先多造一座塔，还是先保证现有塔不缺弹？更多枪口也会更快吃光库存。」
出處：`sources/text/defense-ammunition-supply.json` 字元 1088-1120 `decisions[0].zh`
顯示：先多造一座塔，還是先保證現有塔不缺彈？更多槍口也會更快喫光庫存。

「前线存很多弹药能扛突袭，但会占用本可扩产或升级的材料。」
出處：`sources/text/defense-ammunition-supply.json` 字元 1250-1277 `decisions[1].zh`
顯示：前線存很多彈藥能扛突襲，但會佔用本可擴產或升級的材料。

## 可調參數

「每次攻击耗弹量」
出處：`sources/text/defense-ammunition-supply.json` 字元 1476-1483 `parameters[0].name.zh`
顯示：每次攻擊耗彈量

「耗弹高会把持续防守变成物流问题；耗弹低时供应容易退化为开局步骤。」
出處：`sources/text/defense-ammunition-supply.json` 字元 1560-1592 `parameters[0].effect.zh`
顯示：耗彈高會把持續防守變成物流問題；耗彈低時供應容易退化爲開局步驟。

「炮塔缓冲容量」
出處：`sources/text/defense-ammunition-supply.json` 字元 1775-1781 `parameters[1].name.zh`
顯示：炮塔緩衝容量

「容量大能容忍短时断供；容量小则要求运输更加稳定。」
出處：`sources/text/defense-ammunition-supply.json` 字元 1865-1889 `parameters[1].effect.zh`
顯示：容量大能容忍短時斷供；容量小則要求運輸更加穩定。

## 原型

「先做一条抽象供给线、一个库存计数器和一座耗弹炮塔，不必先实现完整工厂。」
出處：`sources/text/defense-ammunition-supply.json` 字元 3473-3508 `prototype.firstStep.zh`
顯示：先做一條抽象供給線、一個庫存計數器和一座耗彈炮塔，不必先實現完整工廠。

「玩家是否能从库存变化发现持续亏空，并在停火前补救？」
出處：`sources/text/defense-ammunition-supply.json` 字元 3867-3892 `prototype.test.zh`
顯示：玩家是否能從庫存變化發現持續虧空，並在停火前補救？

「先把断供原因显示清楚，再添加多种弹药；否则玩家会分不清缺料与射程问题。」
出處：`sources/text/defense-ammunition-supply.json` 字元 3676-3711 `prototype.pitfall.zh`
顯示：先把斷供原因顯示清楚，再添加多種彈藥；否則玩家會分不清缺料與射程問題。

## 相關模式

- [日間夜間投入](defense-day-night-investment.md)
- [路徑路由](defense-maze-routing.md)
- [目標優先](defense-target-priority.md)
- [塔升級預算](defense-tower-upgrade-budget.md)

## 參考來源

- [Keep defensive guns supplied — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/defense-ammunition-supply/) — 查閱：2026-11-02；取得方式：page-text。
