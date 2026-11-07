---
{
  "schema_version": 2,
  "id": "command-interrupt-action",
  "title": "打斷行動",
  "title_en": "Interrupt an action during preparation",
  "category": "command",
  "source_category": "command",
  "tags": [
    "timing",
    "information"
  ],
  "summary": "放弃眼前伤害，换掉敌人即将完成的大动作。",
  "note_status": "draft",
  "related": [
    "command-initiative-order",
    "command-scout-current-vision",
    "combat-combo-variation",
    "combat-intent-preview"
  ],
  "sources": [
    {
      "title": "Interrupt an action during preparation — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/command-interrupt-action/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「放弃眼前伤害，换掉敌人即将完成的大动作。」
出處：`sources/text/command-interrupt-action.json` 字元 194-214 `summary.zh`
顯示：放棄眼前傷害，換掉敵人即將完成的大動作。

## 規則

「部分行动先准备再生效，期间玩家能用指定攻击或控制把它打断或延后。玩家看准备条、姿势和冷却安排打断时机；用太早可能被无关动作消耗，用太晚则敌人已经完成行动。」
出處：`sources/text/command-interrupt-action.json` 字元 311-388 `rules.zh`
顯示：部分行動先準備再生效，期間玩家能用指定攻擊或控制把它打斷或延後。玩家看準備條、姿勢和冷卻安排打斷時機；用太早可能被無關動作消耗，用太晚則敵人已經完成行動。

## 核心循環

「辨认敌人的准备动作」
出處：`sources/text/command-interrupt-action.json` 字元 654-663 `loop[0].zh`
顯示：辨認敵人的準備動作

「保留或使用打断手段」
出處：`sources/text/command-interrupt-action.json` 字元 728-737 `loop[1].zh`
顯示：保留或使用打斷手段

「确认动作取消或延后」
出處：`sources/text/command-interrupt-action.json` 字元 807-816 `loop[2].zh`
顯示：確認動作取消或延後

「等下一次危险准备」
出處：`sources/text/command-interrupt-action.json` 字元 891-899 `loop[3].zh`
顯示：等下一次危險準備

## 玩家取捨

「现在打断普通攻击，还是等更危险的法术？」
出處：`sources/text/command-interrupt-action.json` 字元 991-1010 `decisions[0].zh`
顯示：現在打斷普通攻擊，還是等更危險的法術？

「打断者要靠近目标，值不值得承担途中伤害？」
出處：`sources/text/command-interrupt-action.json` 字元 1116-1136 `decisions[1].zh`
顯示：打斷者要靠近目標，值不值得承擔途中傷害？

## 可調參數

「准备时间」
出處：`sources/text/command-interrupt-action.json` 字元 1274-1278 `parameters[0].name.zh`
顯示：準備時間

「窗口越短越考验反应；较长窗口更适合指挥多个单位。」
出處：`sources/text/command-interrupt-action.json` 字元 1360-1384 `parameters[0].effect.zh`
顯示：窗口越短越考驗反應；較長窗口更適合指揮多個單位。

「打断后的处理」
出處：`sources/text/command-interrupt-action.json` 字元 1528-1534 `parameters[1].name.zh`
顯示：打斷後的處理

「完全取消奖励抓时机；只延后则要求其他单位跟进。」
出處：`sources/text/command-interrupt-action.json` 字元 1614-1637 `parameters[1].effect.zh`
顯示：完全取消獎勵抓時機；只延後則要求其他單位跟進。

## 原型

「只做一名读条敌人、一种普通攻击和一个打断按钮。」
出處：`sources/text/command-interrupt-action.json` 字元 3009-3032 `prototype.firstStep.zh`
顯示：只做一名讀條敵人、一種普通攻擊和一個打斷按鈕。

「玩家会不会主动停手，把打断留给危险动作？」
出處：`sources/text/command-interrupt-action.json` 字元 3275-3295 `prototype.test.zh`
顯示：玩家會不會主動停手，把打斷留給危險動作？

「打断成功与目标免疫必须有不同反馈。」
出處：`sources/text/command-interrupt-action.json` 字元 3151-3168 `prototype.pitfall.zh`
顯示：打斷成功與目標免疫必須有不同反饋。

## 相關模式

- [先攻順序](command-initiative-order.md)
- [偵察當下視野](command-scout-current-vision.md)
- [連段變化](combat-combo-variation.md)
- [意圖預覽](combat-intent-preview.md)

## 參考來源

- [Interrupt an action during preparation — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/command-interrupt-action/) — 查閱：2026-11-02；取得方式：page-text。
