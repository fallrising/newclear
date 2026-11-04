---
{
  "schema_version": 2,
  "id": "building-water-engineering",
  "title": "水位與蓄留",
  "title_en": "Water retention and level management",
  "category": "building",
  "source_category": "building",
  "tags": [
    "spatial",
    "risk",
    "planning"
  ],
  "summary": "通过阻挡与放流改变水位，把水变成可管理的地形资源。",
  "note_status": "draft",
  "related": [
    "building-structural-support",
    "building-access-network",
    "building-room-requirements",
    "building-service-coverage"
  ],
  "sources": [
    {
      "title": "Water retention and level management — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/building-water-engineering/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「通过阻挡与放流改变水位，把水变成可管理的地形资源。」
出處：`sources/text/building-water-engineering.json` 字元 195-220 `summary.zh`
顯示：通過阻擋與放流改變水位，把水變成可管理的地形資源。

## 規則

「玩家修建阻水结构，让水在指定区域积累或排出。来水、高差和出口能力决定水位；持续观察漫溢与干涸，再调整控制。」
出處：`sources/text/building-water-engineering.json` 字元 328-381 `rules.zh`
顯示：玩家修建阻水結構，讓水在指定區域積累或排出。來水、高差和出口能力決定水位；持續觀察漫溢與乾涸，再調整控制。

## 核心循環

「评估上下游」
出處：`sources/text/building-water-engineering.json` 字元 578-583 `loop[0].zh`
顯示：評估上下游

「建设阻水和出口」
出處：`sources/text/building-water-engineering.json` 字元 657-664 `loop[1].zh`
顯示：建設阻水和出口

「观察水位」
出處：`sources/text/building-water-engineering.json` 字元 734-738 `loop[2].zh`
顯示：觀察水位

「调整放流防护」
出處：`sources/text/building-water-engineering.json` 字元 800-806 `loop[3].zh`
顯示：調整放流防護

## 玩家取捨

「多蓄水能应对旱期，也增加上游淹水风险。」
出處：`sources/text/building-water-engineering.json` 字元 900-919 `decisions[0].zh`
顯示：多蓄水能應對旱期，也增加上游淹水風險。

「大坝集中控制，小型分段更容易逐步验证。」
出處：`sources/text/building-water-engineering.json` 字元 1025-1044 `decisions[1].zh`
顯示：大壩集中控制，小型分段更容易逐步驗證。

## 可調參數

「来水波动」
出處：`sources/text/building-water-engineering.json` 字元 1195-1199 `parameters[0].name.zh`
顯示：來水波動

「季节变化强化提前蓄水和安全溢流的价值。」
出處：`sources/text/building-water-engineering.json` 字元 1277-1296 `parameters[0].effect.zh`
顯示：季節變化強化提前蓄水和安全溢流的價值。

「反馈速度」
出處：`sources/text/building-water-engineering.json` 字元 1427-1431 `parameters[1].name.zh`
顯示：反饋速度

「慢变化鼓励预测，快变化要求即时补救。」
出處：`sources/text/building-water-engineering.json` 字元 1507-1525 `parameters[1].effect.zh`
顯示：慢變化鼓勵預測，快變化要求即時補救。

## 原型

「先做两个相连水池、固定容量和可调闸门，以总体积计算水位，不做完整水流模拟。」
出處：`sources/text/building-water-engineering.json` 字元 3006-3043 `prototype.firstStep.zh`
顯示：先做兩個相連水池、固定容量和可調閘門，以總體積計算水位，不做完整水流模擬。

「给雨季和旱期两段变化，玩家是否会预留容量或储备，而非一直把闸门开到底？」
出處：`sources/text/building-water-engineering.json` 字元 3448-3483 `prototype.test.zh`
顯示：給雨季和旱期兩段變化，玩家是否會預留容量或儲備，而非一直把閘門開到底？

「真实水流、可变地形与多闸门网络会显著增加计算和调试，应先验证蓄放取舍。」
出處：`sources/text/building-water-engineering.json` 字元 3234-3269 `prototype.pitfall.zh`
顯示：真實水流、可變地形與多閘門網絡會顯著增加計算和調試，應先驗證蓄放取捨。

## 相關模式

- [支撐約束與結構失效](building-structural-support.md)
- [進出網路](building-access-network.md)
- [房間需求條件](building-room-requirements.md)
- [服務覆蓋](building-service-coverage.md)

## 參考來源

- [Water retention and level management — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/building-water-engineering/) — 查閱：2026-11-02；取得方式：page-text。
