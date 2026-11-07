---
{
  "schema_version": 2,
  "id": "progression-prestige-reset",
  "title": "以重置換取加速",
  "title_en": "Reset progress for lasting acceleration",
  "category": "progression",
  "source_category": "progression",
  "tags": [
    "progression",
    "economy",
    "time",
    "optimization"
  ],
  "summary": "主动放弃这一轮积累，换下一轮更快起步。",
  "note_status": "draft",
  "related": [
    "progression-permanent-run-currency",
    "progression-practice-based-growth",
    "progression-research-prerequisites",
    "progression-respec-investment"
  ],
  "sources": [
    {
      "title": "Reset progress for lasting acceleration — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/progression-prestige-reset/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「主动放弃这一轮积累，换下一轮更快起步。」
出處：`sources/text/progression-prestige-reset.json` 字元 201-220 `summary.zh`
顯示：主動放棄這一輪積累，換下一輪更快起步。

## 規則

「当本轮增长变慢，玩家可主动重置普通资源和设施，按已达进度领取长期奖励。下一轮从较低阶段重开，却有更强的效率；关键选择是现在重开，还是再推进一点以换取更多奖励。」
出處：`sources/text/progression-prestige-reset.json` 字元 317-396 `rules.zh`
顯示：當本輪增長變慢，玩家可主動重置普通資源和設施，按已達進度領取長期獎勵。下一輪從較低階段重開，卻有更強的效率；關鍵選擇是現在重開，還是再推進一點以換取更多獎勵。

## 核心循環

「积累产能」
出處：`sources/text/progression-prestige-reset.json` 字元 683-687 `loop[0].zh`
顯示：積累產能

「比较继续推进与重置收益」
出處：`sources/text/progression-prestige-reset.json` 字元 747-758 `loop[1].zh`
顯示：比較繼續推進與重置收益

「确认保留与清空的内容」
出處：`sources/text/progression-prestige-reset.json` 字元 831-841 `loop[2].zh`
顯示：確認保留與清空的內容

「带加成重走早期阶段」
出處：`sources/text/progression-prestige-reset.json` 字元 918-927 `loop[3].zh`
顯示：帶加成重走早期階段

## 玩家取捨

「现在重置能很快回本，还是多等一会就能跨过更高奖励门槛？」
出處：`sources/text/progression-prestige-reset.json` 字元 1024-1051 `decisions[0].zh`
顯示：現在重置能很快回本，還是多等一會就能跨過更高獎勵門檻？

「长期奖励用来普遍提速，还是投资一条特定生产路线？」
出處：`sources/text/progression-prestige-reset.json` 字元 1164-1188 `decisions[1].zh`
顯示：長期獎勵用來普遍提速，還是投資一條特定生產路線？

## 可調參數

「重置奖励曲线」
出處：`sources/text/progression-prestige-reset.json` 字元 1346-1352 `parameters[0].name.zh`
顯示：重置獎勵曲線

「门槛间隔越大，玩家越需要判断继续等待值不值。」
出處：`sources/text/progression-prestige-reset.json` 字元 1432-1454 `parameters[0].effect.zh`
顯示：門檻間隔越大，玩家越需要判斷繼續等待值不值。

「重走早期的时间」
出處：`sources/text/progression-prestige-reset.json` 字元 1595-1602 `parameters[1].name.zh`
顯示：重走早期的時間

「回到旧进度太慢会显得惩罚；太快则早期升级很快失去意义。」
出處：`sources/text/progression-prestige-reset.json` 字元 1675-1702 `parameters[1].effect.zh`
顯示：回到舊進度太慢會顯得懲罰；太快則早期升級很快失去意義。

## 原型

「做三档生产设施、一个清楚显示清空和保留内容的重置按钮，以及一个永久倍率。」
出處：`sources/text/progression-prestige-reset.json` 字元 3333-3369 `prototype.firstStep.zh`
顯示：做三檔生產設施、一個清楚顯示清空和保留內容的重置按鈕，以及一個永久倍率。

「让玩家说明为什么此刻重置，并观察第二轮是否主动改变购买顺序。」
出處：`sources/text/progression-prestige-reset.json` 字元 3710-3740 `prototype.test.zh`
顯示：讓玩家說明爲什麼此刻重置，並觀察第二輪是否主動改變購買順序。

「别先堆超大数字；先验证重置后的几分钟仍有选择，而不是机械补买。」
出處：`sources/text/progression-prestige-reset.json` 字元 3533-3564 `prototype.pitfall.zh`
顯示：別先堆超大數字；先驗證重置後的幾分鐘仍有選擇，而不是機械補買。

## 相關模式

- [跨局保留的永久貨幣](progression-permanent-run-currency.md)
- [練習成長](progression-practice-based-growth.md)
- [研究前置](progression-research-prerequisites.md)
- [重配投入](progression-respec-investment.md)

## 參考來源

- [Reset progress for lasting acceleration — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/progression-prestige-reset/) — 查閱：2026-11-02；取得方式：page-text。
