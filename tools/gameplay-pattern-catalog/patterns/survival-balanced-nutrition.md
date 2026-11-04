---
{
  "schema_version": 2,
  "id": "survival-balanced-nutrition",
  "title": "均衡營養",
  "title_en": "Food balance and nutrition",
  "category": "survival",
  "source_category": "survival",
  "tags": [
    "planning",
    "economy"
  ],
  "summary": "吃饱之后，还要考虑食物补充了什么，以及长期只吃一种东西的代价。",
  "note_status": "draft",
  "related": [
    "cooking-food-preservation",
    "cooking-ingredient-substitution",
    "survival-bleeding-triage",
    "survival-competing-needs"
  ],
  "sources": [
    {
      "title": "Food balance and nutrition — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/survival-balanced-nutrition/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「吃饱之后，还要考虑食物补充了什么，以及长期只吃一种东西的代价。」
出處：`sources/text/survival-balanced-nutrition.json` 字元 186-217 `summary.zh`
顯示：喫飽之後，還要考慮食物補充了什麼，以及長期只喫一種東西的代價。

## 規則

「不同食物补充不同营养或热量，角色状态会根据一段时间的摄入变化。玩家需要调整食物组合，而不是只找回复最多的食物；具体后果必须在界面里解释清楚。」
出處：`sources/text/survival-balanced-nutrition.json` 字元 345-415 `rules.zh`
顯示：不同食物補充不同營養或熱量，角色狀態會根據一段時間的攝入變化。玩家需要調整食物組合，而不是隻找回復最多的食物；具體後果必須在界面裏解釋清楚。

## 核心循環

「查看缺少的营养或能量」
出處：`sources/text/survival-balanced-nutrition.json` 字元 668-678 `loop[0].zh`
顯示：查看缺少的營養或能量

「寻找互补食材」
出處：`sources/text/survival-balanced-nutrition.json` 字元 757-763 `loop[1].zh`
顯示：尋找互補食材

「分配并吃下食物」
出處：`sources/text/survival-balanced-nutrition.json` 字元 831-838 `loop[2].zh`
顯示：分配並喫下食物

「根据状态变化调整下一餐」
出處：`sources/text/survival-balanced-nutrition.json` 字元 904-915 `loop[3].zh`
顯示：根據狀態變化調整下一餐

## 玩家取捨

「背包只剩一个位置，要补短缺营养还是囤常见食物？」
出處：`sources/text/survival-balanced-nutrition.json` 字元 1016-1039 `decisions[0].zh`
顯示：揹包只剩一個位置，要補短缺營養還是囤常見食物？

「现在吃下高热量食物，还是留给下一次长途行动？」
出處：`sources/text/survival-balanced-nutrition.json` 字元 1149-1171 `decisions[1].zh`
顯示：現在喫下高熱量食物，還是留給下一次長途行動？

## 可調參數

「缺项后果」
出處：`sources/text/survival-balanced-nutrition.json` 字元 1310-1314 `parameters[0].name.zh`
顯示：缺項後果

「缺项影响体力、状态上限或长期体重，会产生不同节奏；不要把所有后果都叠上。」
出處：`sources/text/survival-balanced-nutrition.json` 字元 1398-1434 `parameters[0].effect.zh`
顯示：缺項影響體力、狀態上限或長期體重，會產生不同節奏；不要把所有後果都疊上。

「食物互补程度」
出處：`sources/text/survival-balanced-nutrition.json` 字元 1611-1617 `parameters[1].name.zh`
顯示：食物互補程度

「每种食物都能补全部需求时，搭配选择会消失。」
出處：`sources/text/survival-balanced-nutrition.json` 字元 1699-1720 `parameters[1].effect.zh`
顯示：每種食物都能補全部需求時，搭配選擇會消失。

## 原型

「用三类营养、六种食物和一个清楚显示缺项的面板开始。」
出處：`sources/text/survival-balanced-nutrition.json` 字元 3101-3126 `prototype.firstStep.zh`
顯示：用三類營養、六種食物和一個清楚顯示缺項的面板開始。

「给两组库存，观察玩家能否说明为什么要换一道食物。」
出處：`sources/text/survival-balanced-nutrition.json` 字元 3436-3460 `prototype.test.zh`
顯示：給兩組庫存，觀察玩家能否說明爲什麼要換一道食物。

「不要先模拟真实人体；只保留玩家能读懂并据此换食物的因果。」
出處：`sources/text/survival-balanced-nutrition.json` 字元 3248-3276 `prototype.pitfall.zh`
顯示：不要先模擬真實人體；只保留玩家能讀懂並據此換食物的因果。

## 相關模式

- [食物保存](cooking-food-preservation.md)
- [食材替換](cooking-ingredient-substitution.md)
- [失血分診](survival-bleeding-triage.md)
- [競爭需求](survival-competing-needs.md)

## 參考來源

- [Food balance and nutrition — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/survival-balanced-nutrition/) — 查閱：2026-11-02；取得方式：page-text。
