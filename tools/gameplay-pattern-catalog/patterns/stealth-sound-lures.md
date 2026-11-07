---
{
  "schema_version": 2,
  "id": "stealth-sound-lures",
  "title": "聲音誘餌",
  "title_en": "Sound lures",
  "category": "stealth",
  "source_category": "stealth",
  "tags": [
    "spatial",
    "timing",
    "information"
  ],
  "summary": "让守卫走向你制造的声响，空出真正想走的路。",
  "note_status": "draft",
  "related": [
    "exploration-stealth-awareness",
    "stealth-light-shadow",
    "stealth-hiding-spots",
    "stealth-synchronized-actions"
  ],
  "sources": [
    {
      "title": "Sound lures — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/stealth-sound-lures/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「让守卫走向你制造的声响，空出真正想走的路。」
出處：`sources/text/stealth-sound-lures.json` 字元 157-178 `summary.zh`
顯示：讓守衛走向你製造的聲響，空出真正想走的路。

## 規則

「投掷物或技能在某个位置发出声音，听见的守卫会调查声源并暂时改变巡逻。玩家利用这段空当通过、取物或伏击；声音范围、响应对象和调查结束时机需要可读。」
出處：`sources/text/stealth-sound-lures.json` 字元 287-359 `rules.zh`
顯示：投擲物或技能在某個位置發出聲音，聽見的守衛會調查聲源並暫時改變巡邏。玩家利用這段空當通過、取物或伏擊；聲音範圍、響應對象和調查結束時機需要可讀。

## 核心循環

「找出挡路的守卫」
出處：`sources/text/stealth-sound-lures.json` 字元 612-619 `loop[0].zh`
顯示：找出擋路的守衛

「选择声源落点」
出處：`sources/text/stealth-sound-lures.json` 字元 690-696 `loop[1].zh`
顯示：選擇聲源落點

「趁守卫调查行动」
出處：`sources/text/stealth-sound-lures.json` 字元 763-770 `loop[2].zh`
顯示：趁守衛調查行動

「离开或回收诱饵」
出處：`sources/text/stealth-sound-lures.json` 字元 846-853 `loop[3].zh`
顯示：離開或回收誘餌

## 玩家取捨

「把守卫引得很远更安全，但会不会同时惊动第二个人？」
出處：`sources/text/stealth-sound-lures.json` 字元 943-967 `decisions[0].zh`
顯示：把守衛引得很遠更安全，但會不會同時驚動第二個人？

「现在取回可重复使用的诱饵，还是先利用短暂的通路？」
出處：`sources/text/stealth-sound-lures.json` 字元 1075-1099 `decisions[1].zh`
顯示：現在取回可重複使用的誘餌，還是先利用短暫的通路？

## 可調參數

「听觉半径」
出處：`sources/text/stealth-sound-lures.json` 字元 1248-1252 `parameters[0].name.zh`
顯示：聽覺半徑

「范围越大越好命中目标，也越难只引开一个人。」
出處：`sources/text/stealth-sound-lures.json` 字元 1328-1349 `parameters[0].effect.zh`
顯示：範圍越大越好命中目標，也越難只引開一個人。

「调查停留时间」
出處：`sources/text/stealth-sound-lures.json` 字元 1498-1504 `parameters[1].name.zh`
顯示：調查停留時間

「停留时间决定玩家能完成多长的动作链，过长会抹掉紧迫感。」
出處：`sources/text/stealth-sound-lures.json` 字元 1588-1615 `parameters[1].effect.zh`
顯示：停留時間決定玩家能完成多長的動作鏈，過長會抹掉緊迫感。

## 原型

「做一个巡逻守卫、一个可投掷石子，以及巡逻—调查—返回三个状态。」
出處：`sources/text/stealth-sound-lures.json` 字元 3054-3085 `prototype.firstStep.zh`
顯示：做一個巡邏守衛、一個可投擲石子，以及巡邏—調查—返回三個狀態。

「玩家能否在投掷前指出哪名守卫会移动，并利用空当完成一次通过？」
出處：`sources/text/stealth-sound-lures.json` 字元 3409-3439 `prototype.test.zh`
顯示：玩家能否在投擲前指出哪名守衛會移動，並利用空當完成一次通過？

「别让守卫无提示地随机无视声响；先固定谁响应、响应多久。」
出處：`sources/text/stealth-sound-lures.json` 字元 3226-3253 `prototype.pitfall.zh`
顯示：別讓守衛無提示地隨機無視聲響；先固定誰響應、響應多久。

## 相關模式

- [潛行警戒](exploration-stealth-awareness.md)
- [光影之間的路線](stealth-light-shadow.md)
- [藏點與脫離時機](stealth-hiding-spots.md)
- [同步動作](stealth-synchronized-actions.md)

## 參考來源

- [Sound lures — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/stealth-sound-lures/) — 查閱：2026-11-02；取得方式：page-text。
