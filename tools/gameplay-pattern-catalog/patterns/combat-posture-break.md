---
{
  "schema_version": 2,
  "id": "combat-posture-break",
  "title": "架勢崩解",
  "title_en": "Stagger buildup and punish windows",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "timing",
    "risk",
    "progression"
  ],
  "summary": "先持续施压制造破绽，再把破绽兑换成高价值攻击。",
  "note_status": "draft",
  "related": [
    "combat-stamina-budget",
    "combat-timed-parry",
    "combat-combo-variation",
    "combat-cover-flanking"
  ],
  "sources": [
    {
      "title": "Stagger buildup and punish windows — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-posture-break/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先持续施压制造破绽，再把破绽兑换成高价值攻击。」
出處：`sources/text/combat-posture-break.json` 字元 185-208 `summary.zh`
顯示：先持續施壓制造破綻，再把破綻兌換成高價值攻擊。

## 規則

「除了生命值，再设一条可被攻击或防守互动累积的失衡状态。达到阈值后敌人暴露弱点；玩家需要在其恢复前赶到并执行奖励动作。」
出處：`sources/text/combat-posture-break.json` 字元 323-381 `rules.zh`
顯示：除了生命值，再設一條可被攻擊或防守互動累積的失衡狀態。達到閾值後敵人暴露弱點；玩家需要在其恢復前趕到並執行獎勵動作。

## 核心循環

「选择高失衡手段」
出處：`sources/text/combat-posture-break.json` 字元 595-602 `loop[0].zh`
顯示：選擇高失衡手段

「连续维持压力」
出處：`sources/text/combat-posture-break.json` 字元 668-674 `loop[1].zh`
顯示：連續維持壓力

「识别破防反馈」
出處：`sources/text/combat-posture-break.json` 字元 734-740 `loop[2].zh`
顯示：識別破防反饋

「兑现处决或重击」
出處：`sources/text/combat-posture-break.json` 字元 803-810 `loop[3].zh`
顯示：兌現處決或重擊

## 玩家取捨

「保持压力可以阻止恢复，但继续贴身也扩大受伤风险。」
出處：`sources/text/combat-posture-break.json` 字元 902-926 `decisions[0].zh`
顯示：保持壓力可以阻止恢復，但繼續貼身也擴大受傷風險。

「低伤害高失衡招式，让最优输出不再只看单次伤害。」
出處：`sources/text/combat-posture-break.json` 字元 1048-1071 `decisions[1].zh`
顯示：低傷害高失衡招式，讓最優輸出不再只看單次傷害。

## 可調參數

「自然恢复速度」
出處：`sources/text/combat-posture-break.json` 字元 1241-1247 `parameters[0].name.zh`
顯示：自然恢復速度

「恢复越快，系统越鼓励贴身连续互动。」
出處：`sources/text/combat-posture-break.json` 字元 1325-1342 `parameters[0].effect.zh`
顯示：恢復越快，系統越鼓勵貼身連續互動。

「破防收益」
出處：`sources/text/combat-posture-break.json` 字元 1471-1475 `parameters[1].name.zh`

「高收益让铺垫更有价值，低收益更像短暂控场。」
出處：`sources/text/combat-posture-break.json` 字元 1549-1570 `parameters[1].effect.zh`
顯示：高收益讓鋪墊更有價值，低收益更像短暫控場。

## 原型

「做生命与失衡两条数值、轻重两种攻击，以及固定长度的破绽窗口。」
出處：`sources/text/combat-posture-break.json` 字元 3001-3031 `prototype.firstStep.zh`
顯示：做生命與失衡兩條數值、輕重兩種攻擊，以及固定長度的破綻窗口。

「比较敌人残血与失衡将满两种局面，玩家是否选择不同攻击。」
出處：`sources/text/combat-posture-break.json` 字元 3355-3382 `prototype.test.zh`
顯示：比較敵人殘血與失衡將滿兩種局面，玩家是否選擇不同攻擊。

「如果失衡只是第二条血条，玩家不会改变打法；需要恢复或时机约束。」
出處：`sources/text/combat-posture-break.json` 字元 3177-3208 `prototype.pitfall.zh`
顯示：如果失衡只是第二條血條，玩家不會改變打法；需要恢復或時機約束。

## 相關模式

- [攻守共用資源預算](combat-stamina-budget.md)
- [限時招架](combat-timed-parry.md)
- [連段變化](combat-combo-variation.md)
- [掩體側擊](combat-cover-flanking.md)

## 參考來源

- [Stagger buildup and punish windows — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-posture-break/) — 查閱：2026-11-02；取得方式：page-text。
