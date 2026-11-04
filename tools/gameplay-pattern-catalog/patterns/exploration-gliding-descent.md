---
{
  "schema_version": 2,
  "id": "exploration-gliding-descent",
  "title": "滑翔下降",
  "title_en": "Gliding and landing choice",
  "category": "movement",
  "source_category": "movement",
  "tags": [
    "spatial",
    "planning",
    "discovery"
  ],
  "summary": "把高度兑换成水平距离，并在途中寻找续航机会。",
  "note_status": "draft",
  "related": [
    "exploration-air-action-refill",
    "exploration-climbing-rest-route",
    "movement-carry-object",
    "movement-moving-platform"
  ],
  "sources": [
    {
      "title": "Gliding and landing choice — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/exploration-gliding-descent/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把高度兑换成水平距离，并在途中寻找续航机会。」
出處：`sources/text/exploration-gliding-descent.json` 字元 184-206 `summary.zh`
顯示：把高度兌換成水平距離，並在途中尋找續航機會。

## 規則

「从高处展开滑翔或缓降能力，控制方向并预测落点。高度通常会逐渐损失，有些作品加入体力与上升气流；玩家需要在路线长度、目标高度和补给点之间取舍。」
出處：`sources/text/exploration-gliding-descent.json` 字元 322-392 `rules.zh`
顯示：從高處展開滑翔或緩降能力，控制方向並預測落點。高度通常會逐漸損失，有些作品加入體力與上升氣流；玩家需要在路線長度、目標高度和補給點之間取捨。

## 核心循環

「选择起跳高点」
出處：`sources/text/exploration-gliding-descent.json` 字元 658-664 `loop[0].zh`
顯示：選擇起跳高點

「展开滑翔」
出處：`sources/text/exploration-gliding-descent.json` 字元 730-734 `loop[1].zh`
顯示：展開滑翔

「修正方向或借上升气流」
出處：`sources/text/exploration-gliding-descent.json` 字元 794-804 `loop[2].zh`
顯示：修正方向或借上升氣流

「安全落地继续探索」
出處：`sources/text/exploration-gliding-descent.json` 字元 873-881 `loop[3].zh`
顯示：安全落地繼續探索

## 玩家取捨

「直接飞向目标，还是绕到能延长航程的气流？」
出處：`sources/text/exploration-gliding-descent.json` 字元 970-990 `decisions[0].zh`
顯示：直接飛向目標，還是繞到能延長航程的氣流？

「更高起点能延长距离，但爬上去本身也有成本。」
出處：`sources/text/exploration-gliding-descent.json` 字元 1090-1111 `decisions[1].zh`
顯示：更高起點能延長距離，但爬上去本身也有成本。

## 可調參數

「下降速度」
出處：`sources/text/exploration-gliding-descent.json` 字元 1259-1263 `parameters[0].name.zh`

「下降慢更适合观景与探索，下降快更重视起跳判断。」
出處：`sources/text/exploration-gliding-descent.json` 字元 1337-1360 `parameters[0].effect.zh`
顯示：下降慢更適合觀景與探索，下降快更重視起跳判斷。

「空中恢复来源」
出處：`sources/text/exploration-gliding-descent.json` 字元 1521-1527 `parameters[1].name.zh`
顯示：空中恢復來源

「固定气流能组织路线，随机气流则增加临场调整。」
出處：`sources/text/exploration-gliding-descent.json` 字元 1611-1633 `parameters[1].effect.zh`
顯示：固定氣流能組織路線，隨機氣流則增加臨場調整。

## 原型

「做固定下沉速度、方向控制、一处上升气流和三个不同高度的落点。」
出處：`sources/text/exploration-gliding-descent.json` 字元 3096-3126 `prototype.firstStep.zh`
顯示：做固定下沉速度、方向控制、一處上升氣流和三個不同高度的落點。

「起飞前请玩家指出预计落点，观察实际结果与其预期是否接近。」
出處：`sources/text/exploration-gliding-descent.json` 字元 3425-3453 `prototype.test.zh`
顯示：起飛前請玩家指出預計落點，觀察實際結果與其預期是否接近。

「先让高度损失容易估计；过强惯性和复杂风场会让新玩家无法判断距离。」
出處：`sources/text/exploration-gliding-descent.json` 字元 3258-3290 `prototype.pitfall.zh`
顯示：先讓高度損失容易估計；過強慣性和複雜風場會讓新玩家無法判斷距離。

## 相關模式

- [空中行動回補](exploration-air-action-refill.md)
- [攀爬休息點路線](exploration-climbing-rest-route.md)
- [搬運物件](movement-carry-object.md)
- [移動平台時機](movement-moving-platform.md)

## 參考來源

- [Gliding and landing choice — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/exploration-gliding-descent/) — 查閱：2026-11-02；取得方式：page-text。
