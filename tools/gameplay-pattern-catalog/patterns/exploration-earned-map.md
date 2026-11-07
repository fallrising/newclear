---
{
  "schema_version": 2,
  "id": "exploration-earned-map",
  "title": "掙得地圖",
  "title_en": "Earned map information",
  "category": "exploration",
  "source_category": "exploration",
  "tags": [
    "information",
    "discovery",
    "planning"
  ],
  "summary": "地图不是开局全知，而是需要主动获取的探索成果。",
  "note_status": "draft",
  "related": [
    "exploration-ability-gates",
    "exploration-fast-travel-network",
    "exploration-procedural-route-reading",
    "gathering-depth-targeting"
  ],
  "sources": [
    {
      "title": "Earned map information — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/exploration-earned-map/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「地图不是开局全知，而是需要主动获取的探索成果。」
出處：`sources/text/exploration-earned-map.json` 字元 179-202 `summary.zh`
顯示：地圖不是開局全知，而是需要主動獲取的探索成果。

## 規則

「玩家先在不完整信息下移动，再通过寻找地图、测绘或据点更新获得区域信息。地图降低重复迷路成本，却保留未探索支路；信息获取本身成为有价值的目标。」
出處：`sources/text/exploration-earned-map.json` 字元 303-373 `rules.zh`
顯示：玩家先在不完整信息下移動，再通過尋找地圖、測繪或據點更新獲得區域信息。地圖降低重複迷路成本，卻保留未探索支路；信息獲取本身成爲有價值的目標。

## 核心循環

「在未知区域辨认地标」
出處：`sources/text/exploration-earned-map.json` 字元 627-636 `loop[0].zh`
顯示：在未知區域辨認地標

「寻找地图或记录条件」
出處：`sources/text/exploration-earned-map.json` 字元 713-722 `loop[1].zh`
顯示：尋找地圖或記錄條件

「更新已知空间」
出處：`sources/text/exploration-earned-map.json` 字元 786-792 `loop[2].zh`
顯示：更新已知空間

「据此选择新路线」
出處：`sources/text/exploration-earned-map.json` 字元 854-861 `loop[3].zh`
顯示：據此選擇新路線

## 玩家取捨

「先绕路补地图，还是带着不确定性直接深入？」
出處：`sources/text/exploration-earned-map.json` 字元 947-967 `decisions[0].zh`
顯示：先繞路補地圖，還是帶着不確定性直接深入？

「已经知道主路后，还要不要为未标明的支路消耗补给？」
出處：`sources/text/exploration-earned-map.json` 字元 1071-1095 `decisions[1].zh`
顯示：已經知道主路後，還要不要爲未標明的支路消耗補給？

## 可調參數

「更新时机」
出處：`sources/text/exploration-earned-map.json` 字元 1258-1262 `parameters[0].name.zh`
顯示：更新時機

「实时更新方便导航，回到据点才更新会强调记忆与风险。」
出處：`sources/text/exploration-earned-map.json` 字元 1337-1362 `parameters[0].effect.zh`
顯示：實時更新方便導航，回到據點才更新會強調記憶與風險。

「信息粒度」
出處：`sources/text/exploration-earned-map.json` 字元 1507-1511 `parameters[1].name.zh`

「只给地形保留观察空间，连奖励都标注则偏向任务清单。」
出處：`sources/text/exploration-earned-map.json` 字元 1591-1616 `parameters[1].effect.zh`
顯示：只給地形保留觀察空間，連獎勵都標註則偏向任務清單。

## 原型

「做六个房间的地图、未发现遮罩和一个能揭示区域的节点。」
出處：`sources/text/exploration-earned-map.json` 字元 3110-3136 `prototype.firstStep.zh`
顯示：做六個房間的地圖、未發現遮罩和一個能揭示區域的節點。

「比较获得地图前后的路线，观察玩家是否减少重复迷路又继续探索支路。」
出處：`sources/text/exploration-earned-map.json` 字元 3437-3469 `prototype.test.zh`
顯示：比較獲得地圖前後的路線，觀察玩家是否減少重複迷路又繼續探索支路。

「地图一次揭示全部奖励会削弱现场观察；先区分路线信息与秘密信息。」
出處：`sources/text/exploration-earned-map.json` 字元 3266-3297 `prototype.pitfall.zh`
顯示：地圖一次揭示全部獎勵會削弱現場觀察；先區分路線信息與祕密信息。

## 相關模式

- [能力解鎖與回訪](exploration-ability-gates.md)
- [快速旅行網路](exploration-fast-travel-network.md)
- [程序路線判讀](exploration-procedural-route-reading.md)
- [深度鎖定層](gathering-depth-targeting.md)

## 參考來源

- [Earned map information — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/exploration-earned-map/) — 查閱：2026-11-02；取得方式：page-text。
