---
{
  "schema_version": 2,
  "id": "combat-cover-flanking",
  "title": "掩體側擊",
  "title_en": "Cover and flanking",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "spatial",
    "planning",
    "risk"
  ],
  "summary": "安全不是一个地点，而是相对于敌人射线的关系。",
  "note_status": "draft",
  "related": [
    "combat-destructible-cover",
    "combat-forced-movement",
    "combat-friendly-fire",
    "combat-overwatch"
  ],
  "sources": [
    {
      "title": "Cover and flanking — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-cover-flanking/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「安全不是一个地点，而是相对于敌人射线的关系。」
出處：`sources/text/combat-cover-flanking.json` 字元 168-190 `summary.zh`
顯示：安全不是一個地點，而是相對於敵人射線的關係。

## 規則

「单位借助掩体降低被命中的风险，再移动到敌人没有掩护的一侧。移动花费行动机会，且新站位可能被其他敌人反包抄；界面用掩体与命中信息反馈风险。」
出處：`sources/text/combat-cover-flanking.json` 字元 302-370 `rules.zh`
顯示：單位藉助掩體降低被命中的風險，再移動到敵人沒有掩護的一側。移動花費行動機會，且新站位可能被其他敵人反包抄；界面用掩體與命中信息反饋風險。

## 核心循環

「读取双方射线」
出處：`sources/text/combat-cover-flanking.json` 字元 640-646 `loop[0].zh`
顯示：讀取雙方射線

「寻找侧翼路线」
出處：`sources/text/combat-cover-flanking.json` 字元 708-714 `loop[1].zh`
顯示：尋找側翼路線

「付出行动移动」
出處：`sources/text/combat-cover-flanking.json` 字元 776-782 `loop[2].zh`
顯示：付出行動移動

「攻击后重建保护」
出處：`sources/text/combat-cover-flanking.json` 字元 847-854 `loop[3].zh`
顯示：攻擊後重建保護

## 玩家取捨

「绕远路取得好角度，还是在原地低命中率射击？」
出處：`sources/text/combat-cover-flanking.json` 字元 948-969 `decisions[0].zh`
顯示：繞遠路取得好角度，還是在原地低命中率射擊？

「一个掩体能防正面，却未必能防第二名敌人。」
出處：`sources/text/combat-cover-flanking.json` 字元 1082-1102 `decisions[1].zh`
顯示：一個掩體能防正面，卻未必能防第二名敵人。

## 可調參數

「掩体强度」
出處：`sources/text/combat-cover-flanking.json` 字元 1250-1254 `parameters[0].name.zh`
顯示：掩體強度

「保护越强，绕侧和破坏掩体的价值越高。」
出處：`sources/text/combat-cover-flanking.json` 字元 1330-1348 `parameters[0].effect.zh`
顯示：保護越強，繞側和破壞掩體的價值越高。

「移动行动成本」
出處：`sources/text/combat-cover-flanking.json` 字元 1488-1494 `parameters[1].name.zh`
顯示：移動行動成本

「低成本鼓励机动，高成本让一次冲刺更需要团队配合。」
出處：`sources/text/combat-cover-flanking.json` 字元 1569-1593 `parameters[1].effect.zh`
顯示：低成本鼓勵機動，高成本讓一次衝刺更需要團隊配合。

## 原型

「先做小格子地图、两名敌人、方向性掩体和每回合两点行动。」
出處：`sources/text/combat-cover-flanking.json` 字元 3051-3078 `prototype.firstStep.zh`
顯示：先做小格子地圖、兩名敵人、方向性掩體和每回合兩點行動。

「让玩家预判移动后的安全性，检查图标是否足以解释不同射线的风险。」
出處：`sources/text/combat-cover-flanking.json` 字元 3367-3398 `prototype.test.zh`
顯示：讓玩家預判移動後的安全性，檢查圖標是否足以解釋不同射線的風險。

「先把侧翼判定画清楚，再考虑复杂地形和多层建筑。」
出處：`sources/text/combat-cover-flanking.json` 字元 3215-3238 `prototype.pitfall.zh`
顯示：先把側翼判定畫清楚，再考慮複雜地形和多層建築。

## 相關模式

- [可破壞掩體](combat-destructible-cover.md)
- [強制移動](combat-forced-movement.md)
- [範圍攻擊的友方誤傷](combat-friendly-fire.md)
- [警戒射擊](combat-overwatch.md)

## 參考來源

- [Cover and flanking — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-cover-flanking/) — 查閱：2026-11-02；取得方式：page-text。
