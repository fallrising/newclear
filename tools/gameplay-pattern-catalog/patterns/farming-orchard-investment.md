---
{
  "schema_version": 2,
  "id": "farming-orchard-investment",
  "title": "果樹投入",
  "title_en": "Long-term orchards",
  "category": "farming",
  "source_category": "farming",
  "tags": [
    "planning",
    "economy",
    "time"
  ],
  "summary": "以漫长成熟期和固定占地，换取重复采摘。",
  "note_status": "draft",
  "related": [
    "farming-regrowth-crops",
    "farming-season-window",
    "commerce-timed-contracts",
    "farming-growth-care"
  ],
  "sources": [
    {
      "title": "Long-term orchards — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/farming-orchard-investment/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「以漫长成熟期和固定占地，换取重复采摘。」
出處：`sources/text/farming-orchard-investment.json` 字元 173-192 `summary.zh`
顯示：以漫長成熟期和固定佔地，換取重複採摘。

## 規則

「玩家种下树苗或果实，等待树木长成后定期采摘。树木占用空间且回报延迟，成长与产果条件可能不同；砍掉果树能回收土地，却会失去已完成的成长投资。」
出處：`sources/text/farming-orchard-investment.json` 字元 310-379 `rules.zh`
顯示：玩家種下樹苗或果實，等待樹木長成後定期採摘。樹木佔用空間且回報延遲，成長與產果條件可能不同；砍掉果樹能回收土地，卻會失去已完成的成長投資。

## 核心循環

「规划果园位置」
出處：`sources/text/farming-orchard-investment.json` 字元 657-663 `loop[0].zh`
顯示：規劃果園位置

「种植并保持成长条件」
出處：`sources/text/farming-orchard-investment.json` 字元 729-738 `loop[1].zh`
顯示：種植並保持成長條件

「等待成熟」
出處：`sources/text/farming-orchard-investment.json` 字元 819-823 `loop[2].zh`

「周期采摘并评估扩种」
出處：`sources/text/farming-orchard-investment.json` 字元 884-893 `loop[3].zh`
顯示：週期採摘並評估擴種

## 玩家取捨

「早期钱少时，果树会锁住资金；长期经营则降低反复买种的负担。」
出處：`sources/text/farming-orchard-investment.json` 字元 999-1028 `decisions[0].zh`
顯示：早期錢少時，果樹會鎖住資金；長期經營則降低反覆買種的負擔。

「多种几棵会增加未来收益，还是少种一排保留通路，让每次采摘更快？」
出處：`sources/text/farming-orchard-investment.json` 字元 1169-1200 `decisions[1].zh`
顯示：多種幾棵會增加未來收益，還是少種一排保留通路，讓每次採摘更快？

## 可調參數

「成熟期」
出處：`sources/text/farming-orchard-investment.json` 字元 1368-1371 `parameters[0].name.zh`

「越长越需要提前投资，也越怕重新布局。」
出處：`sources/text/farming-orchard-investment.json` 字元 1448-1466 `parameters[0].effect.zh`
顯示：越長越需要提前投資，也越怕重新佈局。

「产果季限制」
出處：`sources/text/farming-orchard-investment.json` 字元 1600-1605 `parameters[1].name.zh`
顯示：產果季限制

「季节性产果强调多品种搭配，全年产果强调稳定物流。」
出處：`sources/text/farming-orchard-investment.json` 字元 1682-1706 `parameters[1].effect.zh`
顯示：季節性產果強調多品種搭配，全年產果強調穩定物流。

## 原型

「做“幼树／成熟／待采”三态和一个定期支出，先验证等待是否产生压力。」
出處：`sources/text/farming-orchard-investment.json` 字元 3214-3247 `prototype.firstStep.zh`
顯示：做“幼樹／成熟／待採”三態和一個定期支出，先驗證等待是否產生壓力。

「观察玩家是否会保留周转金，而非开局把钱全部换成树苗。」
出處：`sources/text/farming-orchard-investment.json` 字元 3580-3606 `prototype.test.zh`
顯示：觀察玩家是否會保留週轉金，而非開局把錢全部換成樹苗。

「漫长等待若没有其他可做的决策，会成为纯计时器；先给玩家短期资金安排。」
出處：`sources/text/farming-orchard-investment.json` 字元 3398-3432 `prototype.pitfall.zh`
顯示：漫長等待若沒有其他可做的決策，會成爲純計時器；先給玩家短期資金安排。

## 相關模式

- [再生作物群](farming-regrowth-crops.md)
- [季節窗口](farming-season-window.md)
- [限時合約](commerce-timed-contracts.md)
- [照料排程與延遲收成](farming-growth-care.md)

## 參考來源

- [Long-term orchards — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/farming-orchard-investment/) — 查閱：2026-11-02；取得方式：page-text。
