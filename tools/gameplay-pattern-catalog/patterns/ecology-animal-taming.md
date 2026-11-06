---
{
  "schema_version": 2,
  "id": "ecology-animal-taming",
  "title": "動物馴養",
  "title_en": "Gradually tame wild animals",
  "category": "ecology",
  "source_category": "ecology",
  "tags": [
    "timing",
    "planning"
  ],
  "summary": "想把野生动物变成长期伙伴，先要提供食物并处理它的戒备。",
  "note_status": "draft",
  "related": [
    "ecology-breeding-conditions",
    "ecology-genetic-diversity",
    "ecology-habitat-capacity",
    "ecology-parent-trait-selection"
  ],
  "sources": [
    {
      "title": "Gradually tame wild animals — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/ecology-animal-taming/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「想把野生动物变成长期伙伴，先要提供食物并处理它的戒备。」
出處：`sources/text/ecology-animal-taming.json` 字元 182-209 `summary.zh`
顯示：想把野生動物變成長期夥伴，先要提供食物並處理它的戒備。

## 規則

「驯化需要反复接近、喂食或维持安全环境。动物的野性、警戒和处理者能力会影响进度或成功率；玩家要投入资源，并决定何时靠近、何时退开。」
出處：`sources/text/ecology-animal-taming.json` 字元 327-391 `rules.zh`
顯示：馴化需要反覆接近、餵食或維持安全環境。動物的野性、警戒和處理者能力會影響進度或成功率；玩家要投入資源，並決定何時靠近、何時退開。

## 核心循環

「挑选目标并准备食物与空间」
出處：`sources/text/ecology-animal-taming.json` 字元 636-648 `loop[0].zh`
顯示：挑選目標並準備食物與空間

「创造可接近的条件」
出處：`sources/text/ecology-animal-taming.json` 字元 734-742 `loop[1].zh`
顯示：創造可接近的條件

「尝试驯化并观察反应」
出處：`sources/text/ecology-animal-taming.json` 字元 817-826 `loop[2].zh`
顯示：嘗試馴化並觀察反應

「继续投入或换目标」
出處：`sources/text/ecology-animal-taming.json` 字元 906-914 `loop[3].zh`
顯示：繼續投入或換目標

## 玩家取捨

「先驯化容易成功但帮助有限的动物，还是冒险处理更有价值的目标？」
出處：`sources/text/ecology-animal-taming.json` 字元 1022-1052 `decisions[0].zh`
顯示：先馴化容易成功但幫助有限的動物，還是冒險處理更有價值的目標？

「继续接近争取进度，还是退开让它恢复平静？」
出處：`sources/text/ecology-animal-taming.json` 字元 1164-1184 `decisions[1].zh`
顯示：繼續接近爭取進度，還是退開讓它恢復平靜？

## 可調參數

「驯化可预测程度」
出處：`sources/text/ecology-animal-taming.json` 字元 1325-1332 `parameters[0].name.zh`
顯示：馴化可預測程度

「积累进度便于规划，概率尝试强调资源预算；失败反馈都必须清楚。」
出處：`sources/text/ecology-animal-taming.json` 字元 1408-1438 `parameters[0].effect.zh`
顯示：積累進度便於規劃，概率嘗試強調資源預算；失敗反饋都必須清楚。

「中断条件」
出處：`sources/text/ecology-animal-taming.json` 字元 1622-1626 `parameters[1].name.zh`
顯示：中斷條件

「饥饿、惊吓或处理者能力分别要求不同的准备动作。」
出處：`sources/text/ecology-animal-taming.json` 字元 1711-1734 `parameters[1].effect.zh`
顯示：飢餓、驚嚇或處理者能力分別要求不同的準備動作。

## 原型

「做一个动物、平静与受惊两种状态、一种食物和可见进度条。」
出處：`sources/text/ecology-animal-taming.json` 字元 3064-3091 `prototype.firstStep.zh`
顯示：做一個動物、平靜與受驚兩種狀態、一種食物和可見進度條。

「不弹操作答案，观察玩家能否从动物反应学会退开并等待。」
出處：`sources/text/ecology-animal-taming.json` 字元 3379-3405 `prototype.test.zh`
顯示：不彈操作答案，觀察玩家能否從動物反應學會退開並等待。

「不要先做复杂动物AI；先保证玩家能看懂什么行为打断进度。」
出處：`sources/text/ecology-animal-taming.json` 字元 3223-3251 `prototype.pitfall.zh`
顯示：不要先做複雜動物AI；先保證玩家能看懂什麼行爲打斷進度。

## 相關模式

- [繁育條件組](ecology-breeding-conditions.md)
- [遺傳多樣性](ecology-genetic-diversity.md)
- [棲地容量](ecology-habitat-capacity.md)
- [親代性狀選拔](ecology-parent-trait-selection.md)

## 參考來源

- [Gradually tame wild animals — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/ecology-animal-taming/) — 查閱：2026-11-02；取得方式：page-text。
