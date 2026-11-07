---
{
  "schema_version": 2,
  "id": "incremental-spend-held-bonus",
  "title": "花費持有加成",
  "title_en": "Spend a resource that also grants a held bonus",
  "category": "incremental",
  "source_category": "incremental",
  "tags": [
    "economy",
    "planning",
    "optimization"
  ],
  "summary": "同一份资源既是购买力，也是当前收益的一部分。",
  "note_status": "draft",
  "related": [
    "incremental-escalating-copy-price",
    "incremental-allocate-progress-capacity",
    "incremental-offline-window",
    "incremental-overlap-income-bursts"
  ],
  "sources": [
    {
      "title": "Spend a resource that also grants a held bonus — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/incremental-spend-held-bonus/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「同一份资源既是购买力，也是当前收益的一部分。」
出處：`sources/text/incremental-spend-held-bonus.json` 字元 214-236 `summary.zh`
顯示：同一份資源既是購買力，也是當前收益的一部分。

## 規則

「玩家持有某种资源时会得到持续加成，也能把它花掉换取特定升级。购买会减少余额，从而降低原有加成；新升级只有补回这部分损失才真正划算。玩家需要比较交易前后的总效果，而不是只看升级说明。」
出處：`sources/text/incremental-spend-held-bonus.json` 字元 349-439 `rules.zh`
顯示：玩家持有某種資源時會得到持續加成，也能把它花掉換取特定升級。購買會減少餘額，從而降低原有加成；新升級只有補回這部分損失才真正划算。玩家需要比較交易前後的總效果，而不是隻看升級說明。

## 核心循環

「查看持有量带来的加成」
出處：`sources/text/incremental-spend-held-bonus.json` 字元 758-768 `loop[0].zh`
顯示：查看持有量帶來的加成

「比较升级收益和失去的加成」
出處：`sources/text/incremental-spend-held-bonus.json` 字元 849-861 `loop[1].zh`
顯示：比較升級收益和失去的加成

「选择花多少或继续保留」
出處：`sources/text/incremental-spend-held-bonus.json` 字元 944-954 `loop[2].zh`
顯示：選擇花多少或繼續保留

「用总产出判断是否划算」
出處：`sources/text/incremental-spend-held-bonus.json` 字元 1033-1043 `loop[3].zh`
顯示：用總產出判斷是否划算

## 玩家取捨

「一次强升级是否值得花掉大半积蓄，让原有加成明显下降？」
出處：`sources/text/incremental-spend-held-bonus.json` 字元 1140-1166 `decisions[0].zh`
顯示：一次強升級是否值得花掉大半積蓄，讓原有加成明顯下降？

「分几次小额投入观察效果，还是攒到一次关键购买？」
出處：`sources/text/incremental-spend-held-bonus.json` 字元 1297-1320 `decisions[1].zh`
顯示：分幾次小額投入觀察效果，還是攢到一次關鍵購買？

## 可調參數

「持有加成曲线」
出處：`sources/text/incremental-spend-held-bonus.json` 字元 1475-1481 `parameters[0].name.zh`
顯示：持有加成曲線

「余额越少损失越敏感，会鼓励保留底仓；平缓曲线更容易大胆花费。」
出處：`sources/text/incremental-spend-held-bonus.json` 字元 1559-1589 `parameters[0].effect.zh`
顯示：餘額越少損失越敏感，會鼓勵保留底倉；平緩曲線更容易大膽花費。

「购买前后预览」
出處：`sources/text/incremental-spend-held-bonus.json` 字元 1751-1757 `parameters[1].name.zh`
顯示：購買前後預覽

「展示净变化能让取舍来自策略，而不是心算或误读。」
出處：`sources/text/incremental-spend-held-bonus.json` 字元 1843-1866 `parameters[1].effect.zh`
顯示：展示淨變化能讓取捨來自策略，而不是心算或誤讀。

## 原型

「只做一种既可持有加成又可消费的货币和两种升级，提供购买前后预览。」
出處：`sources/text/incremental-spend-held-bonus.json` 字元 3422-3454 `prototype.firstStep.zh`
顯示：只做一種既可持有加成又可消費的貨幣和兩種升級，提供購買前後預覽。

「玩家能否解释为什么有的升级现在买反而变弱？」
出處：`sources/text/incremental-spend-held-bonus.json` 字元 3739-3760 `prototype.test.zh`
顯示：玩家能否解釋爲什麼有的升級現在買反而變弱？

「不能只显示升级百分比而隐藏被扣掉的原有加成。」
出處：`sources/text/incremental-spend-held-bonus.json` 字元 3589-3611 `prototype.pitfall.zh`
顯示：不能只顯示升級百分比而隱藏被扣掉的原有加成。

## 相關模式

- [複本愈多愈貴](incremental-escalating-copy-price.md)
- [分配進度容量](incremental-allocate-progress-capacity.md)
- [離線窗口](incremental-offline-window.md)
- [重疊收入爆發段](incremental-overlap-income-bursts.md)

## 參考來源

- [Spend a resource that also grants a held bonus — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/incremental-spend-held-bonus/) — 查閱：2026-11-02；取得方式：page-text。
