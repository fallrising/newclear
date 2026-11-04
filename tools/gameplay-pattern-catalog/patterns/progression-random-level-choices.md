---
{
  "schema_version": 2,
  "id": "progression-random-level-choices",
  "title": "隨機等級選項",
  "title_en": "Random choices at level-up",
  "category": "progression",
  "source_category": "progression",
  "tags": [
    "randomness",
    "progression",
    "planning"
  ],
  "summary": "每次升级给几项候选，玩家边打边决定成长方向。",
  "note_status": "draft",
  "related": [
    "progression-successor-selection",
    "progression-challenge-tiers",
    "progression-death-loses-training",
    "progression-evolution-recipes"
  ],
  "sources": [
    {
      "title": "Random choices at level-up — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/progression-random-level-choices/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「每次升级给几项候选，玩家边打边决定成长方向。」
出處：`sources/text/progression-random-level-choices.json` 字元 197-219 `summary.zh`
顯示：每次升級給幾項候選，玩家邊打邊決定成長方向。

## 規則

「积累经验达到门槛后，系统给出少量随机升级，玩家只能取一个。候选可能加强已有能力，也可能加入新能力；不能保证想要的选项马上出现，所以要在立即解决问题和等待组合之间取舍。」
出處：`sources/text/progression-random-level-choices.json` 字元 331-414 `rules.zh`
顯示：積累經驗達到門檻後，系統給出少量隨機升級，玩家只能取一個。候選可能加強已有能力，也可能加入新能力；不能保證想要的選項馬上出現，所以要在立即解決問題和等待組合之間取捨。

## 核心循環

「收集经验」
出處：`sources/text/progression-random-level-choices.json` 字元 706-710 `loop[0].zh`
顯示：收集經驗

「达到升级门槛」
出處：`sources/text/progression-random-level-choices.json` 字元 772-778 `loop[1].zh`
顯示：達到升級門檻

「比较少量随机候选」
出處：`sources/text/progression-random-level-choices.json` 字元 835-843 `loop[2].zh`
顯示：比較少量隨機候選

「选择后用新能力继续」
出處：`sources/text/progression-random-level-choices.json` 字元 908-917 `loop[3].zh`
顯示：選擇後用新能力繼續

## 玩家取捨

「现在拿防御保命，还是选以后能配成组合的攻击？」
出處：`sources/text/progression-random-level-choices.json` 字元 1008-1030 `decisions[0].zh`
顯示：現在拿防禦保命，還是選以後能配成組合的攻擊？

「强化已经稳定的能力，还是占一个位置引入新能力？」
出處：`sources/text/progression-random-level-choices.json` 字元 1155-1178 `decisions[1].zh`
顯示：強化已經穩定的能力，還是佔一個位置引入新能力？

## 可調參數

「候选数量」
出處：`sources/text/progression-random-level-choices.json` 字元 1324-1328 `parameters[0].name.zh`
顯示：候選數量

「候选多时更容易按计划成长，少时更需要临时应变。」
出處：`sources/text/progression-random-level-choices.json` 字元 1406-1429 `parameters[0].effect.zh`
顯示：候選多時更容易按計劃成長，少時更需要臨時應變。

「重抽代价」
出處：`sources/text/progression-random-level-choices.json` 字元 1562-1566 `parameters[1].name.zh`
顯示：重抽代價

「有限重抽给玩家补救机会，也让“现在花还是以后用”成为资源选择。」
出處：`sources/text/progression-random-level-choices.json` 字元 1639-1670 `parameters[1].effect.zh`
顯示：有限重抽給玩家補救機會，也讓“現在花還是以後用”成爲資源選擇。

## 原型

「做六张升级卡、每次随机三选一，以及一个能显示升级效果的短波次。」
出處：`sources/text/progression-random-level-choices.json` 字元 3186-3217 `prototype.firstStep.zh`
顯示：做六張升級卡、每次隨機三選一，以及一個能顯示升級效果的短波次。

「玩家能否根据下一波或当前缺口改变选择，而非永远只看最高数字？」
出處：`sources/text/progression-random-level-choices.json` 字元 3527-3557 `prototype.test.zh`
顯示：玩家能否根據下一波或當前缺口改變選擇，而非永遠只看最高數字？

「别先做上百升级；先保证随机抽出的三项不会全都无用。」
出處：`sources/text/progression-random-level-choices.json` 字元 3368-3393 `prototype.pitfall.zh`
顯示：別先做上百升級；先保證隨機抽出的三項不會全都無用。

## 相關模式

- [繼承者選拔](progression-successor-selection.md)
- [挑戰層級](progression-challenge-tiers.md)
- [死亡失去訓練](progression-death-loses-training.md)
- [進化配方鏈](progression-evolution-recipes.md)

## 參考來源

- [Random choices at level-up — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/progression-random-level-choices/) — 查閱：2026-11-02；取得方式：page-text。
