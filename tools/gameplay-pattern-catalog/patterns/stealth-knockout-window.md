---
{
  "schema_version": 2,
  "id": "stealth-knockout-window",
  "title": "擊昏窗口",
  "title_en": "Knockout timers and pinning",
  "category": "stealth",
  "source_category": "stealth",
  "tags": [
    "time",
    "planning",
    "risk"
  ],
  "summary": "没杀死的守卫会醒来，你要花人手看住他，还是赶快离开？",
  "note_status": "draft",
  "related": [
    "cooking-order-triage",
    "stealth-body-concealment",
    "stealth-disguise-access",
    "stealth-peeking"
  ],
  "sources": [
    {
      "title": "Knockout timers and pinning — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/stealth-knockout-window/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「没杀死的守卫会醒来，你要花人手看住他，还是赶快离开？」
出處：`sources/text/stealth-knockout-window.json` 字元 181-207 `summary.zh`
顯示：沒殺死的守衛會醒來，你要花人手看住他，還是趕快離開？

## 規則

「非致命制服只买到有限时间，倒地目标可能恢复行动。玩家可以看守、束缚或在醒来前撤离；控制一个守卫的收益，要与占用队员、时间及工具的成本比较。」
出處：`sources/text/stealth-knockout-window.json` 字元 332-401 `rules.zh`
顯示：非致命制服只買到有限時間，倒地目標可能恢復行動。玩家可以看守、束縛或在醒來前撤離；控制一個守衛的收益，要與佔用隊員、時間及工具的成本比較。

## 核心循環

「短暂制服目标」
出處：`sources/text/stealth-knockout-window.json` 字元 636-642 `loop[0].zh`
顯示：短暫制服目標

「确认剩余昏迷时间」
出處：`sources/text/stealth-knockout-window.json` 字元 713-721 `loop[1].zh`
顯示：確認剩餘昏迷時間

「分配看守或束缚」
出處：`sources/text/stealth-knockout-window.json` 字元 793-800 `loop[2].zh`
顯示：分配看守或束縛

「完成目标后撤离」
出處：`sources/text/stealth-knockout-window.json` 字元 871-878 `loop[3].zh`
顯示：完成目標後撤離

## 玩家取捨

「留一名队员看守可以延长安全，但少一人是否拖慢开门和搬运？」
出處：`sources/text/stealth-knockout-window.json` 字元 973-1001 `decisions[0].zh`
顯示：留一名隊員看守可以延長安全，但少一人是否拖慢開門和搬運？

「用有限工具长期控制，还是接受几回合后守卫醒来的风险？」
出處：`sources/text/stealth-knockout-window.json` 字元 1120-1146 `decisions[1].zh`
顯示：用有限工具長期控制，還是接受幾回合後守衛醒來的風險？

## 可調參數

「恢复时长」
出處：`sources/text/stealth-knockout-window.json` 字元 1302-1306 `parameters[0].name.zh`
顯示：恢復時長

「越短越强调迅速推进；越长越接近永久清场，弱化看守决策。」
出處：`sources/text/stealth-knockout-window.json` 字元 1385-1412 `parameters[0].effect.zh`
顯示：越短越強調迅速推進；越長越接近永久清場，弱化看守決策。

「维持控制的成本」
出處：`sources/text/stealth-knockout-window.json` 字元 1580-1587 `parameters[1].name.zh`
顯示：維持控制的成本

「需要占住队员还是消耗物品，会产生不同的队伍与物资取舍。」
出處：`sources/text/stealth-knockout-window.json` 字元 1676-1703 `parameters[1].effect.zh`
顯示：需要佔住隊員還是消耗物品，會產生不同的隊伍與物資取捨。

## 原型

「做两个角色、一个昏迷计数器和一个需要多回合的目标；站在旁边时暂停计数。」
出處：`sources/text/stealth-knockout-window.json` 字元 3180-3215 `prototype.firstStep.zh`
顯示：做兩個角色、一個昏迷計數器和一個需要多回合的目標；站在旁邊時暫停計數。

「玩家是否主动计算“任务还要多久、守卫多久会醒”，并分配看守？」
出處：`sources/text/stealth-knockout-window.json` 字元 3539-3569 `prototype.test.zh`
顯示：玩家是否主動計算“任務還要多久、守衛多久會醒”，並分配看守？

「醒来时机必须可预测；不要让计时器在玩家无法理解的动作中突然跳过。」
出處：`sources/text/stealth-knockout-window.json` 字元 3371-3403 `prototype.pitfall.zh`
顯示：醒來時機必須可預測；不要讓計時器在玩家無法理解的動作中突然跳過。

## 相關模式

- [限時訂單的取捨順序](cooking-order-triage.md)
- [移動與藏起目標](stealth-body-concealment.md)
- [偽裝進出](stealth-disguise-access.md)
- [探頭決策](stealth-peeking.md)

## 參考來源

- [Knockout timers and pinning — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/stealth-knockout-window/) — 查閱：2026-11-02；取得方式：page-text。
