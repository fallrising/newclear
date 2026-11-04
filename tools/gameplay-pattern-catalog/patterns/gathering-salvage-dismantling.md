---
{
  "schema_version": 2,
  "id": "gathering-salvage-dismantling",
  "title": "拆件拆解",
  "title_en": "Dismantling for salvage",
  "category": "gathering",
  "source_category": "gathering",
  "tags": [
    "economy",
    "risk",
    "planning"
  ],
  "summary": "把已经有用途的物件拆成材料，获得资源也失去设施。",
  "note_status": "draft",
  "related": [
    "gathering-depth-targeting",
    "gathering-gathering-quota",
    "gathering-oxygen-gathering",
    "gathering-supply-mining"
  ],
  "sources": [
    {
      "title": "Dismantling for salvage — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/gathering-salvage-dismantling/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把已经有用途的物件拆成材料，获得资源也失去设施。」
出處：`sources/text/gathering-salvage-dismantling.json` 字元 183-207 `summary.zh`
顯示：把已經有用途的物件拆成材料，獲得資源也失去設施。

## 規則

「玩家拆解家具、建筑或废弃设备，获得其中一部分材料。拆解耗时并移除原物件；要比较眼前材料需求与对象未来用途，而不能把所有东西视为免费矿点。」
出處：`sources/text/gathering-salvage-dismantling.json` 字元 334-402 `rules.zh`
顯示：玩家拆解傢俱、建築或廢棄設備，獲得其中一部分材料。拆解耗時並移除原物件；要比較眼前材料需求與對象未來用途，而不能把所有東西視爲免費礦點。

## 核心循環

「检查可拆对象」
出處：`sources/text/gathering-salvage-dismantling.json` 字元 648-654 `loop[0].zh`
顯示：檢查可拆對象

「比较材料与原用途」
出處：`sources/text/gathering-salvage-dismantling.json` 字元 722-730 `loop[1].zh`
顯示：比較材料與原用途

「选择工具并拆解」
出處：`sources/text/gathering-salvage-dismantling.json` 字元 812-819 `loop[2].zh`
顯示：選擇工具並拆解

「把材料投入新用途」
出處：`sources/text/gathering-salvage-dismantling.json` 字元 889-897 `loop[3].zh`

## 玩家取捨

「拆掉庇护所的家具换燃料，是否破坏了以后返回的价值？」
出處：`sources/text/gathering-salvage-dismantling.json` 字元 981-1006 `decisions[0].zh`
顯示：拆掉庇護所的傢俱換燃料，是否破壞了以後返回的價值？

「保留设施等待使用，还是立即回收解燃眉之急？」
出處：`sources/text/gathering-salvage-dismantling.json` 字元 1113-1134 `decisions[1].zh`
顯示：保留設施等待使用，還是立即回收解燃眉之急？

## 可調參數

「材料返还比例」
出處：`sources/text/gathering-salvage-dismantling.json` 字元 1281-1287 `parameters[0].name.zh`
顯示：材料返還比例

「高返还鼓励迁移和重建；低返还让拆除更有重量。」
出處：`sources/text/gathering-salvage-dismantling.json` 字元 1366-1388 `parameters[0].effect.zh`
顯示：高返還鼓勵遷移和重建；低返還讓拆除更有重量。

「拆解耗时」
出處：`sources/text/gathering-salvage-dismantling.json` 字元 1541-1545 `parameters[1].name.zh`
顯示：拆解耗時

「长耗时把天气与敌人风险带进决策；瞬间拆解更偏建设便利。」
出處：`sources/text/gathering-salvage-dismantling.json` 字元 1627-1654 `parameters[1].effect.zh`
顯示：長耗時把天氣與敵人風險帶進決策；瞬間拆解更偏建設便利。

## 原型

「做3件用途不同的设施、固定拆解收益和一个急迫材料需求，先不用破碎物理。」
出處：`sources/text/gathering-salvage-dismantling.json` 字元 3150-3185 `prototype.firstStep.zh`
顯示：做3件用途不同的設施、固定拆解收益和一個急迫材料需求，先不用破碎物理。

「材料不足时，玩家是否比较被拆物未来用途，而不只按产出最高排序？」
出處：`sources/text/gathering-salvage-dismantling.json` 字元 3543-3574 `prototype.test.zh`
顯示：材料不足時，玩家是否比較被拆物未來用途，而不只按產出最高排序？

「如果所有可拆物都是无用垃圾，取舍会退化为清场收集；保留一部分真实用途。」
出處：`sources/text/gathering-salvage-dismantling.json` 字元 3343-3378 `prototype.pitfall.zh`
顯示：如果所有可拆物都是無用垃圾，取捨會退化爲清場收集；保留一部分真實用途。

## 相關模式

- [深度鎖定層](gathering-depth-targeting.md)
- [採集配額決策](gathering-gathering-quota.md)
- [氧氣採集決策](gathering-oxygen-gathering.md)
- [供給開採](gathering-supply-mining.md)

## 參考來源

- [Dismantling for salvage — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/gathering-salvage-dismantling/) — 查閱：2026-11-02；取得方式：page-text。
