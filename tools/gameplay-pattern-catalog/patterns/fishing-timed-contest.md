---
{
  "schema_version": 2,
  "id": "fishing-timed-contest",
  "title": "限時競賽",
  "title_en": "Timed fishing contests",
  "category": "fishing",
  "source_category": "fishing",
  "tags": [
    "time",
    "optimization",
    "planning"
  ],
  "summary": "用短暂计分窗口，让熟悉的钓鱼变成路线与效率挑战。",
  "note_status": "draft",
  "related": [
    "fishing-passive-traps",
    "commerce-timed-contracts",
    "commerce-trade-route-programming",
    "fishing-bait-loadout"
  ],
  "sources": [
    {
      "title": "Timed fishing contests — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/fishing-timed-contest/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「用短暂计分窗口，让熟悉的钓鱼变成路线与效率挑战。」
出處：`sources/text/fishing-timed-contest.json` 字元 172-196 `summary.zh`
顯示：用短暫計分窗口，讓熟悉的釣魚變成路線與效率挑戰。

## 規則

「玩家在规定时间内捕获符合赛事条件的鱼，并按规则结算成绩。练习、装备和路线都在倒计时里变得重要；计分条件决定玩家追求数量、目标鱼种还是稀有度。」
出處：`sources/text/fishing-timed-contest.json` 字元 325-395 `rules.zh`
顯示：玩家在規定時間內捕獲符合賽事條件的魚，並按規則結算成績。練習、裝備和路線都在倒計時裏變得重要；計分條件決定玩家追求數量、目標魚種還是稀有度。

## 核心循環

「确认计分与截止规则」
出處：`sources/text/fishing-timed-contest.json` 字元 663-672 `loop[0].zh`
顯示：確認計分與截止規則

「准备钓具并选择路线」
出處：`sources/text/fishing-timed-contest.json` 字元 747-756 `loop[1].zh`
顯示：準備釣具並選擇路線

「在时限内捕获目标」
出處：`sources/text/fishing-timed-contest.json` 字元 822-830 `loop[2].zh`
顯示：在時限內捕獲目標

「结算成绩并领取奖励」
出處：`sources/text/fishing-timed-contest.json` 字元 903-912 `loop[3].zh`
顯示：結算成績並領取獎勵

## 玩家取捨

「远处更好的钓点未必抵得过来回时间，路线要按赛制优化。」
出處：`sources/text/fishing-timed-contest.json` 字元 1009-1035 `decisions[0].zh`
顯示：遠處更好的釣點未必抵得過來回時間，路線要按賽制優化。

「剩余时间只够少数尝试，要赌一条高分难鱼，还是继续稳定捕获容易的小鱼？」
出處：`sources/text/fishing-timed-contest.json` 字元 1162-1196 `decisions[1].zh`
顯示：剩餘時間只夠少數嘗試，要賭一條高分難魚，還是繼續穩定捕獲容易的小魚？

## 可調參數

「计分方式」
出處：`sources/text/fishing-timed-contest.json` 字元 1377-1381 `parameters[0].name.zh`
顯示：計分方式

「按数量鼓励快速目标，按价值则鼓励高风险选择。」
出處：`sources/text/fishing-timed-contest.json` 字元 1457-1479 `parameters[0].effect.zh`
顯示：按數量鼓勵快速目標，按價值則鼓勵高風險選擇。

「准备期」
出處：`sources/text/fishing-timed-contest.json` 字元 1624-1627 `parameters[1].name.zh`
顯示：準備期

「提前公布赛制奖励规划，临场公布更考验适应。」
出處：`sources/text/fishing-timed-contest.json` 字元 1707-1728 `parameters[1].effect.zh`
顯示：提前公佈賽制獎勵規劃，臨場公佈更考驗適應。

## 原型

「做两个钓点、统一倒计时和一种明确计分方式，先让单人挑战自己的成绩。」
出處：`sources/text/fishing-timed-contest.json` 字元 3193-3226 `prototype.firstStep.zh`
顯示：做兩個釣點、統一倒計時和一種明確計分方式，先讓單人挑戰自己的成績。

「剩余时间变少时，玩家是否调整目标，放弃来不及完成的远程选择？」
出處：`sources/text/fishing-timed-contest.json` 字元 3564-3594 `prototype.test.zh`
顯示：剩餘時間變少時，玩家是否調整目標，放棄來不及完成的遠程選擇？

「不要同时混合数量、重量、稀有度等多个不透明评分，先让玩家看懂为何得分。」
出處：`sources/text/fishing-timed-contest.json` 字元 3380-3415 `prototype.pitfall.zh`
顯示：不要同時混合數量、重量、稀有度等多個不透明評分，先讓玩家看懂爲何得分。

## 相關模式

- [被動陷阱組](fishing-passive-traps.md)
- [限時合約](commerce-timed-contracts.md)
- [貿易路線編排](commerce-trade-route-programming.md)
- [餌配置組](fishing-bait-loadout.md)

## 參考來源

- [Timed fishing contests — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/fishing-timed-contest/) — 查閱：2026-11-02；取得方式：page-text。
