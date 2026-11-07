---
{
  "schema_version": 2,
  "id": "defense-tower-upgrade-budget",
  "title": "塔升級預算",
  "title_en": "Upgrade deeply or build wider",
  "category": "defense",
  "source_category": "defense",
  "tags": [
    "economy",
    "spatial",
    "optimization"
  ],
  "summary": "同样的钱，是把一个好位置变强，还是在另一处增加覆盖？",
  "note_status": "draft",
  "related": [
    "defense-ammunition-supply",
    "defense-maze-routing",
    "commerce-dynamic-market",
    "commerce-shop-display"
  ],
  "sources": [
    {
      "title": "Upgrade deeply or build wider — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/defense-tower-upgrade-budget/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「同样的钱，是把一个好位置变强，还是在另一处增加覆盖？」
出處：`sources/text/defense-tower-upgrade-budget.json` 字元 189-215 `summary.zh`
顯示：同樣的錢，是把一個好位置變強，還是在另一處增加覆蓋？

## 規則

「塔位、道路覆盖和资金都有限，玩家需要在新建与升级之间分配资源。升级保留已有位置并提高能力，新建增加覆盖或分工；敌人的种类与行进路线决定哪一种投入更有用，防线表现随波次被检验。」
出處：`sources/text/defense-tower-upgrade-budget.json` 字元 334-421 `rules.zh`
顯示：塔位、道路覆蓋和資金都有限，玩家需要在新建與升級之間分配資源。升級保留已有位置並提高能力，新建增加覆蓋或分工；敵人的種類與行進路線決定哪一種投入更有用，防線表現隨波次被檢驗。

## 核心循環

「找出当前防线的瓶颈」
出處：`sources/text/defense-tower-upgrade-budget.json` 字元 749-758 `loop[0].zh`
顯示：找出當前防線的瓶頸

「比较升级和新建收益」
出處：`sources/text/defense-tower-upgrade-budget.json` 字元 833-842 `loop[1].zh`
顯示：比較升級和新建收益

「把钱投入一个选择」
出處：`sources/text/defense-tower-upgrade-budget.json` 字元 917-925 `loop[2].zh`
顯示：把錢投入一個選擇

「观察覆盖或输出是否改善」
出處：`sources/text/defense-tower-upgrade-budget.json` 字元 996-1007 `loop[3].zh`
顯示：觀察覆蓋或輸出是否改善

## 玩家取捨

「好位置上的高等级塔能充分开火，但钱集中在一处会照顾不到新路线。」
出處：`sources/text/defense-tower-upgrade-budget.json` 字元 1113-1144 `decisions[0].zh`
顯示：好位置上的高等級塔能充分開火，但錢集中在一處會照顧不到新路線。

「为当前波次买便宜塔更稳，攒钱升级则可能在后续更有效。」
出處：`sources/text/defense-tower-upgrade-budget.json` 字元 1291-1317 `decisions[1].zh`
顯示：爲當前波次買便宜塔更穩，攢錢升級則可能在後續更有效。

## 可調參數

「升级性价比曲线」
出處：`sources/text/defense-tower-upgrade-budget.json` 字元 1504-1511 `parameters[0].name.zh`
顯示：升級性價比曲線

「后级越划算，越鼓励集中投资；边际收益下降则鼓励铺开布局。」
出處：`sources/text/defense-tower-upgrade-budget.json` 字元 1597-1625 `parameters[0].effect.zh`
顯示：後級越划算，越鼓勵集中投資；邊際收益下降則鼓勵鋪開佈局。

「有效塔位数量」
出處：`sources/text/defense-tower-upgrade-budget.json` 字元 1794-1800 `parameters[1].name.zh`
顯示：有效塔位數量

「优质位置稀少时升级更关键；位置丰富时新建的空间选择更重要。」
出處：`sources/text/defense-tower-upgrade-budget.json` 字元 1888-1917 `parameters[1].effect.zh`
顯示：優質位置稀少時升級更關鍵；位置豐富時新建的空間選擇更重要。

## 原型

「做三个固定塔位和两级升级，让一波敌人走主路、一波走支路。」
出處：`sources/text/defense-tower-upgrade-budget.json` 字元 3579-3607 `prototype.firstStep.zh`
顯示：做三個固定塔位和兩級升級，讓一波敵人走主路、一波走支路。

「能否找到至少两种来敌安排，使“升级”和“新建”分别成为合理答案？」
出處：`sources/text/defense-tower-upgrade-budget.json` 字元 3948-3980 `prototype.test.zh`
顯示：能否找到至少兩種來敵安排，使“升級”和“新建”分別成爲合理答案？

「不用先做几十种塔；重点是两种花钱方式都在某种情况下值得选。」
出處：`sources/text/defense-tower-upgrade-budget.json` 字元 3773-3802 `prototype.pitfall.zh`
顯示：不用先做幾十種塔；重點是兩種花錢方式都在某種情況下值得選。

## 相關模式

- [彈藥供給](defense-ammunition-supply.md)
- [路徑路由](defense-maze-routing.md)
- [動態市場](commerce-dynamic-market.md)
- [商店陳列](commerce-shop-display.md)

## 參考來源

- [Upgrade deeply or build wider — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/defense-tower-upgrade-budget/) — 查閱：2026-11-02；取得方式：page-text。
