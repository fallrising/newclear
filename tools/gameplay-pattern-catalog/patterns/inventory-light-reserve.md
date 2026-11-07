---
{
  "schema_version": 2,
  "id": "inventory-light-reserve",
  "title": "消耗型光源的存量",
  "title_en": "Consumable light reserves",
  "category": "inventory",
  "source_category": "inventory",
  "tags": [
    "risk",
    "time",
    "planning"
  ],
  "summary": "光既提供安全，也占用有限补给。",
  "note_status": "draft",
  "related": [
    "inventory-durability",
    "inventory-death-retrieval",
    "inventory-weight-budget",
    "stealth-knockout-window"
  ],
  "sources": [
    {
      "title": "Consumable light reserves — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/inventory-light-reserve/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「光既提供安全，也占用有限补给。」
出處：`sources/text/inventory-light-reserve.json` 字元 181-196 `summary.zh`
顯示：光既提供安全，也佔用有限補給。

## 規則

「玩家消耗火把或燃料维持照明，越深入越接近耗尽。黑暗带来危险或规则变化，因此补光、冒险前进和返程之间形成选择；亮度或燃烧条持续显示余量。」
出處：`sources/text/inventory-light-reserve.json` 字元 280-347 `rules.zh`
顯示：玩家消耗火把或燃料維持照明，越深入越接近耗盡。黑暗帶來危險或規則變化，因此補光、冒險前進和返程之間形成選擇；亮度或燃燒條持續顯示餘量。

## 核心循環

「准备照明用品」
出處：`sources/text/inventory-light-reserve.json` 字元 616-622 `loop[0].zh`
顯示：準備照明用品

「前进并消耗光源」
出處：`sources/text/inventory-light-reserve.json` 字元 691-698 `loop[1].zh`
顯示：前進並消耗光源

「评估黑暗风险」
出處：`sources/text/inventory-light-reserve.json` 字元 768-774 `loop[2].zh`
顯示：評估黑暗風險

「补光或安全撤回」
出處：`sources/text/inventory-light-reserve.json` 字元 838-845 `loop[3].zh`
顯示：補光或安全撤回

## 玩家取捨

「把最后一支火把用于深入，还是留给返程？」
出處：`sources/text/inventory-light-reserve.json` 字元 928-947 `decisions[0].zh`
顯示：把最後一支火把用於深入，還是留給返程？

「照明不足时，去熟悉的短路线，还是冒险探索可能有补给的岔路？」
出處：`sources/text/inventory-light-reserve.json` 字元 1053-1082 `decisions[1].zh`
顯示：照明不足時，去熟悉的短路線，還是冒險探索可能有補給的岔路？

## 可調參數

「消耗触发」
出處：`sources/text/inventory-light-reserve.json` 字元 1256-1260 `parameters[0].name.zh`
顯示：消耗觸發

「随真实时间消耗造成操作压力；按步数消耗更偏计划。」
出處：`sources/text/inventory-light-reserve.json` 字元 1335-1359 `parameters[0].effect.zh`
顯示：隨真實時間消耗造成操作壓力；按步數消耗更偏計劃。

「黑暗收益」
出處：`sources/text/inventory-light-reserve.json` 字元 1512-1516 `parameters[1].name.zh`

「有额外收益会鼓励冒险；只有惩罚则强调准备。」
出處：`sources/text/inventory-light-reserve.json` 字元 1594-1615 `parameters[1].effect.zh`
顯示：有額外收益會鼓勵冒險；只有懲罰則強調準備。

## 原型

「做一条有岔路的走廊、会消耗的光源和一种清楚的黑暗惩罚。」
出處：`sources/text/inventory-light-reserve.json` 字元 3040-3067 `prototype.firstStep.zh`
顯示：做一條有岔路的走廊、會消耗的光源和一種清楚的黑暗懲罰。

「观察玩家是否在燃料耗尽前主动决定返程，而非被动等到一片漆黑。」
出處：`sources/text/inventory-light-reserve.json` 字元 3368-3398 `prototype.test.zh`
顯示：觀察玩家是否在燃料耗盡前主動決定返程，而非被動等到一片漆黑。

「纯粹看不清可能只令人烦躁；黑暗改变什么规则必须让玩家知道。」
出處：`sources/text/inventory-light-reserve.json` 字元 3208-3237 `prototype.pitfall.zh`
顯示：純粹看不清可能只令人煩躁；黑暗改變什麼規則必須讓玩家知道。

## 相關模式

- [工具耐久與維護決策](inventory-durability.md)
- [死亡取回](inventory-death-retrieval.md)
- [重量預算](inventory-weight-budget.md)
- [擊昏窗口](stealth-knockout-window.md)

## 參考來源

- [Consumable light reserves — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/inventory-light-reserve/) — 查閱：2026-11-02；取得方式：page-text。
