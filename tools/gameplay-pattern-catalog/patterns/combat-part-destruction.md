---
{
  "schema_version": 2,
  "id": "combat-part-destruction",
  "title": "部位破壞",
  "title_en": "Part destruction changes the fight",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "planning",
    "precision",
    "progression"
  ],
  "summary": "攻击局部目标，永久削减敌人的能力或取得专属掉落。",
  "note_status": "draft",
  "related": [
    "automation-production-chain",
    "combat-action-points",
    "combat-combat-deck-cycle",
    "combat-cover-flanking"
  ],
  "sources": [
    {
      "title": "Part destruction changes the fight — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-part-destruction/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「攻击局部目标，永久削减敌人的能力或取得专属掉落。」
出處：`sources/text/combat-part-destruction.json` 字元 187-211 `summary.zh`
顯示：攻擊局部目標，永久削減敵人的能力或取得專屬掉落。

## 規則

「敌人的部分身体拥有独立破坏条件。集中攻击触发断裂、武器脱落或奖励变化；部位目标可能不等于最快击杀路线，且并非每个部位都会削弱招式。」
出處：`sources/text/combat-part-destruction.json` 字元 332-397 `rules.zh`
顯示：敵人的部分身體擁有獨立破壞條件。集中攻擊觸發斷裂、武器脫落或獎勵變化；部位目標可能不等於最快擊殺路線，且並非每個部位都會削弱招式。

## 核心循環

「选定有价值部位」
出處：`sources/text/combat-part-destruction.json` 字元 657-664 `loop[0].zh`
顯示：選定有價值部位

「调整武器与站位」
出處：`sources/text/combat-part-destruction.json` 字元 730-737 `loop[1].zh`
顯示：調整武器與站位

「集中伤害触发破坏」
出處：`sources/text/combat-part-destruction.json` 字元 807-815 `loop[2].zh`
顯示：集中傷害觸發破壞

「利用战局变化」
出處：`sources/text/combat-part-destruction.json` 字元 889-895 `loop[3].zh`
顯示：利用戰局變化

## 玩家取捨

「先拆危险武器更安全，先打生命弱点更快，玩家可选击杀顺序。」
出處：`sources/text/combat-part-destruction.json` 字元 985-1013 `decisions[0].zh`
顯示：先拆危險武器更安全，先打生命弱點更快，玩家可選擊殺順序。

「为了素材追打难够到的部位，可能延长整场战斗。」
出處：`sources/text/combat-part-destruction.json` 字元 1141-1163 `decisions[1].zh`
顯示：爲了素材追打難夠到的部位，可能延長整場戰鬥。

## 可調參數

「部位耐久」
出處：`sources/text/combat-part-destruction.json` 字元 1317-1321 `parameters[0].name.zh`

「耐久过高会让拆解失去实用性，过低则缺少铺垫。」
出處：`sources/text/combat-part-destruction.json` 字元 1398-1420 `parameters[0].effect.zh`
顯示：耐久過高會讓拆解失去實用性，過低則缺少鋪墊。

「功能损失程度」
出處：`sources/text/combat-part-destruction.json` 字元 1573-1579 `parameters[1].name.zh`
顯示：功能損失程度

「明确禁用一项攻击，比只掉一块装甲更容易让玩家读懂收益。」
出處：`sources/text/combat-part-destruction.json` 字元 1656-1683 `parameters[1].effect.zh`
顯示：明確禁用一項攻擊，比只掉一塊裝甲更容易讓玩家讀懂收益。

## 原型

「做一个主体加两个独立部位，破坏其中一个就关闭对应攻击。」
出處：`sources/text/combat-part-destruction.json` 字元 3217-3244 `prototype.firstStep.zh`
顯示：做一個主體加兩個獨立部位，破壞其中一個就關閉對應攻擊。

「给两种部位不同威胁，观察玩家是否改变拆除顺序。」
出處：`sources/text/combat-part-destruction.json` 字元 3562-3585 `prototype.test.zh`
顯示：給兩種部位不同威脅，觀察玩家是否改變拆除順序。

「部位越多，动画、受击和残骸状态组合越多；先保证破坏结果看得懂。」
出處：`sources/text/combat-part-destruction.json` 字元 3381-3412 `prototype.pitfall.zh`
顯示：部位越多，動畫、受擊和殘骸狀態組合越多；先保證破壞結果看得懂。

## 相關模式

- [產線連鎖](automation-production-chain.md)
- [行動點數](combat-action-points.md)
- [戰鬥牌組循環](combat-combat-deck-cycle.md)
- [掩體側擊](combat-cover-flanking.md)

## 參考來源

- [Part destruction changes the fight — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-part-destruction/) — 查閱：2026-11-02；取得方式：page-text。
