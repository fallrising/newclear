---
{
  "schema_version": 2,
  "id": "movement-ledge-catch",
  "title": "邊緣抓取",
  "title_en": "Catch a ledge, then climb up or let go",
  "category": "movement",
  "source_category": "movement",
  "tags": [
    "spatial",
    "precision",
    "risk"
  ],
  "summary": "没跳到台面也能抓住边缘，把一次坠落变成新的选择。",
  "note_status": "draft",
  "related": [
    "exploration-climbing-rest-route",
    "movement-carry-object",
    "movement-downward-slam",
    "movement-run-walk-control"
  ],
  "sources": [
    {
      "title": "Catch a ledge, then climb up or let go — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/movement-ledge-catch/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「没跳到台面也能抓住边缘，把一次坠落变成新的选择。」
出處：`sources/text/movement-ledge-catch.json` 字元 195-219 `summary.zh`
顯示：沒跳到檯面也能抓住邊緣，把一次墜落變成新的選擇。

## 規則

「角色靠近可抓的台沿时进入悬挂状态，暂停直接下坠。玩家可以上翻、跳离或松手到下方；这条玩法关注边缘处的一次停顿与转移，不是沿整面墙持续消耗体力攀爬。」
出處：`sources/text/movement-ledge-catch.json` 字元 340-413 `rules.zh`
顯示：角色靠近可抓的臺沿時進入懸掛狀態，暫停直接下墜。玩家可以上翻、跳離或鬆手到下方；這條玩法關注邊緣處的一次停頓與轉移，不是沿整面牆持續消耗體力攀爬。

## 核心循環

「朝可抓台沿移动」
出處：`sources/text/movement-ledge-catch.json` 字元 697-704 `loop[0].zh`
顯示：朝可抓臺沿移動

「抓住并稳定位置」
出處：`sources/text/movement-ledge-catch.json` 字元 772-779 `loop[1].zh`
顯示：抓住並穩定位置

「观察台上与下方」
出處：`sources/text/movement-ledge-catch.json` 字元 842-849 `loop[2].zh`
顯示：觀察臺上與下方

「上翻、跳离或松手」
出處：`sources/text/movement-ledge-catch.json` 字元 914-922 `loop[3].zh`
顯示：上翻、跳離或鬆手

## 玩家取捨

「台上有危险，是马上上翻，还是先挂住观察？」
出處：`sources/text/movement-ledge-catch.json` 字元 1014-1034 `decisions[0].zh`
顯示：臺上有危險，是馬上上翻，還是先掛住觀察？

「下方有较低落点，松手绕行是否比继续往上更稳？」
出處：`sources/text/movement-ledge-catch.json` 字元 1145-1167 `decisions[1].zh`
顯示：下方有較低落點，鬆手繞行是否比繼續往上更穩？

## 可調參數

「抓边判定宽容度」
出處：`sources/text/movement-ledge-catch.json` 字元 1336-1343 `parameters[0].name.zh`
顯示：抓邊判定寬容度

「更宽的判定能挽救差一点的跳跃；过宽会让距离判断失去意义。」
出處：`sources/text/movement-ledge-catch.json` 字元 1420-1448 `parameters[0].effect.zh`
顯示：更寬的判定能挽救差一點的跳躍；過寬會讓距離判斷失去意義。

「悬挂后的可用动作」
出處：`sources/text/movement-ledge-catch.json` 字元 1602-1610 `parameters[1].name.zh`
顯示：懸掛後的可用動作

「只允许上翻会减少选择；加入松手或跳离可以形成向上与向下的路线。」
出處：`sources/text/movement-ledge-catch.json` 字元 1693-1724 `parameters[1].effect.zh`
顯示：只允許上翻會減少選擇；加入鬆手或跳離可以形成向上與向下的路線。

## 原型

「制作三个高度不同的台沿，只做接近抓边、上翻和松手三种状态，给出明确的可抓边缘样式。」
出處：`sources/text/movement-ledge-catch.json` 字元 3326-3367 `prototype.firstStep.zh`
顯示：製作三個高度不同的臺沿，只做接近抓邊、上翻和鬆手三種狀態，給出明確的可抓邊緣樣式。

「让玩家先上台再下到低层，检查是否能主动使用松手，而不是反复跳离边缘碰运气。」
出處：`sources/text/movement-ledge-catch.json` 字元 3736-3773 `prototype.test.zh`
顯示：讓玩家先上臺再下到低層，檢查是否能主動使用鬆手，而不是反覆跳離邊緣碰運氣。

「自动抓边如果发生在玩家想下落时，会像输入失灵；需要明确的松手与禁止抓取条件。」
出處：`sources/text/movement-ledge-catch.json` 字元 3536-3574 `prototype.pitfall.zh`
顯示：自動抓邊如果發生在玩家想下落時，會像輸入失靈；需要明確的鬆手與禁止抓取條件。

## 相關模式

- [攀爬休息點路線](exploration-climbing-rest-route.md)
- [搬運物件](movement-carry-object.md)
- [承諾一次下砸](movement-downward-slam.md)
- [奔跑與行走的距離控制](movement-run-walk-control.md)

## 參考來源

- [Catch a ledge, then climb up or let go — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/movement-ledge-catch/) — 查閱：2026-11-02；取得方式：page-text。
