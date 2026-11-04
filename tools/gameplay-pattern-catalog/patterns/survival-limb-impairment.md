---
{
  "schema_version": 2,
  "id": "survival-limb-impairment",
  "title": "肢體機能受損",
  "title_en": "Injured limbs change capabilities",
  "category": "survival",
  "source_category": "survival",
  "tags": [
    "planning",
    "risk"
  ],
  "summary": "腿伤影响撤离，手伤影响作战，同样的掉血会产生不同的处理顺序。",
  "note_status": "draft",
  "related": [
    "survival-bleeding-triage",
    "survival-competing-needs",
    "survival-fatigue-rest",
    "survival-safe-water"
  ],
  "sources": [
    {
      "title": "Injured limbs change capabilities — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/survival-limb-impairment/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「腿伤影响撤离，手伤影响作战，同样的掉血会产生不同的处理顺序。」
出處：`sources/text/survival-limb-impairment.json` 字元 191-221 `summary.zh`
顯示：腿傷影響撤離，手傷影響作戰，同樣的掉血會產生不同的處理順序。

## 規則

「伤害落在具体部位，并削弱该部位关联的行动。玩家除了保住生命，还要判断哪项能力最急需恢复，并通过换人、保护或改变路线渡过恢复期。」
出處：`sources/text/survival-limb-impairment.json` 字元 366-429 `rules.zh`
顯示：傷害落在具體部位，並削弱該部位關聯的行動。玩家除了保住生命，還要判斷哪項能力最急需恢復，並通過換人、保護或改變路線渡過恢復期。

## 核心循環

「读取受伤位置和功能影响」
出處：`sources/text/survival-limb-impairment.json` 字元 678-689 `loop[0].zh`
顯示：讀取受傷位置和功能影響

「调整动作或队伍分工」
出處：`sources/text/survival-limb-impairment.json` 字元 770-779 `loop[1].zh`
顯示：調整動作或隊伍分工

「治疗并保护受伤者」
出處：`sources/text/survival-limb-impairment.json` 字元 851-859 `loop[2].zh`
顯示：治療並保護受傷者

「恢复后重新分配任务」
出處：`sources/text/survival-limb-impairment.json` 字元 932-941 `loop[3].zh`
顯示：恢復後重新分配任務

## 玩家取捨

「先治疗跑不动的侦察员，还是拿不稳武器的护卫？」
出處：`sources/text/survival-limb-impairment.json` 字元 1036-1058 `decisions[0].zh`
顯示：先治療跑不動的偵察員，還是拿不穩武器的護衛？

「带伤坚持原计划，还是改走允许慢速撤离的路线？」
出處：`sources/text/survival-limb-impairment.json` 字元 1167-1189 `decisions[1].zh`
顯示：帶傷堅持原計劃，還是改走允許慢速撤離的路線？

## 可調參數

「部位数量」
出處：`sources/text/survival-limb-impairment.json` 字元 1343-1347 `parameters[0].name.zh`
顯示：部位數量

「少量明确部位比很多差异不明显的部位更容易形成可读决策。」
出處：`sources/text/survival-limb-impairment.json` 字元 1426-1453 `parameters[0].effect.zh`
顯示：少量明確部位比很多差異不明顯的部位更容易形成可讀決策。

「功能损失强度」
出處：`sources/text/survival-limb-impairment.json` 字元 1600-1606 `parameters[1].name.zh`
顯示：功能損失強度

「完全失能会迫使替换，部分衰减则允许玩家评估是否硬撑。」
出處：`sources/text/survival-limb-impairment.json` 字元 1687-1713 `parameters[1].effect.zh`
顯示：完全失能會迫使替換，部分衰減則允許玩家評估是否硬撐。

## 原型

「用腿和手两类部位分别关联移动与攻击，只做一种治疗和一个替换角色。」
出處：`sources/text/survival-limb-impairment.json` 字元 3065-3097 `prototype.firstStep.zh`
顯示：用腿和手兩類部位分別關聯移動與攻擊，只做一種治療和一個替換角色。

「交换两人的受伤部位，看玩家是否改变分工，而不只是重复点治疗。」
出處：`sources/text/survival-limb-impairment.json` 字元 3409-3439 `prototype.test.zh`
顯示：交換兩人的受傷部位，看玩家是否改變分工，而不只是重複點治療。

「部位系统会牵动动画、装备与AI；原型先用图标和数值反馈。」
出處：`sources/text/survival-limb-impairment.json` 字元 3244-3272 `prototype.pitfall.zh`
顯示：部位系統會牽動動畫、裝備與AI；原型先用圖標和數值反饋。

## 相關模式

- [失血分診](survival-bleeding-triage.md)
- [競爭需求](survival-competing-needs.md)
- [疲勞休息點](survival-fatigue-rest.md)
- [取水與淨水決策](survival-safe-water.md)

## 參考來源

- [Injured limbs change capabilities — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/survival-limb-impairment/) — 查閱：2026-11-02；取得方式：page-text。
