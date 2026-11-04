---
{
  "schema_version": 2,
  "id": "rhythm-cue-response",
  "title": "提示回應",
  "title_en": "Answer a cue on its target beat",
  "category": "rhythm",
  "source_category": "rhythm",
  "tags": [
    "timing",
    "information",
    "precision"
  ],
  "summary": "不是听到声音就按，而是认出提示后等到该你回应的那一拍。",
  "note_status": "draft",
  "related": [
    "rhythm-hidden-beats",
    "rhythm-sustain-notes",
    "puzzles-time-scrubbing",
    "rhythm-onbeat-actions"
  ],
  "sources": [
    {
      "title": "Answer a cue on its target beat — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/rhythm-cue-response/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「不是听到声音就按，而是认出提示后等到该你回应的那一拍。」
出處：`sources/text/rhythm-cue-response.json` 字元 183-210 `summary.zh`
顯示：不是聽到聲音就按，而是認出提示後等到該你回應的那一拍。

## 規則

「系统先给声音或动作提示，玩家根据已学会的规则推算回应时机，再用简短操作接上节奏。不同提示可以要求不同间隔；判定后立即反馈早了、晚了或正好。本条关注提示与回应的对应关系，不要求每拍都做动作。」
出處：`sources/text/rhythm-cue-response.json` 字元 332-426 `rules.zh`
顯示：系統先給聲音或動作提示，玩家根據已學會的規則推算回應時機，再用簡短操作接上節奏。不同提示可以要求不同間隔；判定後立即反饋早了、晚了或正好。本條關注提示與回應的對應關係，不要求每拍都做動作。

## 核心循環

「辨认刚出现的提示」
出處：`sources/text/rhythm-cue-response.json` 字元 785-793 `loop[0].zh`
顯示：辨認剛出現的提示

「按提示规则等待或数拍」
出處：`sources/text/rhythm-cue-response.json` 字元 854-864 `loop[1].zh`
顯示：按提示規則等待或數拍

「在目标拍执行回应」
出處：`sources/text/rhythm-cue-response.json` 字元 946-954 `loop[2].zh`
顯示：在目標拍執行回應

「利用反馈接住下一次提示」
出處：`sources/text/rhythm-cue-response.json` 字元 1024-1035 `loop[3].zh`
顯示：利用反饋接住下一次提示

## 玩家取捨

「这段提示要求立刻接上，还是留出几拍再回应？」
出處：`sources/text/rhythm-cue-response.json` 字元 1134-1155 `decisions[0].zh`
顯示：這段提示要求立刻接上，還是留出幾拍再回應？

「两个提示接连出现时，哪一次回应先到，怎样避免被后一个提示带乱？」
出處：`sources/text/rhythm-cue-response.json` 字元 1270-1301 `decisions[1].zh`
顯示：兩個提示接連出現時，哪一次回應先到，怎樣避免被後一個提示帶亂？

## 可調參數

「提示到回应的间隔」
出處：`sources/text/rhythm-cue-response.json` 字元 1482-1490 `parameters[0].name.zh`
顯示：提示到回應的間隔

「间隔越长，越依赖保持节拍；间隔变化应先用清楚提示教会。」
出處：`sources/text/rhythm-cue-response.json` 字元 1576-1603 `parameters[0].effect.zh`
顯示：間隔越長，越依賴保持節拍；間隔變化應先用清楚提示教會。

「提示种类」
出處：`sources/text/rhythm-cue-response.json` 字元 1753-1757 `parameters[1].name.zh`
顯示：提示種類

「一种提示适合建立规则，多种提示会增加识别与切换负担。」
出處：`sources/text/rhythm-cue-response.json` 字元 1830-1856 `parameters[1].effect.zh`
顯示：一種提示適合建立規則，多種提示會增加識別與切換負擔。

「提示重叠量」
出處：`sources/text/rhythm-cue-response.json` 字元 2010-2015 `parameters[2].name.zh`
顯示：提示重疊量

「前一个回应还未结束就给新提示，会把简单反应变成多条节奏的协调。」
出處：`sources/text/rhythm-cue-response.json` 字元 2088-2119 `parameters[2].effect.zh`
顯示：前一個回應還未結束就給新提示，會把簡單反應變成多條節奏的協調。

## 原型

「用一个键、两种音色提示和两个固定等待间隔，提供可重复的练习段与早晚反馈。」
出處：`sources/text/rhythm-cue-response.json` 字元 3745-3781 `prototype.firstStep.zh`
顯示：用一個鍵、兩種音色提示和兩個固定等待間隔，提供可重複的練習段與早晚反饋。

「不看说明重试时，玩家能否预测下一次应该在哪一拍按？」
出處：`sources/text/rhythm-cue-response.json` 字元 4145-4170 `prototype.test.zh`
顯示：不看說明重試時，玩家能否預測下一次應該在哪一拍按？

「用几乎相同的音色表示完全不同的回应，会让失误来自辨认困难，而非节奏挑战。」
出處：`sources/text/rhythm-cue-response.json` 字元 3945-3981 `prototype.pitfall.zh`
顯示：用幾乎相同的音色表示完全不同的回應，會讓失誤來自辨認困難，而非節奏挑戰。

## 相關模式

- [提示消失後的內在節拍](rhythm-hidden-beats.md)
- [按住長音的時值判斷](rhythm-sustain-notes.md)
- [時間還原](puzzles-time-scrubbing.md)
- [拍點上動作](rhythm-onbeat-actions.md)

## 參考來源

- [Answer a cue on its target beat — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/rhythm-cue-response/) — 查閱：2026-11-02；取得方式：page-text。
