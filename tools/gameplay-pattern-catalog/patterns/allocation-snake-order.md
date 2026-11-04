---
{
  "schema_version": 2,
  "id": "allocation-snake-order",
  "title": "蛇形輪選的補償",
  "title_en": "Reverse the next pass to compensate late picks",
  "category": "allocation",
  "source_category": "allocation",
  "tags": [
    "planning",
    "optimization"
  ],
  "summary": "前面先挑，后面则有机会连着挑两次。",
  "note_status": "draft",
  "related": [
    "allocation-area-majority",
    "allocation-follow-phase",
    "allocation-public-goal-race",
    "allocation-public-pick"
  ],
  "sources": [
    {
      "title": "Reverse the next pass to compensate late picks — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/allocation-snake-order/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「前面先挑，后面则有机会连着挑两次。」
出處：`sources/text/allocation-snake-order.json` 字元 204-221 `summary.zh`
顯示：前面先挑，後面則有機會連着挑兩次。

## 規則

「每人需要选择多次时，第一遍按顺序进行，第二遍反向返回，减少同一人总是先选的优势。玩家不仅看单件价值，也要考虑距离下次选择还有几个人；转折位置可连续选择，适合拿互相配合的两件。」
出處：`sources/text/allocation-snake-order.json` 字元 332-419 `rules.zh`
顯示：每人需要選擇多次時，第一遍按順序進行，第二遍反向返回，減少同一人總是先選的優勢。玩家不僅看單件價值，也要考慮距離下次選擇還有幾個人；轉折位置可連續選擇，適合拿互相配合的兩件。

## 核心循環

「查看完整选择顺序」
出處：`sources/text/allocation-snake-order.json` 字元 699-707 `loop[0].zh`
顯示：查看完整選擇順序

「拿最怕被抢走的选项」
出處：`sources/text/allocation-snake-order.json` 字元 775-784 `loop[1].zh`
顯示：拿最怕被搶走的選項

「顺序反转后再次选择」
出處：`sources/text/allocation-snake-order.json` 字元 858-867 `loop[2].zh`
顯示：順序反轉後再次選擇

「根据两次所得形成方案」
出處：`sources/text/allocation-snake-order.json` 字元 946-956 `loop[3].zh`
顯示：根據兩次所得形成方案

## 玩家取捨

「先手拿单件最强，还是拿必须配另一件才有用的部分？」
出處：`sources/text/allocation-snake-order.json` 字元 1047-1071 `decisions[0].zh`
顯示：先手拿單件最強，還是拿必須配另一件纔有用的部分？

「最后一位能连选两次，要凑组合还是抢两个通用强项？」
出處：`sources/text/allocation-snake-order.json` 字元 1204-1228 `decisions[1].zh`
顯示：最後一位能連選兩次，要湊組合還是搶兩個通用強項？

## 可調參數

「往返次数」
出處：`sources/text/allocation-snake-order.json` 字元 1375-1379 `parameters[0].name.zh`
顯示：往返次數

「一次往返便于理解，多轮反转需要持续提示顺序。」
出處：`sources/text/allocation-snake-order.json` 字元 1457-1479 `parameters[0].effect.zh`
顯示：一次往返便於理解，多輪反轉需要持續提示順序。

「组合强度」
出處：`sources/text/allocation-snake-order.json` 字元 1636-1640 `parameters[1].name.zh`
顯示：組合強度

「成对收益越大，连续两次选择就越有价值。」
出處：`sources/text/allocation-snake-order.json` 字元 1715-1734 `parameters[1].effect.zh`
顯示：成對收益越大，連續兩次選擇就越有價值。

## 原型

「三名本地玩家、六张工具牌和两种成对奖励，把六次顺序一直显示在屏幕上。」
出處：`sources/text/allocation-snake-order.json` 字元 3147-3181 `prototype.firstStep.zh`
顯示：三名本地玩家、六張工具牌和兩種成對獎勵，把六次順序一直顯示在屏幕上。

「先手与末位是否形成不同的拿牌策略，且都能说清原因？」
出處：`sources/text/allocation-snake-order.json` 字元 3494-3519 `prototype.test.zh`
顯示：先手與末位是否形成不同的拿牌策略，且都能說清原因？

「蛇形顺序只能补偿部分先手差异，不能保证任意奖励结构都公平。」
出處：`sources/text/allocation-snake-order.json` 字元 3325-3354 `prototype.pitfall.zh`
顯示：蛇形順序只能補償部分先手差異，不能保證任意獎勵結構都公平。

## 相關模式

- [區域多數](allocation-area-majority.md)
- [跟進階段](allocation-follow-phase.md)
- [公開目標競速](allocation-public-goal-race.md)
- [公開選取](allocation-public-pick.md)

## 參考來源

- [Reverse the next pass to compensate late picks — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/allocation-snake-order/) — 查閱：2026-11-02；取得方式：page-text。
