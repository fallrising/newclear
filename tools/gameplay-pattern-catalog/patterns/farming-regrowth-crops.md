---
{
  "schema_version": 2,
  "id": "farming-regrowth-crops",
  "title": "再生作物群",
  "title_en": "Regrowing crops",
  "category": "farming",
  "source_category": "farming",
  "tags": [
    "planning",
    "economy",
    "time"
  ],
  "summary": "一次建立植株，之后反复回收较小的收益。",
  "note_status": "draft",
  "related": [
    "farming-orchard-investment",
    "farming-season-window",
    "commerce-timed-contracts",
    "farming-growth-care"
  ],
  "sources": [
    {
      "title": "Regrowing crops — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/farming-regrowth-crops/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「一次建立植株，之后反复回收较小的收益。」
出處：`sources/text/farming-regrowth-crops.json` 字元 166-185 `summary.zh`
顯示：一次建立植株，之後反覆回收較小的收益。

## 規則

「部分作物首次成熟较慢，但采收后植株继续存在，并在下一段周期再次产出。玩家持续占用土地和照料资源，换取不必每轮重新购买种子的长期收益。」
出處：`sources/text/farming-regrowth-crops.json` 字元 292-358 `rules.zh`
顯示：部分作物首次成熟較慢，但採收後植株繼續存在，並在下一段週期再次產出。玩家持續佔用土地和照料資源，換取不必每輪重新購買種子的長期收益。

## 核心循環

「比较首次成熟与再生时间」
出處：`sources/text/farming-regrowth-crops.json` 字元 601-612 `loop[0].zh`
顯示：比較首次成熟與再生時間

「提前种下并照料」
出處：`sources/text/farming-regrowth-crops.json` 字元 691-698 `loop[1].zh`
顯示：提前種下並照料

「采收但保留植株」
出處：`sources/text/farming-regrowth-crops.json` 字元 766-773 `loop[2].zh`
顯示：採收但保留植株

「判断保留还是改种」
出處：`sources/text/farming-regrowth-crops.json` 字元 850-858 `loop[3].zh`
顯示：判斷保留還是改種

## 玩家取捨

「越早种下越能摊薄初始投入；季末再种可能毫无优势。」
出處：`sources/text/farming-regrowth-crops.json` 字元 956-980 `decisions[0].zh`
顯示：越早種下越能攤薄初始投入；季末再種可能毫無優勢。

「成熟旧作物稳定赚钱，但可能阻挡更符合当前需求的新作物。」
出處：`sources/text/farming-regrowth-crops.json` 字元 1108-1135 `decisions[1].zh`
顯示：成熟舊作物穩定賺錢，但可能阻擋更符合當前需求的新作物。

## 可調參數

「首次成熟时间」
出處：`sources/text/farming-regrowth-crops.json` 字元 1304-1310 `parameters[0].name.zh`
顯示：首次成熟時間

「越长越强调提前布局，并提高换种成本。」
出處：`sources/text/farming-regrowth-crops.json` 字元 1388-1406 `parameters[0].effect.zh`
顯示：越長越強調提前佈局，並提高換種成本。

「再生间隔」
出處：`sources/text/farming-regrowth-crops.json` 字元 1547-1551 `parameters[1].name.zh`
顯示：再生間隔

「短间隔产生稳定任务，长间隔更适合并行副业。」
出處：`sources/text/farming-regrowth-crops.json` 字元 1630-1651 `parameters[1].effect.zh`
顯示：短間隔產生穩定任務，長間隔更適合並行副業。

## 原型

「做一株可重复采收的植物和一株一次收获植物，明确区分首次成熟与再生计时。」
出處：`sources/text/farming-regrowth-crops.json` 字元 3094-3129 `prototype.firstStep.zh`
顯示：做一株可重複採收的植物和一株一次收穫植物，明確區分首次成熟與再生計時。

「检查玩家是否理解“收获没有清空地块”，并会把已成熟植株的价值算进换种决策。」
出處：`sources/text/farming-regrowth-crops.json` 字元 3452-3489 `prototype.test.zh`
顯示：檢查玩家是否理解“收穫沒有清空地塊”，並會把已成熟植株的價值算進換種決策。

「长期收益若只靠隐藏公式，玩家容易误判；先把未来几次收获显示出来。」
出處：`sources/text/farming-regrowth-crops.json` 字元 3282-3314 `prototype.pitfall.zh`
顯示：長期收益若只靠隱藏公式，玩家容易誤判；先把未來幾次收穫顯示出來。

## 相關模式

- [果樹投入](farming-orchard-investment.md)
- [季節窗口](farming-season-window.md)
- [限時合約](commerce-timed-contracts.md)
- [照料排程與延遲收成](farming-growth-care.md)

## 參考來源

- [Regrowing crops — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/farming-regrowth-crops/) — 查閱：2026-11-02；取得方式：page-text。
