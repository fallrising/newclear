---
{
  "schema_version": 2,
  "id": "farming-season-window",
  "title": "季節窗口",
  "title_en": "Seasonal planting windows",
  "category": "farming",
  "source_category": "farming",
  "tags": [
    "planning",
    "time",
    "economy"
  ],
  "summary": "让收成的截止日期，比种子价格更值得考虑。",
  "note_status": "draft",
  "related": [
    "farming-orchard-investment",
    "farming-regrowth-crops",
    "commerce-timed-contracts",
    "farming-growth-care"
  ],
  "sources": [
    {
      "title": "Seasonal planting windows — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/farming-season-window/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「让收成的截止日期，比种子价格更值得考虑。」
出處：`sources/text/farming-season-window.json` 字元 175-195 `summary.zh`
顯示：讓收成的截止日期，比種子價格更值得考慮。

## 規則

「玩家根据当前季节和剩余天数选择作物。作物需要在适宜季节完成成长；跨季后无法继续的作物会失去后续收益，因此播种前必须倒排收获日期。」
出處：`sources/text/farming-season-window.json` 字元 294-358 `rules.zh`
顯示：玩家根據當前季節和剩餘天數選擇作物。作物需要在適宜季節完成成長；跨季後無法繼續的作物會失去後續收益，因此播種前必須倒排收穫日期。

## 核心循環

「查看季节与剩余天数」
出處：`sources/text/farming-season-window.json` 字元 593-602 `loop[0].zh`
顯示：查看季節與剩餘天數

「计算能完成的收获次数」
出處：`sources/text/farming-season-window.json` 字元 681-691 `loop[1].zh`
顯示：計算能完成的收穫次數

「买种并播种」
出處：`sources/text/farming-season-window.json` 字元 761-766 `loop[2].zh`
顯示：買種並播種

「季末收获或换种」
出處：`sources/text/farming-season-window.json` 字元 829-836 `loop[3].zh`
顯示：季末收穫或換種

## 玩家取捨

「高价长周期作物未必适合季末；短周期作物能填补空档。」
出處：`sources/text/farming-season-window.json` 字元 933-958 `decisions[0].zh`
顯示：高價長週期作物未必適合季末；短週期作物能填補空檔。

「多季作物减少换季损失，但可能占用下一季更有利的土地。」
出處：`sources/text/farming-season-window.json` 字元 1078-1104 `decisions[1].zh`
顯示：多季作物減少換季損失，但可能佔用下一季更有利的土地。

## 可調參數

「季节长度」
出處：`sources/text/farming-season-window.json` 字元 1284-1288 `parameters[0].name.zh`
顯示：季節長度

「短季节要求精确规划，长季节允许更松弛的经营。」
出處：`sources/text/farming-season-window.json` 字元 1363-1385 `parameters[0].effect.zh`
顯示：短季節要求精確規劃，長季節允許更鬆弛的經營。

「跨季惩罚」
出處：`sources/text/farming-season-window.json` 字元 1528-1532 `parameters[1].name.zh`
顯示：跨季懲罰

「枯萎制造明确截止线；仅减产则鼓励承担风险。」
出處：`sources/text/farming-season-window.json` 字元 1612-1633 `parameters[1].effect.zh`
顯示：枯萎製造明確截止線；僅減產則鼓勵承擔風險。

## 原型

「做一张10天日历和两种成长时长不同的作物，让玩家预览收获日期。」
出處：`sources/text/farming-season-window.json` 字元 3069-3100 `prototype.firstStep.zh`
顯示：做一張10天日曆和兩種成長時長不同的作物，讓玩家預覽收穫日期。

「改变剩余天数，检查玩家是否会换作物，并能说出“这批赶不上收获”。」
出處：`sources/text/farming-season-window.json` 字元 3443-3475 `prototype.test.zh`
顯示：改變剩餘天數，檢查玩家是否會換作物，並能說出“這批趕不上收穫”。

「不要一开始叠加天气、病害和多季节例外，否则很难判断玩家算错在哪里。」
出處：`sources/text/farming-season-window.json` 字元 3256-3289 `prototype.pitfall.zh`
顯示：不要一開始疊加天氣、病害和多季節例外，否則很難判斷玩家算錯在哪裏。

## 相關模式

- [果樹投入](farming-orchard-investment.md)
- [再生作物群](farming-regrowth-crops.md)
- [限時合約](commerce-timed-contracts.md)
- [照料排程與延遲收成](farming-growth-care.md)

## 參考來源

- [Seasonal planting windows — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/farming-season-window/) — 查閱：2026-11-02；取得方式：page-text。
