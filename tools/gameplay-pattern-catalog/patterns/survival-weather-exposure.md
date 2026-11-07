---
{
  "schema_version": 2,
  "id": "survival-weather-exposure",
  "title": "天候暴露",
  "title_en": "Wetness, cold and warming up",
  "category": "survival",
  "source_category": "survival",
  "tags": [
    "planning",
    "spatial"
  ],
  "summary": "天气改变身体状态，玩家要为赶路、避雨和烘干安排顺序。",
  "note_status": "draft",
  "related": [
    "survival-balanced-nutrition",
    "survival-bleeding-triage",
    "survival-competing-needs",
    "survival-contagion-control"
  ],
  "sources": [
    {
      "title": "Wetness, cold and warming up — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/survival-weather-exposure/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「天气改变身体状态，玩家要为赶路、避雨和烘干安排顺序。」
出處：`sources/text/survival-weather-exposure.json` 字元 185-211 `summary.zh`
顯示：天氣改變身體狀態，玩家要爲趕路、避雨和烘乾安排順序。

## 規則

「暴露在雨雪或低温中会积累不利状态；衣物、遮蔽和火源改变暴露或恢复速度。路线不只是距离问题，也取决于途中能否停靠和恢复。」
出處：`sources/text/survival-weather-exposure.json` 字元 346-405 `rules.zh`
顯示：暴露在雨雪或低溫中會積累不利狀態；衣物、遮蔽和火源改變暴露或恢復速度。路線不只是距離問題，也取決於途中能否停靠和恢復。

## 核心循環

「判断天气和自身状态」
出處：`sources/text/survival-weather-exposure.json` 字元 619-628 `loop[0].zh`
顯示：判斷天氣和自身狀態

「选择防护及停靠点」
出處：`sources/text/survival-weather-exposure.json` 字元 699-707 `loop[1].zh`
顯示：選擇防護及停靠點

「在暴露中移动」
出處：`sources/text/survival-weather-exposure.json` 字元 786-792 `loop[2].zh`
顯示：在暴露中移動

「避雨取暖后重新出发」
出處：`sources/text/survival-weather-exposure.json` 字元 856-865 `loop[3].zh`
顯示：避雨取暖後重新出發

## 玩家取捨

「走短但无遮蔽的路，还是绕经安全火源？」
出處：`sources/text/survival-weather-exposure.json` 字元 962-980 `decisions[0].zh`
顯示：走短但無遮蔽的路，還是繞經安全火源？

「等衣服干透再走，还是趁天亮继续赶路？」
出處：`sources/text/survival-weather-exposure.json` 字元 1078-1096 `decisions[1].zh`
顯示：等衣服乾透再走，還是趁天亮繼續趕路？

## 可調參數

「暴露累积速度」
出處：`sources/text/survival-weather-exposure.json` 字元 1236-1242 `parameters[0].name.zh`
顯示：暴露累積速度

「越快越强调临时避难；越慢越强调出发前规划。」
出處：`sources/text/survival-weather-exposure.json` 字元 1317-1338 `parameters[0].effect.zh`
顯示：越快越強調臨時避難；越慢越強調出發前規劃。

「遮蔽恢复效率」
出處：`sources/text/survival-weather-exposure.json` 字元 1499-1505 `parameters[1].name.zh`
顯示：遮蔽恢復效率

「停靠点恢复越快，地图上的避难设施越能影响路线。」
出處：`sources/text/survival-weather-exposure.json` 字元 1583-1606 `parameters[1].effect.zh`
顯示：停靠點恢復越快，地圖上的避難設施越能影響路線。

## 原型

「先做湿透和寒冷两种状态、三个路线节点与一处可点燃火源。」
出處：`sources/text/survival-weather-exposure.json` 字元 3027-3054 `prototype.firstStep.zh`
顯示：先做溼透和寒冷兩種狀態、三個路線節點與一處可點燃火源。

「用一次降雨改变条件，看玩家是否重新选择路线。」
出處：`sources/text/survival-weather-exposure.json` 字元 3357-3379 `prototype.test.zh`
顯示：用一次降雨改變條件，看玩家是否重新選擇路線。

「无需一开始做动态气候和布料模拟；状态变化必须在移动前可估计。」
出處：`sources/text/survival-weather-exposure.json` 字元 3182-3212 `prototype.pitfall.zh`
顯示：無需一開始做動態氣候和布料模擬；狀態變化必須在移動前可估計。

## 相關模式

- [均衡營養](survival-balanced-nutrition.md)
- [失血分診](survival-bleeding-triage.md)
- [競爭需求](survival-competing-needs.md)
- [傳染控制](survival-contagion-control.md)

## 參考來源

- [Wetness, cold and warming up — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/survival-weather-exposure/) — 查閱：2026-11-02；取得方式：page-text。
