---
{
  "schema_version": 2,
  "id": "survival-bleeding-triage",
  "title": "失血分診",
  "title_en": "Bleeding and urgent bandaging",
  "category": "survival",
  "source_category": "survival",
  "tags": [
    "planning",
    "risk"
  ],
  "summary": "先阻止伤势继续扩大，再考虑把生命补满。",
  "note_status": "draft",
  "related": [
    "survival-competing-needs",
    "survival-fatigue-rest",
    "survival-limb-impairment",
    "survival-safe-water"
  ],
  "sources": [
    {
      "title": "Bleeding and urgent bandaging — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/survival-bleeding-triage/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先阻止伤势继续扩大，再考虑把生命补满。」
出處：`sources/text/survival-bleeding-triage.json` 字元 186-205 `summary.zh`
顯示：先阻止傷勢繼續擴大，再考慮把生命補滿。

## 規則

「受伤后除了立即损失生命，还可能持续失血。玩家在移动、战斗和包扎之间选择时机；处理伤口可以止住持续损失，却不会立即恢复全部伤势。」
出處：`sources/text/survival-bleeding-triage.json` 字元 301-364 `rules.zh`
顯示：受傷後除了立即損失生命，還可能持續失血。玩家在移動、戰鬥和包紮之間選擇時機；處理傷口可以止住持續損失，卻不會立即恢復全部傷勢。

## 核心循環

「发现出血与剩余时间」
出處：`sources/text/survival-bleeding-triage.json` 字元 595-604 `loop[0].zh`
顯示：發現出血與剩餘時間

「找短暂安全窗口」
出處：`sources/text/survival-bleeding-triage.json` 字元 675-682 `loop[1].zh`
顯示：找短暫安全窗口

「消耗材料处理伤口」
出處：`sources/text/survival-bleeding-triage.json` 字元 750-758 `loop[2].zh`
顯示：消耗材料處理傷口

「脱险后恢复其他伤势」
出處：`sources/text/survival-bleeding-triage.json` 字元 832-841 `loop[3].zh`
顯示：脫險後恢復其他傷勢

## 玩家取捨

「原地包扎有被打断风险，先跑又会继续失血。」
出處：`sources/text/survival-bleeding-triage.json` 字元 945-965 `decisions[0].zh`
顯示：原地包紮有被打斷風險，先跑又會繼續失血。

「材料有限时，应先处理流血最快的伤口。」
出處：`sources/text/survival-bleeding-triage.json` 字元 1074-1092 `decisions[1].zh`
顯示：材料有限時，應先處理流血最快的傷口。

## 可調參數

「失血速度」
出處：`sources/text/survival-bleeding-triage.json` 字元 1237-1241 `parameters[0].name.zh`

「快失血强调即时避险；慢失血允许艰难返程。」
出處：`sources/text/survival-bleeding-triage.json` 字元 1313-1333 `parameters[0].effect.zh`
顯示：快失血強調即時避險；慢失血允許艱難返程。

「治疗打断规则」
出處：`sources/text/survival-bleeding-triage.json` 字元 1487-1493 `parameters[1].name.zh`
顯示：治療打斷規則

「允许保留部分进度会鼓励分段治疗；重置进度更需要完整安全窗口。」
出處：`sources/text/survival-bleeding-triage.json` 字元 1577-1607 `parameters[1].effect.zh`
顯示：允許保留部分進度會鼓勵分段治療；重置進度更需要完整安全窗口。

## 原型

「一个出血状态、一个可中断包扎动作和一条撤退路线就能验证。」
出處：`sources/text/survival-bleeding-triage.json` 字元 2946-2974 `prototype.firstStep.zh`
顯示：一個出血狀態、一個可中斷包紮動作和一條撤退路線就能驗證。

「记录玩家能否解释为什么先包扎或先移动。」
出處：`sources/text/survival-bleeding-triage.json` 字元 3253-3272 `prototype.test.zh`
顯示：記錄玩家能否解釋爲什麼先包紮或先移動。

「大量伤口类型会分散核心判断；先只做轻重两级出血。」
出處：`sources/text/survival-bleeding-triage.json` 字元 3106-3130 `prototype.pitfall.zh`
顯示：大量傷口類型會分散核心判斷；先只做輕重兩級出血。

## 相關模式

- [競爭需求](survival-competing-needs.md)
- [疲勞休息點](survival-fatigue-rest.md)
- [肢體機能受損](survival-limb-impairment.md)
- [取水與淨水決策](survival-safe-water.md)

## 參考來源

- [Bleeding and urgent bandaging — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/survival-bleeding-triage/) — 查閱：2026-11-02；取得方式：page-text。
