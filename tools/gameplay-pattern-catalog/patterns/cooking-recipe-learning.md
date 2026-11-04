---
{
  "schema_version": 2,
  "id": "cooking-recipe-learning",
  "title": "知識與材料雙重解鎖",
  "title_en": "Recipe knowledge unlocks",
  "category": "cooking",
  "source_category": "cooking",
  "tags": [
    "knowledge-gate",
    "progression",
    "resource-budget"
  ],
  "summary": "先获得做法，再把现有材料变成新的行动选项。",
  "note_status": "draft",
  "related": [
    "gathering-tool-hardness",
    "relationships-gift-allocation"
  ],
  "sources": [
    {
      "title": "Recipe knowledge unlocks — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooking-recipe-learning/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先获得做法，再把现有材料变成新的行动选项。」
出處：`sources/text/cooking-recipe-learning.json` 字元 176-197 `summary.zh`
顯示：先獲得做法，再把現有材料變成新的行動選項。

## 規則

「玩家通过节目、关系或探索学到食谱，再准备材料并在合适的设施制作。知道配方和拥有材料是两道独立门槛；新菜谱列表提供明确的成长反馈。」
出處：`sources/text/cooking-recipe-learning.json` 字元 305-369 `rules.zh`
顯示：玩家通過節目、關係或探索學到食譜，再準備材料並在合適的設施製作。知道配方和擁有材料是兩道獨立門檻；新菜譜列表提供明確的成長反饋。

## 核心循環

「发现食谱线索」
出處：`sources/text/cooking-recipe-learning.json` 字元 639-645 `loop[0].zh`
顯示：發現食譜線索

「取得配方」
出處：`sources/text/cooking-recipe-learning.json` 字元 707-711 `loop[1].zh`

「备齐食材」
出處：`sources/text/cooking-recipe-learning.json` 字元 773-777 `loop[2].zh`
顯示：備齊食材

「首次制作并解锁用途」
出處：`sources/text/cooking-recipe-learning.json` 字元 839-848 `loop[3].zh`
顯示：首次製作並解鎖用途

## 玩家取捨

「先追容易取得的食谱，还是为关键增益专门跑一趟？」
出處：`sources/text/cooking-recipe-learning.json` 字元 939-962 `decisions[0].zh`
顯示：先追容易取得的食譜，還是爲關鍵增益專門跑一趟？

「今天的时间用来找新做法，还是先收齐已学会菜谱的材料，准备明天出发？」
出處：`sources/text/cooking-recipe-learning.json` 字元 1079-1112 `decisions[1].zh`
顯示：今天的時間用來找新做法，還是先收齊已學會菜譜的材料，準備明天出發？

## 可調參數

「获取频率」
出處：`sources/text/cooking-recipe-learning.json` 字元 1296-1300 `parameters[0].name.zh`
顯示：獲取頻率

「密集解锁鼓励试菜；稀疏解锁让每张配方成为旅程奖励。」
出處：`sources/text/cooking-recipe-learning.json` 字元 1378-1403 `parameters[0].effect.zh`
顯示：密集解鎖鼓勵試菜；稀疏解鎖讓每張配方成爲旅程獎勵。

「来源可见度」
出處：`sources/text/cooking-recipe-learning.json` 字元 1560-1565 `parameters[1].name.zh`
顯示：來源可見度

「明确提示降低查攻略需求；模糊线索增加寻宝感，也会漏掉内容。」
出處：`sources/text/cooking-recipe-learning.json` 字元 1644-1673 `parameters[1].effect.zh`
顯示：明確提示降低查攻略需求；模糊線索增加尋寶感，也會漏掉內容。

## 原型

「做3张食谱卡、两个知识来源和少量材料，分别显示“不会做”和“缺材料”。」
出處：`sources/text/cooking-recipe-learning.json` 字元 3170-3205 `prototype.firstStep.zh`
顯示：做3張食譜卡、兩個知識來源和少量材料，分別顯示“不會做”和“缺材料”。

「玩家缺少目标菜时，能否判断应该先找做法，还是补食材？」
出處：`sources/text/cooking-recipe-learning.json` 字元 3567-3593 `prototype.test.zh`
顯示：玩家缺少目標菜時，能否判斷應該先找做法，還是補食材？

「食谱数量一多容易只剩清单收集；先让每道新菜解决一个清楚的行动需求。」
出處：`sources/text/cooking-recipe-learning.json` 字元 3382-3415 `prototype.pitfall.zh`
顯示：食譜數量一多容易只剩清單收集；先讓每道新菜解決一個清楚的行動需求。

## 相關模式

- [工具能力門檻](gathering-tool-hardness.md)
- [偏好探索與禮物分配](relationships-gift-allocation.md)

## 參考來源

- [Recipe knowledge unlocks — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooking-recipe-learning/) — 查閱：2026-11-02；取得方式：page-text。
