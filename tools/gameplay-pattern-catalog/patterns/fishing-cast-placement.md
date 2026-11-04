---
{
  "schema_version": 2,
  "id": "fishing-cast-placement",
  "title": "拋投放置",
  "title_en": "Choosing a cast location",
  "category": "fishing",
  "source_category": "fishing",
  "tags": [
    "spatial",
    "precision",
    "planning"
  ],
  "summary": "一次出手前，把距离、角度和鱼的位置考虑进去。",
  "note_status": "draft",
  "related": [
    "fishing-equipment-access",
    "fishing-bait-loadout",
    "fishing-bite-window",
    "fishing-habitat-search"
  ],
  "sources": [
    {
      "title": "Choosing a cast location — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/fishing-cast-placement/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「一次出手前，把距离、角度和鱼的位置考虑进去。」
出處：`sources/text/fishing-cast-placement.json` 字元 175-197 `summary.zh`
顯示：一次出手前，把距離、角度和魚的位置考慮進去。

## 規則

「玩家调整站位或蓄力，把浮标投向有价值的位置。距离过短、落点偏离或靠岸太近可能降低效率；反馈来自落点、水面标记与鱼的接近行为，而非只看是否按下按钮。」
出處：`sources/text/fishing-cast-placement.json` 字元 308-381 `rules.zh`
顯示：玩家調整站位或蓄力，把浮標投向有價值的位置。距離過短、落點偏離或靠岸太近可能降低效率；反饋來自落點、水面標記與魚的接近行爲，而非只看是否按下按鈕。

## 核心循環

「观察岸线与水面」
出處：`sources/text/fishing-cast-placement.json` 字元 629-636 `loop[0].zh`
顯示：觀察岸線與水面

「调整站位与抛投力度」
出處：`sources/text/fishing-cast-placement.json` 字元 706-715 `loop[1].zh`
顯示：調整站位與拋投力度

「确认落点」
出處：`sources/text/fishing-cast-placement.json` 字元 792-796 `loop[2].zh`
顯示：確認落點

「等待或收回重投」
出處：`sources/text/fishing-cast-placement.json` 字元 863-870 `loop[3].zh`

## 玩家取捨

「追求最远距离可能错过近处的特殊水面，远不等于好。」
出處：`sources/text/fishing-cast-placement.json` 字元 949-973 `decisions[0].zh`
顯示：追求最遠距離可能錯過近處的特殊水面，遠不等於好。

「移动到更合适的岸边有时间成本，但可能省下多次空等。」
出處：`sources/text/fishing-cast-placement.json` 字元 1096-1121 `decisions[1].zh`
顯示：移動到更合適的岸邊有時間成本，但可能省下多次空等。

## 可調參數

「落点容错」
出處：`sources/text/fishing-cast-placement.json` 字元 1274-1278 `parameters[0].name.zh`
顯示：落點容錯

「大范围有效区适合放松，小范围热点鼓励瞄准。」
出處：`sources/text/fishing-cast-placement.json` 字元 1359-1380 `parameters[0].effect.zh`
顯示：大範圍有效區適合放鬆，小範圍熱點鼓勵瞄準。

「重投成本」
出處：`sources/text/fishing-cast-placement.json` 字元 1513-1517 `parameters[1].name.zh`

「免费重投鼓励练习，消耗体力或时间则增加承诺感。」
出處：`sources/text/fishing-cast-placement.json` 字元 1590-1613 `parameters[1].effect.zh`
顯示：免費重投鼓勵練習，消耗體力或時間則增加承諾感。

## 原型

「做一块平面水域、可见目标圆和蓄力抛投抛物线，先用静止目标。」
出處：`sources/text/fishing-cast-placement.json` 字元 2999-3028 `prototype.firstStep.zh`
顯示：做一塊平面水域、可見目標圓和蓄力拋投拋物線，先用靜止目標。

「连续三次抛投后，玩家能否有方向地调整力度与站位，让落点更接近目标？」
出處：`sources/text/fishing-cast-placement.json` 字元 3362-3395 `prototype.test.zh`
顯示：連續三次拋投後，玩家能否有方向地調整力度與站位，讓落點更接近目標？

「风向、移动鱼群与复杂岸线同时加入，会让玩家不知道哪项造成偏差。」
出處：`sources/text/fishing-cast-placement.json` 字元 3188-3219 `prototype.pitfall.zh`
顯示：風向、移動魚羣與複雜岸線同時加入，會讓玩家不知道哪項造成偏差。

## 相關模式

- [裝備進出](fishing-equipment-access.md)
- [餌配置組](fishing-bait-loadout.md)
- [訊號辨識與反應窗口](fishing-bite-window.md)
- [棲地搜尋](fishing-habitat-search.md)

## 參考來源

- [Choosing a cast location — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/fishing-cast-placement/) — 查閱：2026-11-02；取得方式：page-text。
