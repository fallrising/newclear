---
{
  "schema_version": 2,
  "id": "cooking-meal-loadout",
  "title": "餐點配置組",
  "title_en": "Meal buff loadouts",
  "category": "cooking",
  "source_category": "cooking",
  "tags": [
    "planning",
    "progression",
    "optimization"
  ],
  "summary": "根据下一段活动配餐，而不是永远吃数值最高的一道。",
  "note_status": "draft",
  "related": [
    "cooking-ingredient-substitution",
    "cooking-preparation-chain",
    "combat-combat-deck-cycle",
    "combat-part-destruction"
  ],
  "sources": [
    {
      "title": "Meal buff loadouts — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooking-meal-loadout/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「根据下一段活动配餐，而不是永远吃数值最高的一道。」
出處：`sources/text/cooking-meal-loadout.json` 字元 167-191 `summary.zh`
顯示：根據下一段活動配餐，而不是永遠喫數值最高的一道。

## 規則

「不同食物提供不同持续增益，且同时生效数量或覆盖规则有限制。玩家预测接下来的战斗、奔跑或采集需求，选餐并管理持续时间；换餐有材料和机会成本。」
出處：`sources/text/cooking-meal-loadout.json` 字元 316-385 `rules.zh`
顯示：不同食物提供不同持續增益，且同時生效數量或覆蓋規則有限制。玩家預測接下來的戰鬥、奔跑或採集需求，選餐並管理持續時間；換餐有材料和機會成本。

## 核心循環

「确定下次行动」
出處：`sources/text/cooking-meal-loadout.json` 字元 647-653 `loop[0].zh`
顯示：確定下次行動

「比较增益与时长」
出處：`sources/text/cooking-meal-loadout.json` 字元 721-728 `loop[1].zh`
顯示：比較增益與時長

「搭配并食用」
出處：`sources/text/cooking-meal-loadout.json` 字元 800-805 `loop[2].zh`
顯示：搭配並食用

「行动后评估配餐」
出處：`sources/text/cooking-meal-loadout.json` 字元 863-870 `loop[3].zh`
顯示：行動後評估配餐

## 玩家取捨

「需要更高生命保命，还是更多耐力支持操作？」
出處：`sources/text/cooking-meal-loadout.json` 字元 963-983 `decisions[0].zh`
顯示：需要更高生命保命，還是更多耐力支持操作？

「现在补充更适合的食物，是否覆盖了尚未用完的增益？」
出處：`sources/text/cooking-meal-loadout.json` 字元 1080-1104 `decisions[1].zh`
顯示：現在補充更適合的食物，是否覆蓋了尚未用完的增益？

## 可調參數

「同时生效上限」
出處：`sources/text/cooking-meal-loadout.json` 字元 1253-1259 `parameters[0].name.zh`
顯示：同時生效上限

「较少槽位迫使取舍；无限叠加会把选择变成材料囤积。」
出處：`sources/text/cooking-meal-loadout.json` 字元 1344-1368 `parameters[0].effect.zh`
顯示：較少槽位迫使取捨；無限疊加會把選擇變成材料囤積。

「效果持续时间」
出處：`sources/text/cooking-meal-loadout.json` 字元 1507-1513 `parameters[1].name.zh`
顯示：效果持續時間

「短效果鼓励临场选择；长效果让出发前计划更重要。」
出處：`sources/text/cooking-meal-loadout.json` 字元 1590-1613 `parameters[1].effect.zh`
顯示：短效果鼓勵臨場選擇；長效果讓出發前計劃更重要。

## 原型

「做3种食物、2个生效槽和两种需求不同的短关卡，效果与持续时间都直接可见。」
出處：`sources/text/cooking-meal-loadout.json` 字元 3089-3125 `prototype.firstStep.zh`
顯示：做3種食物、2個生效槽和兩種需求不同的短關卡，效果與持續時間都直接可見。

「把同一玩家从长跑关切换到危险战斗关，检查他是否主动换配餐。」
出處：`sources/text/cooking-meal-loadout.json` 字元 3455-3484 `prototype.test.zh`
顯示：把同一玩家從長跑關切換到危險戰鬥關，檢查他是否主動換配餐。

「不要让一份食物同时在所有指标上更强，否则配餐会退化成按等级替换。」
出處：`sources/text/cooking-meal-loadout.json` 字元 3292-3324 `prototype.pitfall.zh`
顯示：不要讓一份食物同時在所有指標上更強，否則配餐會退化成按等級替換。

## 相關模式

- [食材替換](cooking-ingredient-substitution.md)
- [備料連鎖](cooking-preparation-chain.md)
- [戰鬥牌組循環](combat-combat-deck-cycle.md)
- [部位破壞](combat-part-destruction.md)

## 參考來源

- [Meal buff loadouts — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooking-meal-loadout/) — 查閱：2026-11-02；取得方式：page-text。
