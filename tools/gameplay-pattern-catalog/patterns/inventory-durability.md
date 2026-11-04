---
{
  "schema_version": 2,
  "id": "inventory-durability",
  "title": "工具耐久與維護決策",
  "title_en": "Tool durability and maintenance",
  "category": "inventory",
  "source_category": "inventory",
  "tags": [
    "planning",
    "risk",
    "time"
  ],
  "summary": "工具会耗尽，出发前必须估算它能撑多久。",
  "note_status": "draft",
  "related": [
    "inventory-light-reserve",
    "gathering-oxygen-gathering",
    "inventory-death-retrieval",
    "inventory-weight-budget"
  ],
  "sources": [
    {
      "title": "Tool durability and maintenance — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/inventory-durability/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「工具会耗尽，出发前必须估算它能撑多久。」
出處：`sources/text/inventory-durability.json` 字元 183-202 `summary.zh`
顯示：工具會耗盡，出發前必須估算它能撐多久。

## 規則

「使用工具或承受伤害会降低耐久，归零后无法继续正常使用。玩家准备备用件、寻找修理条件或制造替代品；耐久条让一次远行逐渐接近维护节点。」
出處：`sources/text/inventory-durability.json` 字元 305-370 `rules.zh`
顯示：使用工具或承受傷害會降低耐久，歸零後無法繼續正常使用。玩家準備備用件、尋找修理條件或製造替代品；耐久條讓一次遠行逐漸接近維護節點。

## 核心循環

「检查剩余耐久」
出處：`sources/text/inventory-durability.json` 字元 624-630 `loop[0].zh`
顯示：檢查剩餘耐久

「执行采集或战斗」
出處：`sources/text/inventory-durability.json` 字元 700-707 `loop[1].zh`
顯示：執行採集或戰鬥

「判断还能否继续」
出處：`sources/text/inventory-durability.json` 字元 766-773 `loop[2].zh`
顯示：判斷還能否繼續

「修理或替换工具」
出處：`sources/text/inventory-durability.json` 字元 842-849 `loop[3].zh`
顯示：修理或替換工具

## 玩家取捨

「备用工具占空间，但能避免提前返程，带不带？」
出處：`sources/text/inventory-durability.json` 字元 931-952 `decisions[0].zh`
顯示：備用工具佔空間，但能避免提前返程，帶不帶？

「现在回去修理最稳，继续挖下一处矿能否撑到收工？」
出處：`sources/text/inventory-durability.json` 字元 1067-1090 `decisions[1].zh`
顯示：現在回去修理最穩，繼續挖下一處礦能否撐到收工？

## 可調參數

「修理消耗」
出處：`sources/text/inventory-durability.json` 字元 1249-1253 `parameters[0].name.zh`

「免费修理偏向路线管理；材料收费同时产生资源回流。」
出處：`sources/text/inventory-durability.json` 字元 1326-1350 `parameters[0].effect.zh`
顯示：免費修理偏向路線管理；材料收費同時產生資源迴流。

「损坏结果」
出處：`sources/text/inventory-durability.json` 字元 1496-1500 `parameters[1].name.zh`
顯示：損壞結果

「保留坏工具鼓励回收；直接消失则提高准备压力。」
出處：`sources/text/inventory-durability.json` 字元 1574-1596 `parameters[1].effect.zh`
顯示：保留壞工具鼓勵回收；直接消失則提高準備壓力。

## 原型

「做一把工具、固定使用损耗、一处修理点和明确的剩余使用提示。」
出處：`sources/text/inventory-durability.json` 字元 3084-3113 `prototype.firstStep.zh`
顯示：做一把工具、固定使用損耗、一處修理點和明確的剩餘使用提示。

「提供短途与长途任务，观察玩家是否改变修理和备件安排。」
出處：`sources/text/inventory-durability.json` 字元 3427-3453 `prototype.test.zh`
顯示：提供短途與長途任務，觀察玩家是否改變修理和備件安排。

「不要只增加频繁点击修理；维护需要影响出发准备或路线才有取舍。」
出處：`sources/text/inventory-durability.json` 字元 3261-3291 `prototype.pitfall.zh`
顯示：不要只增加頻繁點擊修理；維護需要影響出發準備或路線纔有取捨。

## 相關模式

- [消耗型光源的存量](inventory-light-reserve.md)
- [氧氣採集決策](gathering-oxygen-gathering.md)
- [死亡取回](inventory-death-retrieval.md)
- [重量預算](inventory-weight-budget.md)

## 參考來源

- [Tool durability and maintenance — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/inventory-durability/) — 查閱：2026-11-02；取得方式：page-text。
