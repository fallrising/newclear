---
{
  "schema_version": 2,
  "id": "stealth-staged-accidents",
  "title": "分階環境事故",
  "title_en": "Staging environmental accidents",
  "category": "stealth",
  "source_category": "stealth",
  "tags": [
    "planning",
    "timing",
    "creativity"
  ],
  "summary": "先读懂物件与巡逻的关系，再让环境完成最后一步。",
  "note_status": "draft",
  "related": [
    "stealth-synchronized-actions",
    "exploration-stealth-awareness",
    "puzzles-paper-folding",
    "puzzles-time-scrubbing"
  ],
  "sources": [
    {
      "title": "Staging environmental accidents — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/stealth-staged-accidents/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先读懂物件与巡逻的关系，再让环境完成最后一步。」
出處：`sources/text/stealth-staged-accidents.json` 字元 184-207 `summary.zh`
顯示：先讀懂物件與巡邏的關係，再讓環境完成最後一步。

## 規則

「场景中有可触发的危险物件，目标会在某些时刻进入影响范围。玩家观察路线、准备机关并等待合适窗口；成功取决于位置和因果顺序，而不只是瞄准目标。」
出處：`sources/text/stealth-staged-accidents.json` 字元 332-401 `rules.zh`
顯示：場景中有可觸發的危險物件，目標會在某些時刻進入影響範圍。玩家觀察路線、準備機關並等待合適窗口；成功取決於位置和因果順序，而不只是瞄準目標。

## 核心循環

「找出环境危险点」
出處：`sources/text/stealth-staged-accidents.json` 字元 633-640 `loop[0].zh`
顯示：找出環境危險點

「确认目标经过的时机」
出處：`sources/text/stealth-staged-accidents.json` 字元 716-725 `loop[1].zh`
顯示：確認目標經過的時機

「布置或接近触发位置」
出處：`sources/text/stealth-staged-accidents.json` 字元 799-808 `loop[2].zh`
顯示：佈置或接近觸發位置

「触发后撤离」
出處：`sources/text/stealth-staged-accidents.json` 字元 880-885 `loop[3].zh`
顯示：觸發後撤離

## 玩家取捨

「等待目标自然经过最稳妥，还是主动引导以节省时间？」
出處：`sources/text/stealth-staged-accidents.json` 字元 970-994 `decisions[0].zh`
顯示：等待目標自然經過最穩妥，還是主動引導以節省時間？

「危险范围里还有无关人物时，放弃本轮窗口还是换一种方法？」
出處：`sources/text/stealth-staged-accidents.json` 字元 1104-1131 `decisions[1].zh`
顯示：危險範圍裏還有無關人物時，放棄本輪窗口還是換一種方法？

## 可調參數

「可触发窗口」
出處：`sources/text/stealth-staged-accidents.json` 字元 1295-1300 `parameters[0].name.zh`
顯示：可觸發窗口

「窗口越窄越像时机挑战；窗口宽时重点转向路线与准备。」
出處：`sources/text/stealth-staged-accidents.json` 字元 1376-1401 `parameters[0].effect.zh`
顯示：窗口越窄越像時機挑戰；窗口寬時重點轉向路線與準備。

「危险范围可读性」
出處：`sources/text/stealth-staged-accidents.json` 字元 1552-1559 `parameters[1].name.zh`
顯示：危險範圍可讀性

「明确作用区能让失败变成可理解的误算，而不是猜物理结果。」
出處：`sources/text/stealth-staged-accidents.json` 字元 1639-1666 `parameters[1].effect.zh`
顯示：明確作用區能讓失敗變成可理解的誤算，而不是猜物理結果。

## 原型

「做一个固定巡逻目标、一个拉杆和一个明确标出的落物区域；先用确定性结果。」
出處：`sources/text/stealth-staged-accidents.json` 字元 3169-3204 `prototype.firstStep.zh`
顯示：做一個固定巡邏目標、一個拉桿和一個明確標出的落物區域；先用確定性結果。

「玩家看过一次结果后，能否准确预测调整触发时机会影响谁？」
出處：`sources/text/stealth-staged-accidents.json` 字元 3528-3555 `prototype.test.zh`
顯示：玩家看過一次結果後，能否準確預測調整觸發時機會影響誰？

「不要用不可预测的物理碰撞决定成败；先保证相同布置产生相同结果。」
出處：`sources/text/stealth-staged-accidents.json` 字元 3348-3379 `prototype.pitfall.zh`
顯示：不要用不可預測的物理碰撞決定成敗；先保證相同佈置產生相同結果。

## 相關模式

- [同步動作](stealth-synchronized-actions.md)
- [潛行警戒](exploration-stealth-awareness.md)
- [摺疊地形以連接路線](puzzles-paper-folding.md)
- [時間還原](puzzles-time-scrubbing.md)

## 參考來源

- [Staging environmental accidents — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/stealth-staged-accidents/) — 查閱：2026-11-02；取得方式：page-text。
