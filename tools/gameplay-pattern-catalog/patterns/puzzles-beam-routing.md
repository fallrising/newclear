---
{
  "schema_version": 2,
  "id": "puzzles-beam-routing",
  "title": "光束路由",
  "title_en": "Routing beams to receivers",
  "category": "puzzles",
  "source_category": "puzzles",
  "tags": [
    "spatial",
    "optimization",
    "planning"
  ],
  "summary": "移动少量中继物，让整条能量路径成立。",
  "note_status": "draft",
  "related": [
    "automation-aerial-logistics",
    "automation-belt-routing",
    "automation-flow-splitting",
    "farming-irrigation-layout"
  ],
  "sources": [
    {
      "title": "Routing beams to receivers — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/puzzles-beam-routing/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「移动少量中继物，让整条能量路径成立。」
出處：`sources/text/puzzles-beam-routing.json` 字元 177-195 `summary.zh`
顯示：移動少量中繼物，讓整條能量路徑成立。

## 規則

「光束需要到达指定接收器才能打开通路。玩家调整中继、反射物或传送路径，避免遮挡，并检查多个接收器是否需要同时满足；可见光线让错误容易定位。」
出處：`sources/text/puzzles-beam-routing.json` 字元 285-353 `rules.zh`
顯示：光束需要到達指定接收器才能打開通路。玩家調整中繼、反射物或傳送路徑，避免遮擋，並檢查多個接收器是否需要同時滿足；可見光線讓錯誤容易定位。

## 核心循環

「定位光源与接收器」
出處：`sources/text/puzzles-beam-routing.json` 字元 583-591 `loop[0].zh`
顯示：定位光源與接收器

「摆放中继或反射物」
出處：`sources/text/puzzles-beam-routing.json` 字元 661-669 `loop[1].zh`
顯示：擺放中繼或反射物

「检查遮挡与连接」
出處：`sources/text/puzzles-beam-routing.json` 字元 739-746 `loop[2].zh`
顯示：檢查遮擋與連接

「通电后穿过通路」
出處：`sources/text/puzzles-beam-routing.json` 字元 815-822 `loop[3].zh`
顯示：通電後穿過通路

## 玩家取捨

「中继应靠近光源，还是能看到多个目标的交汇点？」
出處：`sources/text/puzzles-beam-routing.json` 字元 911-933 `decisions[0].zh`
顯示：中繼應靠近光源，還是能看到多個目標的交匯點？

「拿走中继后，门会不会把自己关住？」
出處：`sources/text/puzzles-beam-routing.json` 字元 1037-1053 `decisions[1].zh`
顯示：拿走中繼後，門會不會把自己關住？

## 可調參數

「同时目标数」
出處：`sources/text/puzzles-beam-routing.json` 字元 1183-1188 `parameters[0].name.zh`
顯示：同時目標數

「多目标同时开启要求网络规划；依次开启偏路线题。」
出處：`sources/text/puzzles-beam-routing.json` 字元 1270-1293 `parameters[0].effect.zh`
顯示：多目標同時開啓要求網絡規劃；依次開啓偏路線題。

「遮挡规则」
出處：`sources/text/puzzles-beam-routing.json` 字元 1432-1436 `parameters[1].name.zh`
顯示：遮擋規則

「角色可挡光会增加时机与协作；否则更偏静态推理。」
出處：`sources/text/puzzles-beam-routing.json` 字元 1507-1530 `parameters[1].effect.zh`
顯示：角色可擋光會增加時機與協作；否則更偏靜態推理。

## 原型

「在二维格子上实现一个光源、两个可旋转反射器与一个接收器。」
出處：`sources/text/puzzles-beam-routing.json` 字元 2928-2956 `prototype.firstStep.zh`
顯示：在二維格子上實現一個光源、兩個可旋轉反射器與一個接收器。

「光路断开时，玩家能否指出具体断点并只移动必要的物体。」
出處：`sources/text/puzzles-beam-routing.json` 字元 3257-3283 `prototype.test.zh`
顯示：光路斷開時，玩家能否指出具體斷點並只移動必要的物體。

「先别增加颜色混合与动态遮挡；基础光路必须能被一眼追踪。」
出處：`sources/text/puzzles-beam-routing.json` 字元 3084-3111 `prototype.pitfall.zh`
顯示：先別增加顏色混合與動態遮擋；基礎光路必須能被一眼追蹤。

## 相關模式

- [空中搬運物流](automation-aerial-logistics.md)
- [受限空間中的物流路由](automation-belt-routing.md)
- [流量分流](automation-flow-splitting.md)
- [灌溉配置](farming-irrigation-layout.md)

## 參考來源

- [Routing beams to receivers — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/puzzles-beam-routing/) — 查閱：2026-11-02；取得方式：page-text。
