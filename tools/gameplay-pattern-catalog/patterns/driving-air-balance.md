---
{
  "schema_version": 2,
  "id": "driving-air-balance",
  "title": "空中平衡",
  "title_en": "Adjust vehicle pitch before landing",
  "category": "driving",
  "source_category": "driving",
  "tags": [
    "precision",
    "dexterity",
    "risk"
  ],
  "summary": "腾空后仍能改变姿态，让车轮以合适角度接触下一段地面。",
  "note_status": "draft",
  "related": [
    "driving-air-stunt",
    "driving-drift-boost",
    "driving-start-charge",
    "driving-slipstream"
  ],
  "sources": [
    {
      "title": "Adjust vehicle pitch before landing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/driving-air-balance/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「腾空后仍能改变姿态，让车轮以合适角度接触下一段地面。」
出處：`sources/text/driving-air-balance.json` 字元 188-214 `summary.zh`
顯示：騰空後仍能改變姿態，讓車輪以合適角度接觸下一段地面。

## 規則

「载具离地后，玩家用前后倾或油门刹车等输入影响旋转。观察落地点的坡度，逐步把车身调到可接受的角度，再接地继续行驶。修正过头会造成新的倾斜，因而既要决定何时施力，也要决定何时停止。」
出處：`sources/text/driving-air-balance.json` 字元 341-429 `rules.zh`
顯示：載具離地後，玩家用前後傾或油門剎車等輸入影響旋轉。觀察落地點的坡度，逐步把車身調到可接受的角度，再接地繼續行駛。修正過頭會造成新的傾斜，因而既要決定何時施力，也要決定何時停止。

## 核心循環

「起跳并观察落地坡度」
出處：`sources/text/driving-air-balance.json` 字元 734-743 `loop[0].zh`
顯示：起跳並觀察落地坡度

「比较车身与地面角度」
出處：`sources/text/driving-air-balance.json` 字元 822-831 `loop[1].zh`
顯示：比較車身與地面角度

「输入修正并及时停手」
出處：`sources/text/driving-air-balance.json` 字元 909-918 `loop[2].zh`
顯示：輸入修正並及時停手

「落地后准备下一次起伏」
出處：`sources/text/driving-air-balance.json` 字元 996-1006 `loop[3].zh`
顯示：落地後準備下一次起伏

## 玩家取捨

「现在强力修正，还是等落点更清楚后轻微调整？」
出處：`sources/text/driving-air-balance.json` 字元 1105-1126 `decisions[0].zh`
顯示：現在強力修正，還是等落點更清楚後輕微調整？

「车身已接近目标角度，还应继续按住吗？」
出處：`sources/text/driving-air-balance.json` 字元 1228-1246 `decisions[1].zh`
顯示：車身已接近目標角度，還應繼續按住嗎？

## 可調參數

「姿态响应与惯性」
出處：`sources/text/driving-air-balance.json` 字元 1388-1395 `parameters[0].name.zh`
顯示：姿態響應與慣性

「响应快容易及时修正；惯性大需要提前停止输入。」
出處：`sources/text/driving-air-balance.json` 字元 1483-1505 `parameters[0].effect.zh`
顯示：響應快容易及時修正；慣性大需要提前停止輸入。

「落地容错范围」
出處：`sources/text/driving-air-balance.json` 字元 1659-1665 `parameters[1].name.zh`
顯示：落地容錯範圍

「宽容范围帮助学习，窄范围使坡度判断和细小修正更重要。」
出處：`sources/text/driving-air-balance.json` 字元 1744-1770 `parameters[1].effect.zh`
顯示：寬容範圍幫助學習，窄範圍使坡度判斷和細小修正更重要。

## 原型

「做一个可旋转的矩形、固定抛物线和两种坡面，先测试输入与落地角度的关系。」
出處：`sources/text/driving-air-balance.json` 字元 3347-3382 `prototype.firstStep.zh`
顯示：做一個可旋轉的矩形、固定拋物線和兩種坡面，先測試輸入與落地角度的關係。

「失败后，玩家能否指出是修正太晚还是按得太久，并在下一次改善？」
出處：`sources/text/driving-air-balance.json` 字元 3720-3750 `prototype.test.zh`
顯示：失敗後，玩家能否指出是修正太晚還是按得太久，並在下一次改善？

「不要一开始同时加入复杂悬挂、损伤与多轮接触，先让姿态变化可预测。」
出處：`sources/text/driving-air-balance.json` 字元 3539-3571 `prototype.pitfall.zh`
顯示：不要一開始同時加入複雜懸掛、損傷與多輪接觸，先讓姿態變化可預測。

## 相關模式

- [空中特技](driving-air-stunt.md)
- [漂移加速](driving-drift-boost.md)
- [起步蓄力](driving-start-charge.md)
- [尾流跟車加速](driving-slipstream.md)

## 參考來源

- [Adjust vehicle pitch before landing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/driving-air-balance/) — 查閱：2026-11-02；取得方式：page-text。
