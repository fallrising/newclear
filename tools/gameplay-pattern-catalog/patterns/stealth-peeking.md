---
{
  "schema_version": 2,
  "id": "stealth-peeking",
  "title": "探頭決策",
  "title_en": "Peeking before committing",
  "category": "stealth",
  "source_category": "stealth",
  "tags": [
    "information",
    "risk",
    "planning"
  ],
  "summary": "先花一点时间看清另一侧，再决定要不要走进去。",
  "note_status": "draft",
  "related": [
    "stealth-disguise-access",
    "stealth-body-concealment",
    "stealth-hiding-spots",
    "stealth-knockout-window"
  ],
  "sources": [
    {
      "title": "Peeking before committing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/stealth-peeking/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先花一点时间看清另一侧，再决定要不要走进去。」
出處：`sources/text/stealth-peeking.json` 字元 170-192 `summary.zh`
顯示：先花一點時間看清另一側，再決定要不要走進去。

## 規則

「门、拐角和墙遮住信息，玩家可停下探看，获得有限视野而不用直接进入危险区域。观察可能花行动点或时间，且未必看见全部敌人；重点是“先确认，再承诺移动”。」
出處：`sources/text/stealth-peeking.json` 字元 303-377 `rules.zh`
顯示：門、拐角和牆遮住信息，玩家可停下探看，獲得有限視野而不用直接進入危險區域。觀察可能花行動點或時間，且未必看見全部敵人；重點是“先確認，再承諾移動”。

## 核心循環

「来到遮挡边缘」
出處：`sources/text/stealth-peeking.json` 字元 651-657 `loop[0].zh`
顯示：來到遮擋邊緣

「探看另一侧」
出處：`sources/text/stealth-peeking.json` 字元 721-726 `loop[1].zh`
顯示：探看另一側

「判断安全路线」
出處：`sources/text/stealth-peeking.json` 字元 784-790 `loop[2].zh`
顯示：判斷安全路線

「移动或换入口」
出處：`sources/text/stealth-peeking.json` 字元 855-861 `loop[3].zh`
顯示：移動或換入口

## 玩家取捨

「花一次观察确认安全，还是保留行动点直接冲过？」
出處：`sources/text/stealth-peeking.json` 字元 957-979 `decisions[0].zh`
顯示：花一次觀察確認安全，還是保留行動點直接衝過？

「看到一名守卫就足够了吗，还是要换角度确认盲区？」
出處：`sources/text/stealth-peeking.json` 字元 1082-1105 `decisions[1].zh`
顯示：看到一名守衛就足夠了嗎，還是要換角度確認盲區？

## 可調參數

「观察成本」
出處：`sources/text/stealth-peeking.json` 字元 1271-1275 `parameters[0].name.zh`
顯示：觀察成本

「成本低便于教学；成本过低且信息完全可靠时，可能变成每个门口的例行点击。」
出處：`sources/text/stealth-peeking.json` 字元 1353-1388 `parameters[0].effect.zh`
顯示：成本低便於教學；成本過低且信息完全可靠時，可能變成每個門口的例行點擊。

「视野覆盖」
出處：`sources/text/stealth-peeking.json` 字元 1557-1561 `parameters[1].name.zh`
顯示：視野覆蓋

「只显示部分房间，会保留换角度与进一步侦察的价值。」
出處：`sources/text/stealth-peeking.json` 字元 1638-1662 `parameters[1].effect.zh`
顯示：只顯示部分房間，會保留換角度與進一步偵察的價值。

## 原型

「做一个门后隐藏的房间和探看按钮；按钮揭示有限区域并扣一点行动。」
出處：`sources/text/stealth-peeking.json` 字元 3064-3095 `prototype.firstStep.zh`
顯示：做一個門後隱藏的房間和探看按鈕；按鈕揭示有限區域並扣一點行動。

「玩家会不会根据剩余行动点改变侦察选择，而不是每扇门都机械地点一次？」
出處：`sources/text/stealth-peeking.json` 字元 3440-3473 `prototype.test.zh`
顯示：玩家會不會根據剩餘行動點改變偵察選擇，而不是每扇門都機械地點一次？

「不要把探看做成无脑必按按钮；至少提供绕行、等待或直接进入的有效替代。」
出處：`sources/text/stealth-peeking.json` 字元 3239-3273 `prototype.pitfall.zh`
顯示：不要把探看做成無腦必按按鈕；至少提供繞行、等待或直接進入的有效替代。

## 相關模式

- [偽裝進出](stealth-disguise-access.md)
- [移動與藏起目標](stealth-body-concealment.md)
- [藏點與脫離時機](stealth-hiding-spots.md)
- [擊昏窗口](stealth-knockout-window.md)

## 參考來源

- [Peeking before committing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/stealth-peeking/) — 查閱：2026-11-02；取得方式：page-text。
