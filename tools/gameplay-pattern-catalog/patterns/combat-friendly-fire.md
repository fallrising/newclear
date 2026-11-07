---
{
  "schema_version": 2,
  "id": "combat-friendly-fire",
  "title": "範圍攻擊的友方誤傷",
  "title_en": "Area attacks with friendly fire",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "spatial",
    "risk",
    "planning"
  ],
  "summary": "威力大的范围技能，需要先替自己人留出安全位置。",
  "note_status": "draft",
  "related": [
    "combat-cover-flanking",
    "combat-destructible-cover",
    "combat-forced-movement",
    "combat-overwatch"
  ],
  "sources": [
    {
      "title": "Area attacks with friendly fire — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-friendly-fire/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「威力大的范围技能，需要先替自己人留出安全位置。」
出處：`sources/text/combat-friendly-fire.json` 字元 183-206 `summary.zh`
顯示：威力大的範圍技能，需要先替自己人留出安全位置。

## 規則

「部分范围攻击对区域里的友军同样生效。玩家选施放位置前，要同时检查敌人收益和己方损失，也可以先移动队友再攻击。结算后受伤和站位变化会影响下一步；哪些技能、难度或天赋免疫误伤需要明确说明。」
出處：`sources/text/combat-friendly-fire.json` 字元 307-399 `rules.zh`
顯示：部分範圍攻擊對區域裏的友軍同樣生效。玩家選施放位置前，要同時檢查敵人收益和己方損失，也可以先移動隊友再攻擊。結算後受傷和站位變化會影響下一步；哪些技能、難度或天賦免疫誤傷需要明確說明。

## 核心循環

「检查敌我站位」
出處：`sources/text/combat-friendly-fire.json` 字元 695-701 `loop[0].zh`
顯示：檢查敵我站位

「预览攻击覆盖区」
出處：`sources/text/combat-friendly-fire.json` 字元 777-784 `loop[1].zh`
顯示：預覽攻擊覆蓋區

「移开友军或接受代价」
出處：`sources/text/combat-friendly-fire.json` 字元 853-862 `loop[2].zh`
顯示：移開友軍或接受代價

「施放后重整队伍」
出處：`sources/text/combat-friendly-fire.json` 字元 936-943 `loop[3].zh`
顯示：施放後重整隊伍

## 玩家取捨

「少命中一个敌人保全队友，还是承担误伤尽快结束战斗？」
出處：`sources/text/combat-friendly-fire.json` 字元 1026-1051 `decisions[0].zh`
顯示：少命中一個敵人保全隊友，還是承擔誤傷儘快結束戰鬥？

「花一次行动让队友撤开，是否值得换取更好的范围攻击？」
出處：`sources/text/combat-friendly-fire.json` 字元 1172-1197 `decisions[1].zh`
顯示：花一次行動讓隊友撤開，是否值得換取更好的範圍攻擊？

## 可調參數

「友军伤害比例」
出處：`sources/text/combat-friendly-fire.json` 字元 1344-1350 `parameters[0].name.zh`
顯示：友軍傷害比例

「较低比例便于学习，完全伤害会让站位更重要但容错更低。」
出處：`sources/text/combat-friendly-fire.json` 字元 1433-1459 `parameters[0].effect.zh`
顯示：較低比例便於學習，完全傷害會讓站位更重要但容錯更低。

「范围预览精度」
出處：`sources/text/combat-friendly-fire.json` 字元 1628-1634 `parameters[1].name.zh`
顯示：範圍預覽精度

「明确标出将受影响的友军，玩家才是在选择风险而非猜测判定。」
出處：`sources/text/combat-friendly-fire.json` 字元 1717-1745 `parameters[1].effect.zh`
顯示：明確標出將受影響的友軍，玩家纔是在選擇風險而非猜測判定。

## 原型

「用圆形或格子范围、两名友军和三个敌人；先做准确预览再加特效。」
出處：`sources/text/combat-friendly-fire.json` 字元 3213-3243 `prototype.firstStep.zh`
顯示：用圓形或格子範圍、兩名友軍和三個敵人；先做準確預覽再加特效。

「检查玩家能否在施放前指出谁会受伤，以及是否愿意为了某次收益接受误伤。」
出處：`sources/text/combat-friendly-fire.json` 字元 3563-3597 `prototype.test.zh`
顯示：檢查玩家能否在施放前指出誰會受傷，以及是否願意爲了某次收益接受誤傷。

「画面范围和实际受击范围不一致，会把有意取舍变成挫败。」
出處：`sources/text/combat-friendly-fire.json` 字元 3403-3429 `prototype.pitfall.zh`
顯示：畫面範圍和實際受擊範圍不一致，會把有意取捨變成挫敗。

## 相關模式

- [掩體側擊](combat-cover-flanking.md)
- [可破壞掩體](combat-destructible-cover.md)
- [強制移動](combat-forced-movement.md)
- [警戒射擊](combat-overwatch.md)

## 參考來源

- [Area attacks with friendly fire — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-friendly-fire/) — 查閱：2026-11-02；取得方式：page-text。
