---
{
  "schema_version": 2,
  "id": "movement-carry-object",
  "title": "搬運物件",
  "title_en": "Move yourself and a carried object through obstacles",
  "category": "movement",
  "source_category": "movement",
  "tags": [
    "spatial",
    "planning",
    "precision"
  ],
  "summary": "自己能过去还不够，还要让手里的物件到达目的地。",
  "note_status": "draft",
  "related": [
    "exploration-air-action-refill",
    "exploration-climbing-rest-route",
    "exploration-gliding-descent",
    "movement-ledge-catch"
  ],
  "sources": [
    {
      "title": "Move yourself and a carried object through obstacles — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/movement-carry-object/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「自己能过去还不够，还要让手里的物件到达目的地。」
出處：`sources/text/movement-carry-object.json` 字元 211-234 `summary.zh`
顯示：自己能過去還不夠，還要讓手裏的物件到達目的地。

## 規則

「任务要求把场景中的实体物件送到指定位置，物件仍有自己的位置和碰撞。玩家可以抱着走、暂放或抛到另一侧，再让角色跟上；核心是规划人和物件的两条路线，而非比较背包总重量。」
出處：`sources/text/movement-carry-object.json` 字元 355-437 `rules.zh`
顯示：任務要求把場景中的實體物件送到指定位置，物件仍有自己的位置和碰撞。玩家可以抱着走、暫放或拋到另一側，再讓角色跟上；核心是規劃人和物件的兩條路線，而非比較揹包總重量。

## 核心循環

「观察物件目的地」
出處：`sources/text/movement-carry-object.json` 字元 719-726 `loop[0].zh`
顯示：觀察物件目的地

「规划人和物件的路线」
出處：`sources/text/movement-carry-object.json` 字元 799-808 `loop[1].zh`
顯示：規劃人和物件的路線

「携带、暂放或投递」
出處：`sources/text/movement-carry-object.json` 字元 868-876 `loop[2].zh`
顯示：攜帶、暫放或投遞

「重新会合并继续搬运」
出處：`sources/text/movement-carry-object.json` 字元 951-960 `loop[3].zh`
顯示：重新會合並繼續搬運

## 玩家取捨

「抱着物件走较远的安全路，还是先把它送过间隙再自己追上？」
出處：`sources/text/movement-carry-object.json` 字元 1053-1080 `decisions[0].zh`
顯示：抱着物件走較遠的安全路，還是先把它送過間隙再自己追上？

「把物件留在开关上能开门，但下一段是否还需要把它带走？」
出處：`sources/text/movement-carry-object.json` 字元 1194-1220 `decisions[1].zh`
顯示：把物件留在開關上能開門，但下一段是否還需要把它帶走？

## 可調參數

「持物时可做的动作」
出處：`sources/text/movement-carry-object.json` 字元 1390-1398 `parameters[0].name.zh`
顯示：持物時可做的動作

「保留全部动作更流畅，限制部分动作会让暂放与转移变得有意义。」
出處：`sources/text/movement-carry-object.json` 字元 1492-1521 `parameters[0].effect.zh`
顯示：保留全部動作更流暢，限制部分動作會讓暫放與轉移變得有意義。

「物件失落后的恢复」
出處：`sources/text/movement-carry-object.json` 字元 1689-1697 `parameters[1].name.zh`
顯示：物件失落後的恢復

「就近重置能保留解题节奏；长距离找回会把空间规划变成重复搬运。」
出處：`sources/text/movement-carry-object.json` 字元 1791-1821 `parameters[1].effect.zh`
顯示：就近重置能保留解題節奏；長距離找回會把空間規劃變成重複搬運。

## 原型

「在单屏中做一个可拾放方块、一个低台和一个终点按钮；再加入一次必须先送箱再移动角色的间隙。」
出處：`sources/text/movement-carry-object.json` 字元 3571-3615 `prototype.firstStep.zh`
顯示：在單屏中做一個可拾放方塊、一個低臺和一個終點按鈕；再加入一次必須先送箱再移動角色的間隙。

「检查玩家能否指出下一步先移动人还是物件，并且失败后不必重做已经理解的整段搬运。」
出處：`sources/text/movement-carry-object.json` 字元 4029-4068 `prototype.test.zh`
顯示：檢查玩家能否指出下一步先移動人還是物件，並且失敗後不必重做已經理解的整段搬運。

「物件卡进地形或掉到取不回的位置会制造无意义重开，需要明确的重置与防卡规则。」
出處：`sources/text/movement-carry-object.json` 字元 3818-3855 `prototype.pitfall.zh`
顯示：物件卡進地形或掉到取不回的位置會製造無意義重開，需要明確的重置與防卡規則。

## 相關模式

- [空中行動回補](exploration-air-action-refill.md)
- [攀爬休息點路線](exploration-climbing-rest-route.md)
- [滑翔下降](exploration-gliding-descent.md)
- [邊緣抓取](movement-ledge-catch.md)

## 參考來源

- [Move yourself and a carried object through obstacles — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/movement-carry-object/) — 查閱：2026-11-02；取得方式：page-text。
