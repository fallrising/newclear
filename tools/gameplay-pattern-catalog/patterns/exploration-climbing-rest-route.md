---
{
  "schema_version": 2,
  "id": "exploration-climbing-rest-route",
  "title": "攀爬休息點路線",
  "title_en": "Climbing stamina and rest routes",
  "category": "movement",
  "source_category": "movement",
  "tags": [
    "planning",
    "risk",
    "spatial"
  ],
  "summary": "把看似连续的墙面，拆成一段段可承受的攀登。",
  "note_status": "draft",
  "related": [
    "exploration-air-action-refill",
    "exploration-gliding-descent",
    "movement-carry-object",
    "movement-downward-slam"
  ],
  "sources": [
    {
      "title": "Climbing stamina and rest routes — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/exploration-climbing-rest-route/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把看似连续的墙面，拆成一段段可承受的攀登。」
出處：`sources/text/exploration-climbing-rest-route.json` 字元 196-217 `summary.zh`
顯示：把看似連續的牆面，拆成一段段可承受的攀登。

## 規則

「攀爬消耗体力，玩家需要选择抓点、休息处和返回路线。到达平台恢复能力后继续上升；过长的路线会导致跌落或被保险绳接住，失败惩罚依作品而定。」
出處：`sources/text/exploration-climbing-rest-route.json` 字元 323-390 `rules.zh`
顯示：攀爬消耗體力，玩家需要選擇抓點、休息處和返回路線。到達平臺恢復能力後繼續上升；過長的路線會導致跌落或被保險繩接住，失敗懲罰依作品而定。

## 核心循環

「观察下一处休息点」
出處：`sources/text/exploration-climbing-rest-route.json` 字元 644-652 `loop[0].zh`
顯示：觀察下一處休息點

「估算体力与路线」
出處：`sources/text/exploration-climbing-rest-route.json` 字元 720-727 `loop[1].zh`
顯示：估算體力與路線

「连续攀爬」
出處：`sources/text/exploration-climbing-rest-route.json` 字元 797-801 `loop[2].zh`
顯示：連續攀爬

「休息或回撤调整」
出處：`sources/text/exploration-climbing-rest-route.json` 字元 862-869 `loop[3].zh`
顯示：休息或回撤調整

## 玩家取捨

「垂直直上更短，却可能找不到中途歇脚点。」
出處：`sources/text/exploration-climbing-rest-route.json` 字元 960-979 `decisions[0].zh`
顯示：垂直直上更短，卻可能找不到中途歇腳點。

「绕路先拿体力升级，可以把难路线变成可行路线。」
出處：`sources/text/exploration-climbing-rest-route.json` 字元 1081-1103 `decisions[1].zh`
顯示：繞路先拿體力升級，可以把難路線變成可行路線。

## 可調參數

「静止是否耗体力」
出處：`sources/text/exploration-climbing-rest-route.json` 字元 1267-1274 `parameters[0].name.zh`
顯示：靜止是否耗體力

「停住不耗体力允许观察，持续消耗会增加即时压力。」
出處：`sources/text/exploration-climbing-rest-route.json` 字元 1357-1380 `parameters[0].effect.zh`
顯示：停住不耗體力允許觀察，持續消耗會增加即時壓力。

「跌落保护」
出處：`sources/text/exploration-climbing-rest-route.json` 字元 1513-1517 `parameters[1].name.zh`
顯示：跌落保護

「保险绳降低重复爬升负担，可把挑战集中在路线判断。」
出處：`sources/text/exploration-climbing-rest-route.json` 字元 1594-1618 `parameters[1].effect.zh`
顯示：保險繩降低重複爬升負擔，可把挑戰集中在路線判斷。

## 原型

「用二维墙面、固定体力消耗和三个休息台验证路线选择。」
出處：`sources/text/exploration-climbing-rest-route.json` 字元 3075-3100 `prototype.firstStep.zh`
顯示：用二維牆面、固定體力消耗和三個休息臺驗證路線選擇。

「让玩家在两条路线间选择，检查他们是否真的把休息点纳入计划。」
出處：`sources/text/exploration-climbing-rest-route.json` 字元 3403-3432 `prototype.test.zh`
顯示：讓玩家在兩條路線間選擇，檢查他們是否真的把休息點納入計劃。

「自由攀爬动画、任意表面识别和保险绳物理会迅速扩大范围。」
出處：`sources/text/exploration-climbing-rest-route.json` 字元 3232-3259 `prototype.pitfall.zh`
顯示：自由攀爬動畫、任意表面識別和保險繩物理會迅速擴大範圍。

## 相關模式

- [空中行動回補](exploration-air-action-refill.md)
- [滑翔下降](exploration-gliding-descent.md)
- [搬運物件](movement-carry-object.md)
- [承諾一次下砸](movement-downward-slam.md)

## 參考來源

- [Climbing stamina and rest routes — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/exploration-climbing-rest-route/) — 查閱：2026-11-02；取得方式：page-text。
