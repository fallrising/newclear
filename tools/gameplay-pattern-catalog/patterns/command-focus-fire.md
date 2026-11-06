---
{
  "schema_version": 2,
  "id": "command-focus-fire",
  "title": "集中火力決策",
  "title_en": "Focus fire to remove one threat",
  "category": "command",
  "source_category": "command",
  "tags": [
    "planning",
    "optimization"
  ],
  "summary": "打伤所有敌人，与让一个敌人停止攻击，是两种收益。",
  "note_status": "draft",
  "related": [
    "command-trait-thresholds",
    "combat-combat-deck-cycle",
    "command-frontline-shielding",
    "command-initiative-order"
  ],
  "sources": [
    {
      "title": "Focus fire to remove one threat — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/command-focus-fire/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「打伤所有敌人，与让一个敌人停止攻击，是两种收益。」
出處：`sources/text/command-focus-fire.json` 字元 183-207 `summary.zh`
顯示：打傷所有敵人，與讓一個敵人停止攻擊，是兩種收益。

## 規則

「玩家让多个单位攻击同一目标，争取先让它失去战斗能力，减少敌方持续输出。集中火力也可能让剩余伤害溢出、远程弹丸浪费或其他威胁无人处理，因此需要及时换目标。」
出處：`sources/text/command-focus-fire.json` 字元 305-381 `rules.zh`
顯示：玩家讓多個單位攻擊同一目標，爭取先讓它失去戰鬥能力，減少敵方持續輸出。集中火力也可能讓剩餘傷害溢出、遠程彈丸浪費或其他威脅無人處理，因此需要及時換目標。

## 核心循環

「挑选优先消灭的目标」
出處：`sources/text/command-focus-fire.json` 字元 627-636 `loop[0].zh`
顯示：挑選優先消滅的目標

「让多个单位共同攻击」
出處：`sources/text/command-focus-fire.json` 字元 713-722 `loop[1].zh`
顯示：讓多個單位共同攻擊

「确认击倒与剩余伤害」
出處：`sources/text/command-focus-fire.json` 字元 785-794 `loop[2].zh`
顯示：確認擊倒與剩餘傷害

「转向下一个威胁」
出處：`sources/text/command-focus-fire.json` 字元 868-875 `loop[3].zh`
顯示：轉向下一個威脅

## 玩家取捨

「先杀脆弱输出者，还是先处理正在突破防线的重甲者？」
出處：`sources/text/command-focus-fire.json` 字元 965-989 `decisions[0].zh`
顯示：先殺脆弱輸出者，還是先處理正在突破防線的重甲者？

「还有弹丸在飞，是否提前切换目标避免溢出？」
出處：`sources/text/command-focus-fire.json` 字元 1102-1122 `decisions[1].zh`
顯示：還有彈丸在飛，是否提前切換目標避免溢出？

## 可調參數

「过量伤害浪费」
出處：`sources/text/command-focus-fire.json` 字元 1272-1278 `parameters[0].name.zh`
顯示：過量傷害浪費

「高单发伤害会提高分配最后一击的价值。」
出處：`sources/text/command-focus-fire.json` 字元 1353-1371 `parameters[0].effect.zh`
顯示：高單發傷害會提高分配最後一擊的價值。

「目标切换成本」
出處：`sources/text/command-focus-fire.json` 字元 1505-1511 `parameters[1].name.zh`
顯示：目標切換成本

「切换会移动或重置准备时，需要预先规划顺序。」
出處：`sources/text/command-focus-fire.json` 字元 1591-1612 `parameters[1].effect.zh`
顯示：切換會移動或重置準備時，需要預先規劃順序。

## 原型

「三名友方、两名敌人，显示血量与即将落下的伤害。」
出處：`sources/text/command-focus-fire.json` 字元 2986-3009 `prototype.firstStep.zh`
顯示：三名友方、兩名敵人，顯示血量與即將落下的傷害。

「玩家是否能解释为何集中攻击比平均削血更合适，何时又该分火？」
出處：`sources/text/command-focus-fire.json` 字元 3270-3299 `prototype.test.zh`
顯示：玩家是否能解釋爲何集中攻擊比平均削血更合適，何時又該分火？

「命中与弹道如果不透明，玩家难以判断何时换目标。」
出處：`sources/text/command-focus-fire.json` 字元 3133-3156 `prototype.pitfall.zh`
顯示：命中與彈道如果不透明，玩家難以判斷何時換目標。

## 相關模式

- [性狀門檻](command-trait-thresholds.md)
- [戰鬥牌組循環](combat-combat-deck-cycle.md)
- [前線掩護](command-frontline-shielding.md)
- [先攻順序](command-initiative-order.md)

## 參考來源

- [Focus fire to remove one threat — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/command-focus-fire/) — 查閱：2026-11-02；取得方式：page-text。
