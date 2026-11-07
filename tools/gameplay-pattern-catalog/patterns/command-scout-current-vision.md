---
{
  "schema_version": 2,
  "id": "command-scout-current-vision",
  "title": "偵察當下視野",
  "title_en": "Send scouts to reveal current information",
  "category": "command",
  "source_category": "command",
  "tags": [
    "information",
    "risk"
  ],
  "summary": "地图上去过，不等于现在知道敌人在哪。",
  "note_status": "draft",
  "related": [
    "command-interrupt-action",
    "command-focus-fire",
    "command-frontline-shielding",
    "command-initiative-order"
  ],
  "sources": [
    {
      "title": "Send scouts to reveal current information — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/command-scout-current-vision/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「地图上去过，不等于现在知道敌人在哪。」
出處：`sources/text/command-scout-current-vision.json` 字元 203-221 `summary.zh`
顯示：地圖上去過，不等於現在知道敵人在哪。

## 規則

「未探索区域或视野外敌人被隐藏，玩家派单位前进获得信息，再决定主力是否跟上。侦察占用人员和时间，也可能暴露侦察者；静态地形记忆与当前敌情要分开显示。」
出處：`sources/text/command-scout-current-vision.json` 字元 329-402 `rules.zh`
顯示：未探索區域或視野外敵人被隱藏，玩家派單位前進獲得信息，再決定主力是否跟上。偵察佔用人員和時間，也可能暴露偵察者；靜態地形記憶與當前敵情要分開顯示。

## 核心循環

「识别信息盲区」
出處：`sources/text/command-scout-current-vision.json` 字元 699-705 `loop[0].zh`
顯示：識別信息盲區

「派出侦察单位」
出處：`sources/text/command-scout-current-vision.json` 字元 770-776 `loop[1].zh`
顯示：派出偵察單位

「读取新出现的威胁」
出處：`sources/text/command-scout-current-vision.json` 字元 832-840 `loop[2].zh`
顯示：讀取新出現的威脅

「据此推进或撤回」
出處：`sources/text/command-scout-current-vision.json` 字元 905-912 `loop[3].zh`
顯示：據此推進或撤回

## 玩家取捨

「让快单位独自深入，还是让主力靠近保护它？」
出處：`sources/text/command-scout-current-vision.json` 字元 1007-1027 `decisions[0].zh`
顯示：讓快單位獨自深入，還是讓主力靠近保護它？

「为了提前知道侧路情况，是否放弃正面一部分力量？」
出處：`sources/text/command-scout-current-vision.json` 字元 1139-1162 `decisions[1].zh`
顯示：爲了提前知道側路情況，是否放棄正面一部分力量？

## 可調參數

「视野范围」
出處：`sources/text/command-scout-current-vision.json` 字元 1302-1306 `parameters[0].name.zh`
顯示：視野範圍

「范围小更紧张，但也更容易出现无法预判的遭遇。」
出處：`sources/text/command-scout-current-vision.json` 字元 1381-1403 `parameters[0].effect.zh`
顯示：範圍小更緊張，但也更容易出現無法預判的遭遇。

「信息保持方式」
出處：`sources/text/command-scout-current-vision.json` 字元 1537-1543 `parameters[1].name.zh`

「保留地形但隐藏移动敌人，可区分探索记忆与当前侦察。」
出處：`sources/text/command-scout-current-vision.json` 字元 1628-1653 `parameters[1].effect.zh`
顯示：保留地形但隱藏移動敵人，可區分探索記憶與當前偵察。

## 原型

「用格子地图、一个侦察点和一个隐藏移动目标验证视野刷新。」
出處：`sources/text/command-scout-current-vision.json` 字元 2993-3020 `prototype.firstStep.zh`
顯示：用格子地圖、一個偵察點和一個隱藏移動目標驗證視野刷新。

「玩家会不会先探路，再让高价值单位进入未知区域？」
出處：`sources/text/command-scout-current-vision.json` 字元 3273-3296 `prototype.test.zh`
顯示：玩家會不會先探路，再讓高價值單位進入未知區域？

「过期敌情不能仍像实时信息一样可靠。」
出處：`sources/text/command-scout-current-vision.json` 字元 3149-3166 `prototype.pitfall.zh`
顯示：過期敵情不能仍像實時信息一樣可靠。

## 相關模式

- [打斷行動](command-interrupt-action.md)
- [集中火力決策](command-focus-fire.md)
- [前線掩護](command-frontline-shielding.md)
- [先攻順序](command-initiative-order.md)

## 參考來源

- [Send scouts to reveal current information — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/command-scout-current-vision/) — 查閱：2026-11-02；取得方式：page-text。
