---
{
  "schema_version": 2,
  "id": "survival-temporary-relief",
  "title": "暫時緩解",
  "title_en": "Temporary symptom relief",
  "category": "survival",
  "source_category": "survival",
  "tags": [
    "timing",
    "risk"
  ],
  "summary": "处理症状可以争取行动窗口，但并不等于伤势已经恢复。",
  "note_status": "draft",
  "related": [
    "survival-bleeding-triage",
    "survival-competing-needs",
    "survival-fatigue-rest",
    "survival-limb-impairment"
  ],
  "sources": [
    {
      "title": "Temporary symptom relief — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/survival-temporary-relief/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「处理症状可以争取行动窗口，但并不等于伤势已经恢复。」
出處：`sources/text/survival-temporary-relief.json` 字元 182-207 `summary.zh`
顯示：處理症狀可以爭取行動窗口，但並不等於傷勢已經恢復。

## 規則

「症状和根本伤势分开记录。临时处理减轻某项惩罚，效果结束后问题可能仍在；玩家需要利用窗口返回安全点或完成真正的恢复。」
出處：`sources/text/survival-temporary-relief.json` 字元 333-390 `rules.zh`
顯示：症狀和根本傷勢分開記錄。臨時處理減輕某項懲罰，效果結束後問題可能仍在；玩家需要利用窗口返回安全點或完成真正的恢復。

## 核心循環

「确认症状限制了什么」
出處：`sources/text/survival-temporary-relief.json` 字元 633-642 `loop[0].zh`
顯示：確認症狀限制了什麼

「决定是否使用临时缓解」
出處：`sources/text/survival-temporary-relief.json` 字元 719-729 `loop[1].zh`
顯示：決定是否使用臨時緩解

「在有效期内行动」
出處：`sources/text/survival-temporary-relief.json` 字元 801-808 `loop[2].zh`
顯示：在有效期內行動

「结束前安排后续处理」
出處：`sources/text/survival-temporary-relief.json` 字元 880-889 `loop[3].zh`
顯示：結束前安排後續處理

## 玩家取捨

「现在缓解症状赶回营地，还是留给更危险的路段？」
出處：`sources/text/survival-temporary-relief.json` 字元 986-1008 `decisions[0].zh`
顯示：現在緩解症狀趕回營地，還是留給更危險的路段？

「趁暂时能行动继续探索，还是优先解决伤势？」
出處：`sources/text/survival-temporary-relief.json` 字元 1108-1128 `decisions[1].zh`
顯示：趁暫時能行動繼續探索，還是優先解決傷勢？

## 可調參數

「有效窗口」
出處：`sources/text/survival-temporary-relief.json` 字元 1254-1258 `parameters[0].name.zh`

「窗口要足以完成一个明确行动，过短会沦为反复补药。」
出處：`sources/text/survival-temporary-relief.json` 字元 1335-1359 `parameters[0].effect.zh`
顯示：窗口要足以完成一個明確行動，過短會淪爲反覆補藥。

「症状与伤势提示」
出處：`sources/text/survival-temporary-relief.json` 字元 1516-1523 `parameters[1].name.zh`
顯示：症狀與傷勢提示

「界面应同时保留伤势和缓解倒计时，避免让玩家误以为已经治愈。」
出處：`sources/text/survival-temporary-relief.json` 字元 1614-1643 `parameters[1].effect.zh`
顯示：界面應同時保留傷勢和緩解倒計時，避免讓玩家誤以爲已經治癒。

## 原型

「用一个伤势、一个独立症状和一枚可见倒计时做出撤离场景。」
出處：`sources/text/survival-temporary-relief.json` 字元 2989-3016 `prototype.firstStep.zh`
顯示：用一個傷勢、一個獨立症狀和一枚可見倒計時做出撤離場景。

「观察玩家是否能说清“现在能行动”与“伤已经好了”的区别。」
出處：`sources/text/survival-temporary-relief.json` 字元 3349-3377 `prototype.test.zh`
顯示：觀察玩家是否能說清“現在能行動”與“傷已經好了”的區別。

「缓解与治愈若使用同一种反馈会误导玩家；让症状图标变化，伤势图标保留。」
出處：`sources/text/survival-temporary-relief.json` 字元 3147-3181 `prototype.pitfall.zh`
顯示：緩解與治癒若使用同一種反饋會誤導玩家；讓症狀圖標變化，傷勢圖標保留。

## 相關模式

- [失血分診](survival-bleeding-triage.md)
- [競爭需求](survival-competing-needs.md)
- [疲勞休息點](survival-fatigue-rest.md)
- [肢體機能受損](survival-limb-impairment.md)

## 參考來源

- [Temporary symptom relief — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/survival-temporary-relief/) — 查閱：2026-11-02；取得方式：page-text。
