---
{
  "schema_version": 2,
  "id": "combat-weakpoint-aim",
  "title": "弱點瞄準",
  "title_en": "Weak-point targeting",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "precision",
    "information",
    "risk"
  ],
  "summary": "同一个敌人，不同命中位置会改变攻击价值。",
  "note_status": "draft",
  "related": [
    "combat-intent-preview",
    "combat-timed-parry",
    "combat-cover-flanking",
    "combat-destructible-cover"
  ],
  "sources": [
    {
      "title": "Weak-point targeting — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-weakpoint-aim/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「同一个敌人，不同命中位置会改变攻击价值。」
出處：`sources/text/combat-weakpoint-aim.json` 字元 168-188 `summary.zh`
顯示：同一個敵人，不同命中位置會改變攻擊價值。

## 規則

「玩家识别弱点，选择角度和武器，把攻击打到高收益部位。弱点可能移动、被遮挡或要求特定伤害类型；命中特效与伤害差异帮助验证判断。」
出處：`sources/text/combat-weakpoint-aim.json` 字元 292-354 `rules.zh`
顯示：玩家識別弱點，選擇角度和武器，把攻擊打到高收益部位。弱點可能移動、被遮擋或要求特定傷害類型；命中特效與傷害差異幫助驗證判斷。

## 核心循環

「识别弱点」
出處：`sources/text/combat-weakpoint-aim.json` 字元 585-589 `loop[0].zh`
顯示：識別弱點

「创造射角或站位」
出處：`sources/text/combat-weakpoint-aim.json` 字元 652-659 `loop[1].zh`
顯示：創造射角或站位

「瞄准并命中」
出處：`sources/text/combat-weakpoint-aim.json` 字元 719-724 `loop[2].zh`
顯示：瞄準並命中

「根据反馈调整」
出處：`sources/text/combat-weakpoint-aim.json` 字元 779-785 `loop[3].zh`
顯示：根據反饋調整

## 玩家取捨

「容易命中的躯干和收益更高的小目标之间，需要权衡命中率。」
出處：`sources/text/combat-weakpoint-aim.json` 字元 870-897 `decisions[0].zh`
顯示：容易命中的軀幹和收益更高的小目標之間，需要權衡命中率。

「绕到弱点一侧能提高伤害，但可能进入更危险的攻击范围。」
出處：`sources/text/combat-weakpoint-aim.json` 字元 1007-1033 `decisions[1].zh`
顯示：繞到弱點一側能提高傷害，但可能進入更危險的攻擊範圍。

## 可調參數

「弱点面积」
出處：`sources/text/combat-weakpoint-aim.json` 字元 1205-1209 `parameters[0].name.zh`
顯示：弱點面積

「面积越小，越强调精度；移动越快，越强调预判。」
出處：`sources/text/combat-weakpoint-aim.json` 字元 1282-1304 `parameters[0].effect.zh`
顯示：面積越小，越強調精度；移動越快，越強調預判。

「弱点提示」
出處：`sources/text/combat-weakpoint-aim.json` 字元 1450-1454 `parameters[1].name.zh`
顯示：弱點提示

「扫描提示降低记忆负担，隐藏弱点则鼓励实验。」
出處：`sources/text/combat-weakpoint-aim.json` 字元 1535-1556 `parameters[1].effect.zh`
顯示：掃描提示降低記憶負擔，隱藏弱點則鼓勵實驗。

## 原型

「做一个带大、小两个命中区域的敌人，让弱点按固定动作露出。」
出處：`sources/text/combat-weakpoint-aim.json` 字元 3063-3091 `prototype.firstStep.zh`
顯示：做一個帶大、小兩個命中區域的敵人，讓弱點按固定動作露出。

「检查玩家能否说明何时值得追求弱点，并在压力大时合理放弃。」
出處：`sources/text/combat-weakpoint-aim.json` 字元 3418-3446 `prototype.test.zh`
顯示：檢查玩家能否說明何時值得追求弱點，並在壓力大時合理放棄。

「别先增加大量枪械；瞄准辅助、遮挡和弱点可读性已经需要反复调整。」
出處：`sources/text/combat-weakpoint-aim.json` 字元 3233-3264 `prototype.pitfall.zh`
顯示：別先增加大量槍械；瞄準輔助、遮擋和弱點可讀性已經需要反覆調整。

## 相關模式

- [意圖預覽](combat-intent-preview.md)
- [限時招架](combat-timed-parry.md)
- [掩體側擊](combat-cover-flanking.md)
- [可破壞掩體](combat-destructible-cover.md)

## 參考來源

- [Weak-point targeting — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-weakpoint-aim/) — 查閱：2026-11-02；取得方式：page-text。
