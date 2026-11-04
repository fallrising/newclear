---
{
  "schema_version": 2,
  "id": "command-threat-redirection",
  "title": "威脅轉移",
  "title_en": "Redirect enemy attention",
  "category": "command",
  "source_category": "command",
  "tags": [
    "cooperation",
    "planning"
  ],
  "summary": "让能承伤的人接管危险，给脆弱队友腾出空间。",
  "note_status": "draft",
  "related": [
    "command-focus-fire",
    "command-frontline-shielding",
    "command-initiative-order",
    "command-prebattle-formation"
  ],
  "sources": [
    {
      "title": "Redirect enemy attention — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/command-threat-redirection/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「让能承伤的人接管危险，给脆弱队友腾出空间。」
出處：`sources/text/command-threat-redirection.json` 字元 186-207 `summary.zh`
顯示：讓能承傷的人接管危險，給脆弱隊友騰出空間。

## 規則

「敌人按威胁或目标规则选择攻击对象，玩家用嘲讽、挑衅或其他手段改变这个选择。拉住敌人后还要安排距离、防护和治疗；目标指示线或转身动作说明谁正在承压。」
出處：`sources/text/command-threat-redirection.json` 字元 307-380 `rules.zh`
顯示：敵人按威脅或目標規則選擇攻擊對象，玩家用嘲諷、挑釁或其他手段改變這個選擇。拉住敵人後還要安排距離、防護和治療；目標指示線或轉身動作說明誰正在承壓。

## 核心循環

「发现脆弱队友被盯上」
出處：`sources/text/command-threat-redirection.json` 字元 664-673 `loop[0].zh`
顯示：發現脆弱隊友被盯上

「让承伤单位提高威胁」
出處：`sources/text/command-threat-redirection.json` 字元 756-765 `loop[1].zh`
顯示：讓承傷單位提高威脅

「承接攻击并稳住位置」
出處：`sources/text/command-threat-redirection.json` 字元 838-847 `loop[2].zh`
顯示：承接攻擊並穩住位置

「检查目标是否再次转移」
出處：`sources/text/command-threat-redirection.json` 字元 928-938 `loop[3].zh`
顯示：檢查目標是否再次轉移

## 玩家取捨

「把所有敌人拉来可能保护队友，也可能超过自己的承伤能力。」
出處：`sources/text/command-threat-redirection.json` 字元 1045-1072 `decisions[0].zh`
顯示：把所有敵人拉來可能保護隊友，也可能超過自己的承傷能力。

「立即拉走敌人，还是等队友用完位移后再接手？」
出處：`sources/text/command-threat-redirection.json` 字元 1189-1210 `decisions[1].zh`
顯示：立即拉走敵人，還是等隊友用完位移後再接手？

## 可調參數

「威胁持续时间」
出處：`sources/text/command-threat-redirection.json` 字元 1359-1365 `parameters[0].name.zh`
顯示：威脅持續時間

「持续短需要反复维护，持续长则更依赖一次正确选人。」
出處：`sources/text/command-threat-redirection.json` 字元 1442-1466 `parameters[0].effect.zh`
顯示：持續短需要反覆維護，持續長則更依賴一次正確選人。

「目标切换提示」
出處：`sources/text/command-threat-redirection.json` 字元 1614-1620 `parameters[1].name.zh`
顯示：目標切換提示

「明确显示目标变化，让玩家能判断保护是否生效。」
出處：`sources/text/command-threat-redirection.json` 字元 1704-1726 `parameters[1].effect.zh`
顯示：明確顯示目標變化，讓玩家能判斷保護是否生效。

## 原型

「做两个友方单位、两个敌人和一种强制换目标效果。」
出處：`sources/text/command-threat-redirection.json` 字元 3058-3081 `prototype.firstStep.zh`
顯示：做兩個友方單位、兩個敵人和一種強制換目標效果。

「玩家是否能看出敌人换了目标，并据此移动或治疗？」
出處：`sources/text/command-threat-redirection.json` 字元 3339-3362 `prototype.test.zh`
顯示：玩家是否能看出敵人換了目標，並據此移動或治療？

「别让嘲讽变成永远安全的按钮；承伤与位置要产生后果。」
出處：`sources/text/command-threat-redirection.json` 字元 3198-3223 `prototype.pitfall.zh`
顯示：別讓嘲諷變成永遠安全的按鈕；承傷與位置要產生後果。

## 相關模式

- [集中火力決策](command-focus-fire.md)
- [前線掩護](command-frontline-shielding.md)
- [先攻順序](command-initiative-order.md)
- [戰前陣型](command-prebattle-formation.md)

## 參考來源

- [Redirect enemy attention — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/command-threat-redirection/) — 查閱：2026-11-02；取得方式：page-text。
