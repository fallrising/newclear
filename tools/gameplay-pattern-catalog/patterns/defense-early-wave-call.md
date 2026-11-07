---
{
  "schema_version": 2,
  "id": "defense-early-wave-call",
  "title": "提早呼叫下一波",
  "title_en": "Call the next wave early",
  "category": "defense",
  "source_category": "defense",
  "tags": [
    "risk",
    "timing",
    "economy"
  ],
  "summary": "主动缩短休息时间，用更危险的重叠进攻换取奖励。",
  "note_status": "draft",
  "related": [
    "commerce-haggling",
    "defense-day-night-investment",
    "commerce-auction-bidding",
    "commerce-debt-pressure"
  ],
  "sources": [
    {
      "title": "Call the next wave early — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/defense-early-wave-call/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「主动缩短休息时间，用更危险的重叠进攻换取奖励。」
出處：`sources/text/defense-early-wave-call.json` 字元 176-199 `summary.zh`
顯示：主動縮短休息時間，用更危險的重疊進攻換取獎勵。

## 規則

「当前波尚未完全结束时，玩家可以提前启动下一波。提前行动带来奖励或节奏收益，但旧敌人、技能冷却和未完成的建设仍然存在；剩余时间与敌人数量让风险可以估计。」
出處：`sources/text/defense-early-wave-call.json` 字元 313-388 `rules.zh`
顯示：當前波尚未完全結束時，玩家可以提前啓動下一波。提前行動帶來獎勵或節奏收益，但舊敵人、技能冷卻和未完成的建設仍然存在；剩餘時間與敵人數量讓風險可以估計。

## 核心循環

「判断当前防线余量」
出處：`sources/text/defense-early-wave-call.json` 字元 678-686 `loop[0].zh`
顯示：判斷當前防線餘量

「查看下一波与剩余时间」
出處：`sources/text/defense-early-wave-call.json` 字元 761-771 `loop[1].zh`
顯示：查看下一波與剩餘時間

「提前开波或继续等待」
出處：`sources/text/defense-early-wave-call.json` 字元 859-868 `loop[2].zh`
顯示：提前開波或繼續等待

「处理重叠敌人并结算收益」
出處：`sources/text/defense-early-wave-call.json` 字元 938-949 `loop[3].zh`
顯示：處理重疊敵人並結算收益

## 玩家取捨

「只剩一个慢怪时提前开波很划算，但它也可能正在占住关键火力。」
出處：`sources/text/defense-early-wave-call.json` 字元 1064-1093 `decisions[0].zh`
顯示：只剩一個慢怪時提前開波很划算，但它也可能正在佔住關鍵火力。

「提前得到的钱能否立刻买到一项补强，抵消多出来的压力？」
出處：`sources/text/defense-early-wave-call.json` 字元 1243-1269 `decisions[1].zh`
顯示：提前得到的錢能否立刻買到一項補強，抵消多出來的壓力？

## 可調參數

「奖励随时间变化」
出處：`sources/text/defense-early-wave-call.json` 字元 1445-1452 `parameters[0].name.zh`
顯示：獎勵隨時間變化

「越早奖励越高，会不断追问玩家“还能不能再快一点”；固定奖励更易理解。」
出處：`sources/text/defense-early-wave-call.json` 字元 1538-1572 `parameters[0].effect.zh`
顯示：越早獎勵越高，會不斷追問玩家“還能不能再快一點”；固定獎勵更易理解。

「波次重叠上限」
出處：`sources/text/defense-early-wave-call.json` 字元 1761-1767 `parameters[1].name.zh`
顯示：波次重疊上限

「允许连续召唤会放大高手表达空间，也更需要清楚提示总威胁。」
出處：`sources/text/defense-early-wave-call.json` 字元 1842-1870 `parameters[1].effect.zh`
顯示：允許連續召喚會放大高手錶達空間，也更需要清楚提示總威脅。

## 原型

「实现两波敌人、一个倒计时和一次性提前奖励；先固定来敌组合。」
出處：`sources/text/defense-early-wave-call.json` 字元 3345-3374 `prototype.firstStep.zh`
顯示：實現兩波敵人、一個倒計時和一次性提前獎勵；先固定來敵組合。

「测试者是否有时提前、有时等待，并能解释原因？」
出處：`sources/text/defense-early-wave-call.json` 字元 3645-3667 `prototype.test.zh`
顯示：測試者是否有時提前、有時等待，並能解釋原因？

「不要把奖励做成永远值得点的按钮；重叠压力必须真实存在。」
出處：`sources/text/defense-early-wave-call.json` 字元 3490-3517 `prototype.pitfall.zh`
顯示：不要把獎勵做成永遠值得點的按鈕；重疊壓力必須真實存在。

## 相關模式

- [議價中的讓步](commerce-haggling.md)
- [日間夜間投入](defense-day-night-investment.md)
- [拍賣出價](commerce-auction-bidding.md)
- [債務壓力](commerce-debt-pressure.md)

## 參考來源

- [Call the next wave early — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/defense-early-wave-call/) — 查閱：2026-11-02；取得方式：page-text。
