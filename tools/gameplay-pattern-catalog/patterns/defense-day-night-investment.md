---
{
  "schema_version": 2,
  "id": "defense-day-night-investment",
  "title": "日間夜間投入",
  "title_en": "Invest by day, defend by night",
  "category": "defense",
  "source_category": "defense",
  "tags": [
    "economy",
    "planning",
    "risk"
  ],
  "summary": "每次安全期都在决定：今天多赚钱，还是今晚更安全。",
  "note_status": "draft",
  "related": [
    "defense-ammunition-supply",
    "defense-early-wave-call",
    "defense-mobile-defender",
    "defense-resistance-counters"
  ],
  "sources": [
    {
      "title": "Invest by day, defend by night — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/defense-day-night-investment/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「每次安全期都在决定：今天多赚钱，还是今晚更安全。」
出處：`sources/text/defense-day-night-investment.json` 字元 190-214 `summary.zh`
顯示：每次安全期都在決定：今天多賺錢，還是今晚更安全。

## 規則

「玩法把建设与防守分成可辨认的阶段。玩家在安全时段花钱扩张收入或增强防线，危险时段则承受此前投资的结果；存活的经济设施带来下一轮资金，损失会压缩之后的选择。」
出處：`sources/text/defense-day-night-investment.json` 字元 342-419 `rules.zh`
顯示：玩法把建設與防守分成可辨認的階段。玩家在安全時段花錢擴張收入或增強防線，危險時段則承受此前投資的結果；存活的經濟設施帶來下一輪資金，損失會壓縮之後的選擇。

## 核心循環

「结算上轮收入与损失」
出處：`sources/text/defense-day-night-investment.json` 字元 708-717 `loop[0].zh`
顯示：結算上輪收入與損失

「分配经济与防御投入」
出處：`sources/text/defense-day-night-investment.json` 字元 785-794 `loop[1].zh`
顯示：分配經濟與防禦投入

「抵御夜间进攻」
出處：`sources/text/defense-day-night-investment.json` 字元 879-885 `loop[2].zh`
顯示：抵禦夜間進攻

「用结果安排下一天」
出處：`sources/text/defense-day-night-investment.json` 字元 953-961 `loop[3].zh`
顯示：用結果安排下一天

## 玩家取捨

「今晚已经能勉强守住，要不要冒险把钱留给明天的收入？」
出處：`sources/text/defense-day-night-investment.json` 字元 1059-1084 `decisions[0].zh`
顯示：今晚已經能勉強守住，要不要冒險把錢留給明天的收入？

「扩张后防线变长，新收入是否足够支付新增的守卫？」
出處：`sources/text/defense-day-night-investment.json` 字元 1209-1232 `decisions[1].zh`
顯示：擴張後防線變長，新收入是否足夠支付新增的守衛？

## 可調參數

「经济回本轮数」
出處：`sources/text/defense-day-night-investment.json` 字元 1394-1400 `parameters[0].name.zh`
顯示：經濟回本輪數

「回本越慢，提前投资越需要信心；回本很快则容易形成滚雪球。」
出處：`sources/text/defense-day-night-investment.json` 字元 1476-1504 `parameters[0].effect.zh`
顯示：回本越慢，提前投資越需要信心；回本很快則容易形成滾雪球。

「进攻信息透明度」
出處：`sources/text/defense-day-night-investment.json` 字元 1655-1662 `parameters[1].name.zh`
顯示：進攻信息透明度

「提前知道敌人方向与类型有利于规划；信息少会鼓励保守留钱。」
出處：`sources/text/defense-day-night-investment.json` 字元 1745-1773 `parameters[1].effect.zh`
顯示：提前知道敵人方向與類型有利於規劃；信息少會鼓勵保守留錢。

## 原型

「用一张固定地图、一个产钱建筑、一段城墙和三次夜袭验证投资取舍。」
出處：`sources/text/defense-day-night-investment.json` 字元 3324-3355 `prototype.firstStep.zh`
顯示：用一張固定地圖、一個產錢建築、一段城牆和三次夜襲驗證投資取捨。

「玩家是否会因下一夜的威胁改变经济投入，而非每轮照同一个顺序买？」
出處：`sources/text/defense-day-night-investment.json` 字元 3671-3702 `prototype.test.zh`
顯示：玩家是否會因下一夜的威脅改變經濟投入，而非每輪照同一個順序買？

「先不做大地图扩张；必须让玩家看懂每笔收入来自哪座存活建筑。」
出處：`sources/text/defense-day-night-investment.json` 字元 3510-3539 `prototype.pitfall.zh`
顯示：先不做大地圖擴張；必須讓玩家看懂每筆收入來自哪座存活建築。

## 相關模式

- [彈藥供給](defense-ammunition-supply.md)
- [提早呼叫下一波](defense-early-wave-call.md)
- [移動中防守者](defense-mobile-defender.md)
- [抗性克制](defense-resistance-counters.md)

## 參考來源

- [Invest by day, defend by night — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/defense-day-night-investment/) — 查閱：2026-11-02；取得方式：page-text。
