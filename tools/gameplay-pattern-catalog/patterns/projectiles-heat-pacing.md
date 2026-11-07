---
{
  "schema_version": 2,
  "id": "projectiles-heat-pacing",
  "title": "熱度節奏",
  "title_en": "Stop firing before overheating",
  "category": "projectiles",
  "source_category": "projectiles",
  "tags": [
    "timing",
    "risk",
    "optimization"
  ],
  "summary": "现在多打一会儿，可能换来之后更长的一段无法射击。",
  "note_status": "draft",
  "related": [
    "projectiles-active-reload",
    "projectiles-charged-release",
    "projectiles-spread-recovery",
    "defense-early-wave-call"
  ],
  "sources": [
    {
      "title": "Stop firing before overheating — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/projectiles-heat-pacing/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「现在多打一会儿，可能换来之后更长的一段无法射击。」
出處：`sources/text/projectiles-heat-pacing.json` 字元 189-213 `summary.zh`
顯示：現在多打一會兒，可能換來之後更長的一段無法射擊。

## 規則

「开火持续积累热量，松开后冷却；越过临界点会触发更长停机或其他明确惩罚。玩家观察热量和敌人状态，在主动短停与强行补完最后一击之间取舍。热量管理与弹药管理可以并存。」
出處：`sources/text/projectiles-heat-pacing.json` 字元 321-401 `rules.zh`
顯示：開火持續積累熱量，鬆開後冷卻；越過臨界點會觸發更長停機或其他明確懲罰。玩家觀察熱量和敵人狀態，在主動短停與強行補完最後一擊之間取捨。熱量管理與彈藥管理可以並存。

## 核心循環

「查看热量和当前威胁」
出處：`sources/text/projectiles-heat-pacing.json` 字元 704-713 `loop[0].zh`
顯示：查看熱量和當前威脅

「开火到接近临界点」
出處：`sources/text/projectiles-heat-pacing.json` 字元 789-797 `loop[1].zh`
顯示：開火到接近臨界點

「主动冷却或冒险继续」
出處：`sources/text/projectiles-heat-pacing.json` 字元 866-875 `loop[2].zh`
顯示：主動冷卻或冒險繼續

「恢复后安排下一段射击」
出處：`sources/text/projectiles-heat-pacing.json` 字元 954-964 `loop[3].zh`
顯示：恢復後安排下一段射擊

## 玩家取捨

「敌人只剩少量生命时，是否值得让武器过热来确保击杀？」
出處：`sources/text/projectiles-heat-pacing.json` 字元 1071-1096 `decisions[0].zh`
顯示：敵人只剩少量生命時，是否值得讓武器過熱來確保擊殺？

「冷却时换副武器，还是继续保持主武器瞄准等待？」
出處：`sources/text/projectiles-heat-pacing.json` 字元 1195-1217 `decisions[1].zh`
顯示：冷卻時換副武器，還是繼續保持主武器瞄準等待？

## 可調參數

「正常冷却与过热停机差距」
出處：`sources/text/projectiles-heat-pacing.json` 字元 1366-1377 `parameters[0].name.zh`
顯示：正常冷卻與過熱停機差距

「差距越大，提前停火越重要；差距太小则很难形成取舍。」
出處：`sources/text/projectiles-heat-pacing.json` 字元 1471-1496 `parameters[0].effect.zh`
顯示：差距越大，提前停火越重要；差距太小則很難形成取捨。

「临界提示」
出處：`sources/text/projectiles-heat-pacing.json` 字元 1650-1654 `parameters[1].name.zh`
顯示：臨界提示

「声音、颜色和动画共同提示接近过热，让玩家不用一直盯着仪表。」
出處：`sources/text/projectiles-heat-pacing.json` 字元 1734-1763 `parameters[1].effect.zh`
顯示：聲音、顏色和動畫共同提示接近過熱，讓玩家不用一直盯着儀表。

## 原型

「做一根热量条、正常冷却和过热锁定两种状态，配一个持续接近的靶子。」
出處：`sources/text/projectiles-heat-pacing.json` 字元 3231-3263 `prototype.firstStep.zh`
顯示：做一根熱量條、正常冷卻和過熱鎖定兩種狀態，配一個持續接近的靶子。

「玩家是否会在临界前主动松手，而不是每次都等系统强制停机？」
出處：`sources/text/projectiles-heat-pacing.json` 字元 3569-3597 `prototype.test.zh`
顯示：玩家是否會在臨界前主動鬆手，而不是每次都等系統強制停機？

「不要让热量条看似线性、实际临界点却无法预测。」
出處：`sources/text/projectiles-heat-pacing.json` 字元 3407-3429 `prototype.pitfall.zh`
顯示：不要讓熱量條看似線性、實際臨界點卻無法預測。

## 相關模式

- [主動裝填](projectiles-active-reload.md)
- [蓄力後釋放](projectiles-charged-release.md)
- [停火以收回彈道散布](projectiles-spread-recovery.md)
- [提早呼叫下一波](defense-early-wave-call.md)

## 參考來源

- [Stop firing before overheating — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/projectiles-heat-pacing/) — 查閱：2026-11-02；取得方式：page-text。
