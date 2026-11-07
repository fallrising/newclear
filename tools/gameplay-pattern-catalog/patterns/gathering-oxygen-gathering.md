---
{
  "schema_version": 2,
  "id": "gathering-oxygen-gathering",
  "title": "氧氣採集決策",
  "title_en": "Oxygen-budgeted gathering",
  "category": "gathering",
  "source_category": "gathering",
  "tags": [
    "risk",
    "time",
    "planning"
  ],
  "summary": "每多拿一件东西，都在压缩安全返程时间。",
  "note_status": "draft",
  "related": [
    "gathering-depth-targeting",
    "gathering-gathering-quota",
    "gathering-renewable-forage-route",
    "gathering-salvage-dismantling"
  ],
  "sources": [
    {
      "title": "Oxygen-budgeted gathering — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/gathering-oxygen-gathering/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「每多拿一件东西，都在压缩安全返程时间。」
出處：`sources/text/gathering-oxygen-gathering.json` 字元 182-201 `summary.zh`
顯示：每多拿一件東西，都在壓縮安全返程時間。

## 規則

「水下或无空气区域的采集持续消耗氧气。玩家在目标价值、往返距离和剩余氧气之间权衡，必须及时回到补给点；升级供氧装备改变能触及的采集半径。」
出處：`sources/text/gathering-oxygen-gathering.json` 字元 305-372 `rules.zh`
顯示：水下或無空氣區域的採集持續消耗氧氣。玩家在目標價值、往返距離和剩餘氧氣之間權衡，必須及時回到補給點；升級供氧裝備改變能觸及的採集半徑。

## 核心循環

「补满氧气并选路线」
出處：`sources/text/gathering-oxygen-gathering.json` 字元 642-650 `loop[0].zh`
顯示：補滿氧氣並選路線

「沿路采集」
出處：`sources/text/gathering-oxygen-gathering.json` 字元 724-728 `loop[1].zh`
顯示：沿路採集

「预留返程余量」
出處：`sources/text/gathering-oxygen-gathering.json` 字元 794-800 `loop[2].zh`
顯示：預留返程餘量

「返回补氧」
出處：`sources/text/gathering-oxygen-gathering.json` 字元 873-877 `loop[3].zh`
顯示：返回補氧

## 玩家取捨

「继续搜一个角落，还是带着已有收获安全返回？」
出處：`sources/text/gathering-oxygen-gathering.json` 字元 959-980 `decisions[0].zh`
顯示：繼續搜一個角落，還是帶着已有收穫安全返回？

「多带氧气设备，是否挤占其他装备选择？」
出處：`sources/text/gathering-oxygen-gathering.json` 字元 1083-1101 `decisions[1].zh`
顯示：多帶氧氣設備，是否擠佔其他裝備選擇？

## 可調參數

「消耗速度」
出處：`sources/text/gathering-oxygen-gathering.json` 字元 1240-1244 `parameters[0].name.zh`

「快消耗制造短促往返；慢消耗允许长路线但降低紧迫感。」
出處：`sources/text/gathering-oxygen-gathering.json` 字元 1320-1345 `parameters[0].effect.zh`
顯示：快消耗製造短促往返；慢消耗允許長路線但降低緊迫感。

「补氧点密度」
出處：`sources/text/gathering-oxygen-gathering.json` 字元 1508-1513 `parameters[1].name.zh`
顯示：補氧點密度

「密集补给降低迷路惩罚；稀疏补给强调路线记忆。」
出處：`sources/text/gathering-oxygen-gathering.json` 字元 1589-1611 `parameters[1].effect.zh`
顯示：密集補給降低迷路懲罰；稀疏補給強調路線記憶。

## 原型

「先做节点地图、固定行动耗氧和一个补给点，把返程消耗清楚显示。」
出處：`sources/text/gathering-oxygen-gathering.json` 字元 3109-3139 `prototype.firstStep.zh`
顯示：先做節點地圖、固定行動耗氧和一個補給點，把返程消耗清楚顯示。

「剩余氧气变少时，玩家是否主动放弃眼前收益，且能解释安全余量？」
出處：`sources/text/gathering-oxygen-gathering.json` 字元 3477-3507 `prototype.test.zh`
顯示：剩餘氧氣變少時，玩家是否主動放棄眼前收益，且能解釋安全餘量？

「隐藏返程成本或氧气变化会制造突兀死亡；先让玩家能判断自己为何冒险。」
出處：`sources/text/gathering-oxygen-gathering.json` 字元 3297-3330 `prototype.pitfall.zh`
顯示：隱藏返程成本或氧氣變化會製造突兀死亡；先讓玩家能判斷自己爲何冒險。

## 相關模式

- [深度鎖定層](gathering-depth-targeting.md)
- [採集配額決策](gathering-gathering-quota.md)
- [再生資源採食路線](gathering-renewable-forage-route.md)
- [拆件拆解](gathering-salvage-dismantling.md)

## 參考來源

- [Oxygen-budgeted gathering — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/gathering-oxygen-gathering/) — 查閱：2026-11-02；取得方式：page-text。
