---
{
  "schema_version": 2,
  "id": "progression-research-prerequisites",
  "title": "研究前置",
  "title_en": "Research prerequisite chains",
  "category": "progression",
  "source_category": "progression",
  "tags": [
    "planning",
    "progression",
    "economy"
  ],
  "summary": "研究不是单独等进度条，而是安排一条解锁路线。",
  "note_status": "draft",
  "related": [
    "progression-respec-investment",
    "progression-challenge-tiers",
    "progression-death-loses-training",
    "progression-evolution-recipes"
  ],
  "sources": [
    {
      "title": "Research prerequisite chains — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/progression-research-prerequisites/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「研究不是单独等进度条，而是安排一条解锁路线。」
出處：`sources/text/progression-research-prerequisites.json` 字元 201-223 `summary.zh`
顯示：研究不是單獨等進度條，而是安排一條解鎖路線。

## 規則

「新技术要求先完成指定研究，再投入研究资源或人员时间。玩家从多个目标中选当前最值得解锁的一项，研究完成后用新能力改善生产或生活，再支持下一轮研究。」
出處：`sources/text/progression-research-prerequisites.json` 字元 328-400 `rules.zh`
顯示：新技術要求先完成指定研究，再投入研究資源或人員時間。玩家從多個目標中選當前最值得解鎖的一項，研究完成後用新能力改善生產或生活，再支持下一輪研究。

## 核心循環

「从目标倒查前置条件」
出處：`sources/text/progression-research-prerequisites.json` 字元 670-679 `loop[0].zh`
顯示：從目標倒查前置條件

「分配研究资源与人手」
出處：`sources/text/progression-research-prerequisites.json` 字元 753-762 `loop[1].zh`
顯示：分配研究資源與人手

「完成研究获得新做法」
出處：`sources/text/progression-research-prerequisites.json` 字元 834-843 `loop[2].zh`
顯示：完成研究獲得新做法

「利用新能力支持后续研究」
出處：`sources/text/progression-research-prerequisites.json` 字元 906-917 `loop[3].zh`
顯示：利用新能力支持後續研究

## 玩家取捨

「先做立刻缓解问题的技术，还是先完成通向远期目标的前置？」
出處：`sources/text/progression-research-prerequisites.json` 字元 1014-1041 `decisions[0].zh`
顯示：先做立刻緩解問題的技術，還是先完成通向遠期目標的前置？

「把材料和人手给研究，还是维持眼前生产？」
出處：`sources/text/progression-research-prerequisites.json` 字元 1153-1172 `decisions[1].zh`
顯示：把材料和人手給研究，還是維持眼前生產？

## 可調參數

「前置链长度」
出處：`sources/text/progression-research-prerequisites.json` 字元 1332-1337 `parameters[0].name.zh`
顯示：前置鏈長度

「链条越长，长期规划越重要，但目标收益必须足够清楚。」
出處：`sources/text/progression-research-prerequisites.json` 字元 1417-1442 `parameters[0].effect.zh`
顯示：鏈條越長，長期規劃越重要，但目標收益必須足夠清楚。

「研究与生产的资源重叠」
出處：`sources/text/progression-research-prerequisites.json` 字元 1581-1591 `parameters[1].name.zh`
顯示：研究與生產的資源重疊

「两者争用同一种材料时，研发速度会变成可见的生产取舍。」
出處：`sources/text/progression-research-prerequisites.json` 字元 1674-1700 `parameters[1].effect.zh`
顯示：兩者爭用同一種材料時，研發速度會變成可見的生產取捨。

## 原型

「做六个研究节点、两种资源和一名研究员；完成节点后立刻开放可操作的新生产按钮。」
出處：`sources/text/progression-research-prerequisites.json` 字元 3298-3336 `prototype.firstStep.zh`
顯示：做六個研究節點、兩種資源和一名研究員；完成節點後立刻開放可操作的新生產按鈕。

「玩家能否从目标技术说出下一步缺什么，并因生产压力改变研究顺序？」
出處：`sources/text/progression-research-prerequisites.json` 字元 3685-3716 `prototype.test.zh`
顯示：玩家能否從目標技術說出下一步缺什麼，並因生產壓力改變研究順序？

「别先画上百节点；需要先验证前置、资源消耗和新产出的关系确实互相影响。」
出處：`sources/text/progression-research-prerequisites.json` 字元 3500-3534 `prototype.pitfall.zh`
顯示：別先畫上百節點；需要先驗證前置、資源消耗和新產出的關係確實互相影響。

## 相關模式

- [重配投入](progression-respec-investment.md)
- [挑戰層級](progression-challenge-tiers.md)
- [死亡失去訓練](progression-death-loses-training.md)
- [進化配方鏈](progression-evolution-recipes.md)

## 參考來源

- [Research prerequisite chains — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/progression-research-prerequisites/) — 查閱：2026-11-02；取得方式：page-text。
