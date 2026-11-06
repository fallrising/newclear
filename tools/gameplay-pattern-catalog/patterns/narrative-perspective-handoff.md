---
{
  "schema_version": 2,
  "id": "narrative-perspective-handoff",
  "title": "視角交接",
  "title_en": "Continue earlier consequences through another character",
  "category": "narrative",
  "source_category": "narrative",
  "tags": [
    "narrative",
    "information",
    "planning"
  ],
  "summary": "换了视角，也要接住上一个角色留下的局面。",
  "note_status": "draft",
  "related": [
    "narrative-background-dialogue-access",
    "narrative-conversation-intervention",
    "narrative-delayed-choice-consequences",
    "narrative-deliberate-silence"
  ],
  "sources": [
    {
      "title": "Continue earlier consequences through another character — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/narrative-perspective-handoff/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「换了视角，也要接住上一个角色留下的局面。」
出處：`sources/text/narrative-perspective-handoff.json` 字元 221-241 `summary.zh`
顯示：換了視角，也要接住上一個角色留下的局面。

## 規則

「一条故事由多个可操控角色共同推进，角色拥有不同目标和信息。玩家先以某个角色作出选择，再在另一视角中遇到它造成的局面；切换可以由章节安排，也可以让玩家在允许的节点主动跳转。」
出處：`sources/text/narrative-perspective-handoff.json` 字元 356-441 `rules.zh`
顯示：一條故事由多個可操控角色共同推進，角色擁有不同目標和信息。玩家先以某個角色作出選擇，再在另一視角中遇到它造成的局面；切換可以由章節安排，也可以讓玩家在允許的節點主動跳轉。

## 核心循環

「以当前角色处理眼前目标」
出處：`sources/text/narrative-perspective-handoff.json` 字元 734-745 `loop[0].zh`
顯示：以當前角色處理眼前目標

「留下会影响别人的结果」
出處：`sources/text/narrative-perspective-handoff.json` 字元 824-834 `loop[1].zh`
顯示：留下會影響別人的結果

「切到另一角色面对结果」
出處：`sources/text/narrative-perspective-handoff.json` 字元 914-924 `loop[2].zh`
顯示：切到另一角色面對結果

「重新选择并影响后续视角」
出處：`sources/text/narrative-perspective-handoff.json` 字元 1010-1021 `loop[3].zh`
顯示：重新選擇並影響後續視角

## 玩家取捨

「为了当前角色方便，是否愿意给另一角色制造麻烦？」
出處：`sources/text/narrative-perspective-handoff.json` 字元 1126-1149 `decisions[0].zh`
顯示：爲了當前角色方便，是否願意給另一角色製造麻煩？

「玩家知道的事实，是否该让尚不知情的角色据此行动？」
出處：`sources/text/narrative-perspective-handoff.json` 字元 1250-1274 `decisions[1].zh`
顯示：玩家知道的事實，是否該讓尚不知情的角色據此行動？

## 可調參數

「切换控制权」
出處：`sources/text/narrative-perspective-handoff.json` 字元 1442-1447 `parameters[0].name.zh`
顯示：切換控制權

「固定切换便于安排节奏；自由跳转增加查找因果的空间，也需要清晰的时间标记。」
出處：`sources/text/narrative-perspective-handoff.json` 字元 1539-1575 `parameters[0].effect.zh`
顯示：固定切換便於安排節奏；自由跳轉增加查找因果的空間，也需要清晰的時間標記。

「跨视角影响的数量」
出處：`sources/text/narrative-perspective-handoff.json` 字元 1749-1757 `parameters[1].name.zh`
顯示：跨視角影響的數量

「先让一个行动改变另一场景，比让所有人物互相牵连更容易理解和制作。」
出處：`sources/text/narrative-perspective-handoff.json` 字元 1852-1884 `parameters[1].effect.zh`
顯示：先讓一個行動改變另一場景，比讓所有人物互相牽連更容易理解和製作。

## 原型

「做两位角色、同一地点的两个视角和一个共享门锁状态。」
出處：`sources/text/narrative-perspective-handoff.json` 字元 3420-3445 `prototype.firstStep.zh`
顯示：做兩位角色、同一地點的兩個視角和一個共享門鎖狀態。

「切换后玩家能否指出当前障碍来自自己先前的哪个行动？」
出處：`sources/text/narrative-perspective-handoff.json` 字元 3732-3757 `prototype.test.zh`
顯示：切換後玩家能否指出當前障礙來自自己先前的哪個行動？

「要区分角色知道什么与玩家知道什么，并让时间顺序可以追踪。」
出處：`sources/text/narrative-perspective-handoff.json` 字元 3571-3599 `prototype.pitfall.zh`
顯示：要區分角色知道什麼與玩家知道什麼，並讓時間順序可以追蹤。

## 相關模式

- [背景事件對話進出](narrative-background-dialogue-access.md)
- [對話介入](narrative-conversation-intervention.md)
- [延遲選擇後果](narrative-delayed-choice-consequences.md)
- [刻意沉默](narrative-deliberate-silence.md)

## 參考來源

- [Continue earlier consequences through another character — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/narrative-perspective-handoff/) — 查閱：2026-11-02；取得方式：page-text。
