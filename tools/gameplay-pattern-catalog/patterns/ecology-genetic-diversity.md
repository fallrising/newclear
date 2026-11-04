---
{
  "schema_version": 2,
  "id": "ecology-genetic-diversity",
  "title": "遺傳多樣性",
  "title_en": "Preserve genetic diversity",
  "category": "ecology",
  "source_category": "ecology",
  "tags": [
    "planning",
    "information",
    "progression"
  ],
  "summary": "只留下最优秀的一家，可能让后续配对越来越困难。",
  "note_status": "draft",
  "related": [
    "ecology-breeding-conditions",
    "ecology-parent-trait-selection",
    "ecology-animal-taming",
    "ecology-habitat-capacity"
  ],
  "sources": [
    {
      "title": "Preserve genetic diversity — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/ecology-genetic-diversity/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「只留下最优秀的一家，可能让后续配对越来越困难。」
出處：`sources/text/ecology-genetic-diversity.json` 字元 183-206 `summary.zh`
顯示：只留下最優秀的一家，可能讓後續配對越來越困難。

## 規則

「种群不仅需要当前强壮个体，还需要可持续配对的差异。玩家检查亲缘或关键基因，保留不同来源的成员，并在短期表现与长期繁殖选择之间取舍。」
出處：`sources/text/ecology-genetic-diversity.json` 字元 318-383 `rules.zh`
顯示：種羣不僅需要當前強壯個體，還需要可持續配對的差異。玩家檢查親緣或關鍵基因，保留不同來源的成員，並在短期表現與長期繁殖選擇之間取捨。

## 核心循環

「查看现有血缘与关键基因」
出處：`sources/text/ecology-genetic-diversity.json` 字元 654-665 `loop[0].zh`
顯示：查看現有血緣與關鍵基因

「找出过度集中或冲突的组合」
出處：`sources/text/ecology-genetic-diversity.json` 字元 739-751 `loop[1].zh`
顯示：找出過度集中或衝突的組合

「保留外来或少见个体」
出處：`sources/text/ecology-genetic-diversity.json` 字元 840-849 `loop[2].zh`
顯示：保留外來或少見個體

「在下一代重新检查配对空间」
出處：`sources/text/ecology-genetic-diversity.json` 字元 926-938 `loop[3].zh`
顯示：在下一代重新檢查配對空間

## 玩家取捨

「引入数值普通但血缘不同的个体，还是继续繁殖现有优秀家族？」
出處：`sources/text/ecology-genetic-diversity.json` 字元 1041-1069 `decisions[0].zh`
顯示：引入數值普通但血緣不同的個體，還是繼續繁殖現有優秀家族？

「空间不足时保留少见基因，还是优先留下当前贡献最大的成员？」
出處：`sources/text/ecology-genetic-diversity.json` 字元 1200-1228 `decisions[1].zh`
顯示：空間不足時保留少見基因，還是優先留下當前貢獻最大的成員？

## 可調參數

「重复基因的后果」
出處：`sources/text/ecology-genetic-diversity.json` 字元 1387-1394 `parameters[0].name.zh`
顯示：重複基因的後果

「后果应可提前推断，不能到出生后才给出无从避免的惩罚。」
出處：`sources/text/ecology-genetic-diversity.json` 字元 1478-1504 `parameters[0].effect.zh`
顯示：後果應可提前推斷，不能到出生後纔給出無從避免的懲罰。

「外来个体获得成本」
出處：`sources/text/ecology-genetic-diversity.json` 字元 1658-1666 `parameters[1].name.zh`
顯示：外來個體獲得成本

「外来来源越难获得，保留现有多样性的长期价值越高。」
出處：`sources/text/ecology-genetic-diversity.json` 字元 1741-1765 `parameters[1].effect.zh`
顯示：外來來源越難獲得，保留現有多樣性的長期價值越高。

## 原型

「先用三种可见基因标记和有限栏位，明确提示哪种配对有风险。」
出處：`sources/text/ecology-genetic-diversity.json` 字元 3212-3240 `prototype.firstStep.zh`
顯示：先用三種可見基因標記和有限欄位，明確提示哪種配對有風險。

「给一只数值较弱的外来个体，看玩家是否因未来配对价值主动保留它。」
出處：`sources/text/ecology-genetic-diversity.json` 字元 3564-3595 `prototype.test.zh`
顯示：給一隻數值較弱的外來個體，看玩家是否因未來配對價值主動保留它。

「家谱会迅速变成信息负担；先做两代关系和直接配对提示。」
出處：`sources/text/ecology-genetic-diversity.json` 字元 3383-3409 `prototype.pitfall.zh`
顯示：家譜會迅速變成信息負擔；先做兩代關係和直接配對提示。

## 相關模式

- [繁育條件組](ecology-breeding-conditions.md)
- [親代性狀選拔](ecology-parent-trait-selection.md)
- [動物馴養](ecology-animal-taming.md)
- [棲地容量](ecology-habitat-capacity.md)

## 參考來源

- [Preserve genetic diversity — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/ecology-genetic-diversity/) — 查閱：2026-11-02；取得方式：page-text。
