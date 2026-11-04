---
{
  "schema_version": 2,
  "id": "narrative-delayed-choice-consequences",
  "title": "延遲選擇後果",
  "title_en": "Let an earlier choice change a later event",
  "category": "narrative",
  "source_category": "narrative",
  "tags": [
    "narrative",
    "planning",
    "time"
  ],
  "summary": "眼前没有立即奖惩，后面的场景却记得你做过什么。",
  "note_status": "draft",
  "related": [
    "narrative-background-dialogue-access",
    "narrative-investigation-time-slots",
    "narrative-perspective-handoff",
    "farming-growth-care"
  ],
  "sources": [
    {
      "title": "Let an earlier choice change a later event — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/narrative-delayed-choice-consequences/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「眼前没有立即奖惩，后面的场景却记得你做过什么。」
出處：`sources/text/narrative-delayed-choice-consequences.json` 字元 216-239 `summary.zh`
顯示：眼前沒有立即獎懲，後面的場景卻記得你做過什麼。

## 規則

「玩家在当前事件中做决定，系统保存具体事实，例如答应过谁或让谁留下。经过其他事件后，后续场景读取这些事实，改变可用帮助、角色处境或回应。重点是跨事件的因果回响，而非只加减好感数值。」
出處：`sources/text/narrative-delayed-choice-consequences.json` 字元 368-457 `rules.zh`
顯示：玩家在當前事件中做決定，系統保存具體事實，例如答應過誰或讓誰留下。經過其他事件後，後續場景讀取這些事實，改變可用幫助、角色處境或回應。重點是跨事件的因果迴響，而非只加減好感數值。

## 核心循環

「作出当前选择」
出處：`sources/text/narrative-delayed-choice-consequences.json` 字元 781-787 `loop[0].zh`
顯示：作出當前選擇

「带着记录继续经历事件」
出處：`sources/text/narrative-delayed-choice-consequences.json` 字元 854-864 `loop[1].zh`
顯示：帶着記錄繼續經歷事件

「在后来的场景遇到回响」
出處：`sources/text/narrative-delayed-choice-consequences.json` 字元 945-955 `loop[2].zh`
顯示：在後來的場景遇到迴響

「依据新局面再次决策」
出處：`sources/text/narrative-delayed-choice-consequences.json` 字元 1036-1045 `loop[3].zh`
顯示：依據新局面再次決策

## 玩家取捨

「接受眼前的便利，还是保护暂时看不到回报的承诺？」
出處：`sources/text/narrative-delayed-choice-consequences.json` 字元 1147-1170 `decisions[0].zh`
顯示：接受眼前的便利，還是保護暫時看不到回報的承諾？

「发现过去选择的代价后，要坚持还是尝试补救？」
出處：`sources/text/narrative-delayed-choice-consequences.json` 字元 1288-1309 `decisions[1].zh`
顯示：發現過去選擇的代價後，要堅持還是嘗試補救？

## 可調參數

「回响间隔」
出處：`sources/text/narrative-delayed-choice-consequences.json` 字元 1467-1471 `parameters[0].name.zh`
顯示：迴響間隔

「间隔越长越需要角色、物件或台词提醒因果，避免玩家忘记。」
出處：`sources/text/narrative-delayed-choice-consequences.json` 字元 1557-1584 `parameters[0].effect.zh`
顯示：間隔越長越需要角色、物件或臺詞提醒因果，避免玩家忘記。

「保存的事实数量」
出處：`sources/text/narrative-delayed-choice-consequences.json` 字元 1755-1762 `parameters[1].name.zh`
顯示：保存的事實數量

「少量能互相影响的事实更容易验证；大量分支组合会迅速增加写作和测试负担。」
出處：`sources/text/narrative-delayed-choice-consequences.json` 字元 1848-1883 `parameters[1].effect.zh`
顯示：少量能互相影響的事實更容易驗證；大量分支組合會迅速增加寫作和測試負擔。

## 原型

「只保存一个承诺，让两个后续场景读它；准备完整的两条结果。」
出處：`sources/text/narrative-delayed-choice-consequences.json` 字元 3428-3456 `prototype.firstStep.zh`
顯示：只保存一個承諾，讓兩個後續場景讀它；準備完整的兩條結果。

「回响发生时，玩家能否想起原选择，并理解中间的因果？」
出處：`sources/text/narrative-delayed-choice-consequences.json` 字元 3744-3769 `prototype.test.zh`
顯示：迴響發生時，玩家能否想起原選擇，並理解中間的因果？

「只显示“某人会记住”却没有后续变化，会削弱玩家对选择的信任。」
出處：`sources/text/narrative-delayed-choice-consequences.json` 字元 3590-3620 `prototype.pitfall.zh`
顯示：只顯示“某人會記住”卻沒有後續變化，會削弱玩家對選擇的信任。

## 相關模式

- [背景事件對話進出](narrative-background-dialogue-access.md)
- [調查時間時段](narrative-investigation-time-slots.md)
- [視角交接](narrative-perspective-handoff.md)
- [照料排程與延遲收成](farming-growth-care.md)

## 參考來源

- [Let an earlier choice change a later event — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/narrative-delayed-choice-consequences/) — 查閱：2026-11-02；取得方式：page-text。
