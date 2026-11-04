---
{
  "schema_version": 2,
  "id": "progression-death-loses-training",
  "title": "死亡失去訓練",
  "title_en": "Death costs trained abilities",
  "category": "progression",
  "source_category": "progression",
  "tags": [
    "risk",
    "progression",
    "planning"
  ],
  "summary": "失败不只丢物品，还会损失一部分练习成果。",
  "note_status": "draft",
  "related": [
    "progression-challenge-tiers",
    "progression-evolution-recipes",
    "progression-permanent-run-currency",
    "progression-practice-based-growth"
  ],
  "sources": [
    {
      "title": "Death costs trained abilities — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/progression-death-loses-training/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「失败不只丢物品，还会损失一部分练习成果。」
出處：`sources/text/progression-death-loses-training.json` 字元 198-218 `summary.zh`
顯示：失敗不只丟物品，還會損失一部分練習成果。

## 規則

「角色死亡后，已练出的熟练度下降，或新角色不再拥有前一人的训练成果。玩家因此要衡量继续冒险的收益与重新练习的成本；找回装备和找回能力是两回事。」
出處：`sources/text/progression-death-loses-training.json` 字元 310-380 `rules.zh`
顯示：角色死亡後，已練出的熟練度下降，或新角色不再擁有前一人的訓練成果。玩家因此要衡量繼續冒險的收益與重新練習的成本；找回裝備和找回能力是兩回事。

## 核心循環

「靠行动练出能力」
出處：`sources/text/progression-death-loses-training.json` 字元 670-677 `loop[0].zh`
顯示：靠行動練出能力

「评估危险与撤退时机」
出處：`sources/text/progression-death-loses-training.json` 字元 750-759 `loop[1].zh`
顯示：評估危險與撤退時機

「失败后查看损失」
出處：`sources/text/progression-death-loses-training.json` 字元 828-835 `loop[2].zh`
顯示：失敗後查看損失

「重新训练并调整路线」
出處：`sources/text/progression-death-loses-training.json` 字元 904-913 `loop[3].zh`
顯示：重新訓練並調整路線

## 玩家取捨

「带着已经练强的角色去冒险，还是暂时撤退保住训练成果？」
出處：`sources/text/progression-death-loses-training.json` 字元 1006-1032 `decisions[0].zh`
顯示：帶着已經練強的角色去冒險，還是暫時撤退保住訓練成果？

「损失后先练回原本优势，还是趁机会改练另一种生存方法？」
出處：`sources/text/progression-death-loses-training.json` 字元 1144-1170 `decisions[1].zh`
顯示：損失後先練回原本優勢，還是趁機會改練另一種生存方法？

## 可調參數

「损失幅度」
出處：`sources/text/progression-death-loses-training.json` 字元 1321-1325 `parameters[0].name.zh`
顯示：損失幅度

「损失大时撤退更有意义，也更容易让玩家反复做低风险练习。」
出處：`sources/text/progression-death-loses-training.json` 字元 1400-1427 `parameters[0].effect.zh`
顯示：損失大時撤退更有意義，也更容易讓玩家反覆做低風險練習。

「恢复途径」
出處：`sources/text/progression-death-loses-training.json` 字元 1575-1579 `parameters[1].name.zh`
顯示：恢復途徑

「重新练习若能换路线，就比强迫重复同一段动作更有选择。」
出處：`sources/text/progression-death-loses-training.json` 字元 1657-1683 `parameters[1].effect.zh`
顯示：重新練習若能換路線，就比強迫重複同一段動作更有選擇。

## 原型

「做一条安全练习路线和一条高风险路线，只有一个熟练度数值与清楚的死亡扣减。」
出處：`sources/text/progression-death-loses-training.json` 字元 3256-3292 `prototype.firstStep.zh`
顯示：做一條安全練習路線和一條高風險路線，只有一個熟練度數值與清楚的死亡扣減。

「临近危险时玩家是否主动撤退，死亡后又能准确说明需要恢复什么？」
出處：`sources/text/progression-death-loses-training.json` 字元 3630-3660 `prototype.test.zh`
顯示：臨近危險時玩家是否主動撤退，死亡後又能準確說明需要恢復什麼？

「先别让大量技能一起掉；玩家若不知道失去什么，惩罚只会变成模糊挫败。」
出處：`sources/text/progression-death-loses-training.json` 字元 3449-3482 `prototype.pitfall.zh`
顯示：先別讓大量技能一起掉；玩家若不知道失去什麼，懲罰只會變成模糊挫敗。

## 相關模式

- [挑戰層級](progression-challenge-tiers.md)
- [進化配方鏈](progression-evolution-recipes.md)
- [跨局保留的永久貨幣](progression-permanent-run-currency.md)
- [練習成長](progression-practice-based-growth.md)

## 參考來源

- [Death costs trained abilities — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/progression-death-loses-training/) — 查閱：2026-11-02；取得方式：page-text。
