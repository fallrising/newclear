---
{
  "schema_version": 2,
  "id": "ecology-species-compatibility",
  "title": "物種共容",
  "title_en": "Plan which species can share a home",
  "category": "ecology",
  "source_category": "ecology",
  "tags": [
    "planning",
    "spatial",
    "optimization"
  ],
  "summary": "能适应同一环境，不代表彼此适合住在一起。",
  "note_status": "draft",
  "related": [
    "ecology-habitat-capacity",
    "ecology-plant-crossbreeding",
    "ecology-population-limits",
    "inventory-adjacency"
  ],
  "sources": [
    {
      "title": "Plan which species can share a home — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/ecology-species-compatibility/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「能适应同一环境，不代表彼此适合住在一起。」
出處：`sources/text/ecology-species-compatibility.json` 字元 198-218 `summary.zh`
顯示：能適應同一環境，不代表彼此適合住在一起。

## 規則

「玩家将不同物种分配到有限的栖息地，同时检查相互威胁、群居偏好或同住收益。一个新住户可能改变其他住户的安全与收益，因此要评估组合，而不是逐只独立评分。」
出處：`sources/text/ecology-species-compatibility.json` 字元 331-405 `rules.zh`
顯示：玩家將不同物種分配到有限的棲息地，同時檢查相互威脅、羣居偏好或同住收益。一個新住戶可能改變其他住戶的安全與收益，因此要評估組合，而不是逐只獨立評分。

## 核心循環

「列出候选住户与相处规则」
出處：`sources/text/ecology-species-compatibility.json` 字元 676-687 `loop[0].zh`
顯示：列出候選住戶與相處規則

「安排共享或分开的栖息地」
出處：`sources/text/ecology-species-compatibility.json` 字元 768-779 `loop[1].zh`
顯示：安排共享或分開的棲息地

「检查组合收益与冲突」
出處：`sources/text/ecology-species-compatibility.json` 字元 854-863 `loop[2].zh`
顯示：檢查組合收益與衝突

「随成长或新增物种重新分配」
出處：`sources/text/ecology-species-compatibility.json` 字元 935-947 `loop[3].zh`
顯示：隨成長或新增物種重新分配

## 玩家取捨

「共享设施节省空间，是否值得承担体型变化带来的捕食风险？」
出處：`sources/text/ecology-species-compatibility.json` 字元 1045-1072 `decisions[0].zh`
顯示：共享設施節省空間，是否值得承擔體型變化帶來的捕食風險？

「为了获得同住收益增加一个物种，还是维持照料更简单的单一群体？」
出處：`sources/text/ecology-species-compatibility.json` 字元 1190-1220 `decisions[1].zh`
顯示：爲了獲得同住收益增加一個物種，還是維持照料更簡單的單一羣體？

## 可調參數

「关系规则可见度」
出處：`sources/text/ecology-species-compatibility.json` 字元 1383-1390 `parameters[0].name.zh`
顯示：關係規則可見度

「放入之前就显示明确冲突，能让损失来自玩家取舍而不是知识陷阱。」
出處：`sources/text/ecology-species-compatibility.json` 字元 1475-1505 `parameters[0].effect.zh`
顯示：放入之前就顯示明確衝突，能讓損失來自玩家取捨而不是知識陷阱。

「关系随成长变化」
出處：`sources/text/ecology-species-compatibility.json` 字元 1671-1678 `parameters[1].name.zh`
顯示：關係隨成長變化

「幼体时兼容、成年后有冲突，会要求玩家提前准备分居空间。」
出處：`sources/text/ecology-species-compatibility.json` 字元 1770-1797 `parameters[1].effect.zh`
顯示：幼體時兼容、成年後有衝突，會要求玩家提前準備分居空間。

## 原型

「用四个物种、两个栖息地和一张可见关系表，先只做一种冲突与一种奖励。」
出處：`sources/text/ecology-species-compatibility.json` 字元 3307-3340 `prototype.firstStep.zh`
顯示：用四個物種、兩個棲息地和一張可見關係表，先只做一種衝突與一種獎勵。

「加入一个会改变原有组合的新物种，看玩家是否重排现有住户。」
出處：`sources/text/ecology-species-compatibility.json` 字元 3661-3689 `prototype.test.zh`
顯示：加入一個會改變原有組合的新物種，看玩家是否重排現有住戶。

「关系数量随物种平方增长；不要靠堆物种数量制造深度。」
出處：`sources/text/ecology-species-compatibility.json` 字元 3492-3517 `prototype.pitfall.zh`
顯示：關係數量隨物種平方增長；不要靠堆物種數量製造深度。

## 相關模式

- [棲地容量](ecology-habitat-capacity.md)
- [植物雜交](ecology-plant-crossbreeding.md)
- [族群限制](ecology-population-limits.md)
- [相鄰關係驅動的組合加成](inventory-adjacency.md)

## 參考來源

- [Plan which species can share a home — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/ecology-species-compatibility/) — 查閱：2026-11-02；取得方式：page-text。
