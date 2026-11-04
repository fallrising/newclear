---
{
  "schema_version": 2,
  "id": "defense-resistance-counters",
  "title": "抗性克制",
  "title_en": "Prepare answers to enemy resistances",
  "category": "defense",
  "source_category": "defense",
  "tags": [
    "information",
    "planning",
    "risk"
  ],
  "summary": "火力很高也可能打不动，先判断敌人需要哪一种处理方式。",
  "note_status": "draft",
  "related": [
    "defense-day-night-investment",
    "defense-mobile-defender",
    "defense-target-priority",
    "defense-ammunition-supply"
  ],
  "sources": [
    {
      "title": "Prepare answers to enemy resistances — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/defense-resistance-counters/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「火力很高也可能打不动，先判断敌人需要哪一种处理方式。」
出處：`sources/text/defense-resistance-counters.json` 字元 197-223 `summary.zh`
顯示：火力很高也可能打不動，先判斷敵人需要哪一種處理方式。

## 規則

「敌人带有护甲、伤害抗性、隐蔽或飞行等属性，使部分攻击无效或收益降低。玩家读懂来敌信息后，配置可以发现、命中并有效伤害它们的防御；受击反馈和漏怪提示暴露防线的缺项。」
出處：`sources/text/defense-resistance-counters.json` 字元 356-437 `rules.zh`
顯示：敵人帶有護甲、傷害抗性、隱蔽或飛行等屬性，使部分攻擊無效或收益降低。玩家讀懂來敵信息後，配置可以發現、命中並有效傷害它們的防禦；受擊反饋和漏怪提示暴露防線的缺項。

## 核心循環

「识别敌人的防御属性」
出處：`sources/text/defense-resistance-counters.json` 字元 733-742 `loop[0].zh`
顯示：識別敵人的防禦屬性

「检查现有防线缺什么」
出處：`sources/text/defense-resistance-counters.json` 字元 811-820 `loop[1].zh`
顯示：檢查現有防線缺什麼

「补充克制单位或升级」
出處：`sources/text/defense-resistance-counters.json` 字元 887-896 `loop[2].zh`
顯示：補充剋制單位或升級

「用实际命中结果复核」
出處：`sources/text/defense-resistance-counters.json` 字元 964-973 `loop[3].zh`
顯示：用實際命中結果複覈

## 玩家取捨

「为少量特殊敌人专门买一座塔，还是升级已有塔扩大适用范围？」
出處：`sources/text/defense-resistance-counters.json` 字元 1074-1102 `decisions[0].zh`
顯示：爲少量特殊敵人專門買一座塔，還是升級已有塔擴大適用範圍？

「单一伤害类型效率高，但下一波换敌人后是否会整条线失效？」
出處：`sources/text/defense-resistance-counters.json` 字元 1239-1266 `decisions[1].zh`
顯示：單一傷害類型效率高，但下一波換敵人後是否會整條線失效？

## 可調參數

「抗性程度」
出處：`sources/text/defense-resistance-counters.json` 字元 1447-1451 `parameters[0].name.zh`

「完全免疫会形成明确门槛；部分减伤允许玩家用高投入硬撑，但克制感较弱。」
出處：`sources/text/defense-resistance-counters.json` 字元 1532-1566 `parameters[0].effect.zh`
顯示：完全免疫會形成明確門檻；部分減傷允許玩家用高投入硬撐，但剋制感較弱。

「预告提前量」
出處：`sources/text/defense-resistance-counters.json` 字元 1760-1765 `parameters[1].name.zh`
顯示：預告提前量

「提前预告给玩家准备空间；突然出现则需要保留应急资源。」
出處：`sources/text/defense-resistance-counters.json` 字元 1844-1870 `parameters[1].effect.zh`
顯示：提前預告給玩家準備空間；突然出現則需要保留應急資源。

## 原型

「先做两种敌人和两种攻击，用明确图标显示一种减伤关系。」
出處：`sources/text/defense-resistance-counters.json` 字元 3399-3425 `prototype.firstStep.zh`
顯示：先做兩種敵人和兩種攻擊，用明確圖標顯示一種減傷關係。

「遇到打不动的敌人时，玩家能否找到缺少的手段，而非误以为伤害系统出错？」
出處：`sources/text/defense-resistance-counters.json` 字元 3756-3790 `prototype.test.zh`
顯示：遇到打不動的敵人時，玩家能否找到缺少的手段，而非誤以爲傷害系統出錯？

「先不要叠加十几种颜色、护甲和状态；优先验证玩家能否理解一次无效攻击。」
出處：`sources/text/defense-resistance-counters.json` 字元 3570-3604 `prototype.pitfall.zh`
顯示：先不要疊加十幾種顏色、護甲和狀態；優先驗證玩家能否理解一次無效攻擊。

## 相關模式

- [日間夜間投入](defense-day-night-investment.md)
- [移動中防守者](defense-mobile-defender.md)
- [目標優先](defense-target-priority.md)
- [彈藥供給](defense-ammunition-supply.md)

## 參考來源

- [Prepare answers to enemy resistances — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/defense-resistance-counters/) — 查閱：2026-11-02；取得方式：page-text。
