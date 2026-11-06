---
{
  "schema_version": 2,
  "id": "cooking-judged-flavor",
  "title": "評分風味",
  "title_en": "Targeted flavor scoring",
  "category": "cooking",
  "source_category": "cooking",
  "tags": [
    "optimization",
    "information",
    "creativity"
  ],
  "summary": "同样能吃的食物，也要按评判标准决定做成什么样。",
  "note_status": "draft",
  "related": [
    "cooking-ingredient-substitution",
    "cooking-meal-loadout",
    "cooking-measurement-precision",
    "cooking-preparation-chain"
  ],
  "sources": [
    {
      "title": "Targeted flavor scoring — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooking-judged-flavor/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「同样能吃的食物，也要按评判标准决定做成什么样。」
出處：`sources/text/cooking-judged-flavor.json` 字元 173-196 `summary.zh`
顯示：同樣能喫的食物，也要按評判標準決定做成什麼樣。

## 規則

「系统给出目标风味或配方要求，玩家用配料与加工操作影响多个评分维度。端上菜后得到分项评价，下一轮据此调整；关键是理解评分标准，而非只追求总量。」
出處：`sources/text/cooking-judged-flavor.json` 字元 308-378 `rules.zh`
顯示：系統給出目標風味或配方要求，玩家用配料與加工操作影響多個評分維度。端上菜後得到分項評價，下一輪據此調整；關鍵是理解評分標準，而非只追求總量。

## 核心循環

「读取评价目标」
出處：`sources/text/cooking-judged-flavor.json` 字元 649-655 `loop[0].zh`
顯示：讀取評價目標

「选择材料与处理」
出處：`sources/text/cooking-judged-flavor.json` 字元 720-727 `loop[1].zh`
顯示：選擇材料與處理

「提交成品」
出處：`sources/text/cooking-judged-flavor.json` 字元 804-808 `loop[2].zh`

「按分项反馈改进」
出處：`sources/text/cooking-judged-flavor.json` 字元 867-874 `loop[3].zh`
顯示：按分項反饋改進

## 玩家取捨

「把时间用于补齐短板，还是继续强化已经占优的风味？」
出處：`sources/text/cooking-judged-flavor.json` 字元 971-995 `decisions[0].zh`
顯示：把時間用於補齊短板，還是繼續強化已經佔優的風味？

「为了评委偏好牺牲通用高分组合是否划算？」
出處：`sources/text/cooking-judged-flavor.json` 字元 1096-1115 `decisions[1].zh`
顯示：爲了評委偏好犧牲通用高分組合是否划算？

## 可調參數

「目标公开程度」
出處：`sources/text/cooking-judged-flavor.json` 字元 1263-1269 `parameters[0].name.zh`
顯示：目標公開程度

「公开标准使玩家可规划；隐藏偏好适合试探但要提供可读反馈。」
出處：`sources/text/cooking-judged-flavor.json` 字元 1348-1376 `parameters[0].effect.zh`
顯示：公開標準使玩家可規劃；隱藏偏好適合試探但要提供可讀反饋。

「维度权重」
出處：`sources/text/cooking-judged-flavor.json` 字元 1520-1524 `parameters[1].name.zh`
顯示：維度權重

「单一高权重会导向专精；多项均衡促使材料搭配。」
出處：`sources/text/cooking-judged-flavor.json` 字元 1601-1623 `parameters[1].effect.zh`
顯示：單一高權重會導向專精；多項均衡促使材料搭配。

## 原型

「做酸、甜、咸三维目标和4种配料，用条形反馈展示提交后的差距。」
出處：`sources/text/cooking-judged-flavor.json` 字元 3113-3143 `prototype.firstStep.zh`
顯示：做酸、甜、鹹三維目標和4種配料，用條形反饋展示提交後的差距。

「看一次评分后，玩家能否明确指出该增加或减少哪种配料？」
出處：`sources/text/cooking-judged-flavor.json` 字元 3471-3497 `prototype.test.zh`
顯示：看一次評分後，玩家能否明確指出該增加或減少哪種配料？

「评分公式若不透明，玩家只会试遍组合；先让分项反馈能指导下一次改变。」
出處：`sources/text/cooking-judged-flavor.json` 字元 3301-3334 `prototype.pitfall.zh`
顯示：評分公式若不透明，玩家只會試遍組合；先讓分項反饋能指導下一次改變。

## 相關模式

- [食材替換](cooking-ingredient-substitution.md)
- [餐點配置組](cooking-meal-loadout.md)
- [計量精度](cooking-measurement-precision.md)
- [備料連鎖](cooking-preparation-chain.md)

## 參考來源

- [Targeted flavor scoring — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooking-judged-flavor/) — 查閱：2026-11-02；取得方式：page-text。
