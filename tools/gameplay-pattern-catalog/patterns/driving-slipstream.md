---
{
  "schema_version": 2,
  "id": "driving-slipstream",
  "title": "尾流跟車加速",
  "title_en": "Follow a lead vehicle to gain speed",
  "category": "driving",
  "source_category": "driving",
  "tags": [
    "spatial",
    "timing",
    "risk"
  ],
  "summary": "先保持追随位置取得速度优势，再找机会侧移超车。",
  "note_status": "draft",
  "related": [
    "driving-air-stunt",
    "driving-drift-boost",
    "cooperation-downed-revival",
    "cooperation-synchronized-triggers"
  ],
  "sources": [
    {
      "title": "Follow a lead vehicle to gain speed — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/driving-slipstream/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先保持追随位置取得速度优势，再找机会侧移超车。」
出處：`sources/text/driving-slipstream.json` 字元 185-208 `summary.zh`
顯示：先保持追隨位置取得速度優勢，再找機會側移超車。

## 規則

「前车后方形成有利的跟随区域，后车进入并保持位置，便可降低阻力或触发短时加速。玩家随后选择继续跟随，还是趁速度差侧移超越。不同实现可能采用连续的空气阻力变化，也可能采用计时后发放的加速奖励。」
出處：`sources/text/driving-slipstream.json` 字元 318-412 `rules.zh`
顯示：前車後方形成有利的跟隨區域，後車進入並保持位置，便可降低阻力或觸發短時加速。玩家隨後選擇繼續跟隨，還是趁速度差側移超越。不同實現可能採用連續的空氣阻力變化，也可能採用計時後發放的加速獎勵。

## 核心循環

「找到前车的跟随区域」
出處：`sources/text/driving-slipstream.json` 字元 748-757 `loop[0].zh`
顯示：找到前車的跟隨區域

「保持距离与对齐」
出處：`sources/text/driving-slipstream.json` 字元 824-831 `loop[1].zh`
顯示：保持距離與對齊

「观察速度差和前方空间」
出處：`sources/text/driving-slipstream.json` 字元 902-912 `loop[2].zh`
顯示：觀察速度差和前方空間

「侧移超车或继续跟随」
出處：`sources/text/driving-slipstream.json` 字元 989-998 `loop[3].zh`
顯示：側移超車或繼續跟隨

## 玩家取捨

「继续跟随积累优势，还是在路变窄前立刻超车？」
出處：`sources/text/driving-slipstream.json` 字元 1097-1118 `decisions[0].zh`
顯示：繼續跟隨積累優勢，還是在路變窄前立刻超車？

「前车将要刹车，还值得紧跟吗？」
出處：`sources/text/driving-slipstream.json` 字元 1226-1240 `decisions[1].zh`
顯示：前車將要剎車，還值得緊跟嗎？

## 可調參數

「有效跟随范围」
出處：`sources/text/driving-slipstream.json` 字元 1386-1392 `parameters[0].name.zh`
顯示：有效跟隨範圍

「范围越窄越考验对齐；过宽会让跟随几乎无需操作。」
出處：`sources/text/driving-slipstream.json` 字元 1468-1491 `parameters[0].effect.zh`
顯示：範圍越窄越考驗對齊；過寬會讓跟隨幾乎無需操作。

「收益形成方式」
出處：`sources/text/driving-slipstream.json` 字元 1635-1641 `parameters[1].name.zh`

「持续减阻鼓励长期选位；延时加速会制造等待完成再超车的节点。」
出處：`sources/text/driving-slipstream.json` 字元 1724-1753 `parameters[1].effect.zh`
顯示：持續減阻鼓勵長期選位；延時加速會製造等待完成再超車的節點。

## 原型

「用两条车道、一辆固定速度的前车和一个跟随区域，不必先做完整竞速对手。」
出處：`sources/text/driving-slipstream.json` 字元 3322-3356 `prototype.firstStep.zh`
顯示：用兩條車道、一輛固定速度的前車和一個跟隨區域，不必先做完整競速對手。

「玩家是否会为超车时机主动离开最佳跟随位置？」
出處：`sources/text/driving-slipstream.json` 字元 3667-3688 `prototype.test.zh`
顯示：玩家是否會爲超車時機主動離開最佳跟隨位置？

「前车减速与碰撞距离必须清楚，否则跟随失败会显得随机。」
出處：`sources/text/driving-slipstream.json` 字元 3505-3531 `prototype.pitfall.zh`
顯示：前車減速與碰撞距離必須清楚，否則跟隨失敗會顯得隨機。

## 相關模式

- [空中特技](driving-air-stunt.md)
- [漂移加速](driving-drift-boost.md)
- [倒地救起](cooperation-downed-revival.md)
- [同步觸發組](cooperation-synchronized-triggers.md)

## 參考來源

- [Follow a lead vehicle to gain speed — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/driving-slipstream/) — 查閱：2026-11-02；取得方式：page-text。
