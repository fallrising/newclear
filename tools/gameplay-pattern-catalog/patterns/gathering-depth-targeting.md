---
{
  "schema_version": 2,
  "id": "gathering-depth-targeting",
  "title": "深度鎖定層",
  "title_en": "Depth-targeted mining",
  "category": "gathering",
  "source_category": "gathering",
  "tags": [
    "planning",
    "risk",
    "discovery"
  ],
  "summary": "去更深不一定更好，先确定你缺哪一种矿。",
  "note_status": "draft",
  "related": [
    "gathering-gathering-quota",
    "gathering-oxygen-gathering",
    "gathering-renewable-forage-route",
    "gathering-salvage-dismantling"
  ],
  "sources": [
    {
      "title": "Depth-targeted mining — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/gathering-depth-targeting/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「去更深不一定更好，先确定你缺哪一种矿。」
出處：`sources/text/gathering-depth-targeting.json` 字元 178-197 `summary.zh`
顯示：去更深不一定更好，先確定你缺哪一種礦。

## 規則

「不同深度或地层有不同资源分布与危险组合。玩家根据配方缺口选目标层，再在时间、补给与撤退距离约束下开采；层级信息把单纯深入变成有目的的路线选择。」
出處：`sources/text/gathering-depth-targeting.json` 字元 308-379 `rules.zh`
顯示：不同深度或地層有不同資源分佈與危險組合。玩家根據配方缺口選目標層，再在時間、補給與撤退距離約束下開採；層級信息把單純深入變成有目的的路線選擇。

## 核心循環

「确定所需矿物」
出處：`sources/text/gathering-depth-targeting.json` 字元 676-682 `loop[0].zh`
顯示：確定所需礦物

「选择对应地层」
出處：`sources/text/gathering-depth-targeting.json` 字元 753-759 `loop[1].zh`
顯示：選擇對應地層

「抵达并开采」
出處：`sources/text/gathering-depth-targeting.json` 字元 828-833 `loop[2].zh`
顯示：抵達並開採

「按剩余补给返回」
出處：`sources/text/gathering-depth-targeting.json` 字元 894-901 `loop[3].zh`
顯示：按剩餘補給返回

## 玩家取捨

「为稀有矿深入，还是留在浅层完成当前升级？」
出處：`sources/text/gathering-depth-targeting.json` 字元 990-1010 `decisions[0].zh`
顯示：爲稀有礦深入，還是留在淺層完成當前升級？

「寻找通往下一层的入口，会不会错过当前最需要的矿？」
出處：`sources/text/gathering-depth-targeting.json` 字元 1123-1147 `decisions[1].zh`
顯示：尋找通往下一層的入口，會不會錯過當前最需要的礦？

## 可調參數

「分布重叠度」
出處：`sources/text/gathering-depth-targeting.json` 字元 1301-1306 `parameters[0].name.zh`
顯示：分佈重疊度

「重叠少使地层知识更重要；重叠多允许随意探索也有收获。」
出處：`sources/text/gathering-depth-targeting.json` 字元 1388-1414 `parameters[0].effect.zh`
顯示：重疊少使地層知識更重要；重疊多允許隨意探索也有收穫。

「返程便利度」
出處：`sources/text/gathering-depth-targeting.json` 字元 1577-1582 `parameters[1].name.zh`

「快捷返回降低深入风险；长距离回撤要求提前留余量。」
出處：`sources/text/gathering-depth-targeting.json` 字元 1662-1686 `parameters[1].effect.zh`
顯示：快捷返回降低深入風險；長距離回撤要求提前留餘量。

## 原型

「做三层矿区选择页，列出主要资源、危险与返程成本，用目标配方驱动选择。」
出處：`sources/text/gathering-depth-targeting.json` 字元 3223-3257 `prototype.firstStep.zh`
顯示：做三層礦區選擇頁，列出主要資源、危險與返程成本，用目標配方驅動選擇。

「把目标配方从铜改成铁，玩家是否能据此换层，而非一直追求最深处？」
出處：`sources/text/gathering-depth-targeting.json` 字元 3613-3644 `prototype.test.zh`
顯示：把目標配方從銅改成鐵，玩家是否能據此換層，而非一直追求最深處？

「若深层对所有目标都更优，选层会失去意义；不同材料需要保留各自目的地。」
出處：`sources/text/gathering-depth-targeting.json` 字元 3416-3450 `prototype.pitfall.zh`
顯示：若深層對所有目標都更優，選層會失去意義；不同材料需要保留各自目的地。

## 相關模式

- [採集配額決策](gathering-gathering-quota.md)
- [氧氣採集決策](gathering-oxygen-gathering.md)
- [再生資源採食路線](gathering-renewable-forage-route.md)
- [拆件拆解](gathering-salvage-dismantling.md)

## 參考來源

- [Depth-targeted mining — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/gathering-depth-targeting/) — 查閱：2026-11-02；取得方式：page-text。
