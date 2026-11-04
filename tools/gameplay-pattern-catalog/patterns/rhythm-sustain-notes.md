---
{
  "schema_version": 2,
  "id": "rhythm-sustain-notes",
  "title": "按住長音的時值判斷",
  "title_en": "Hold through a sustained note",
  "category": "rhythm",
  "source_category": "rhythm",
  "tags": [
    "timing",
    "precision",
    "dexterity"
  ],
  "summary": "按准开头只是开始，还要把输入保持到指定终点。",
  "note_status": "draft",
  "related": [
    "rhythm-cue-response",
    "rhythm-hidden-beats",
    "rhythm-onbeat-actions",
    "cooking-measurement-precision"
  ],
  "sources": [
    {
      "title": "Hold through a sustained note — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/rhythm-sustain-notes/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「按准开头只是开始，还要把输入保持到指定终点。」
出處：`sources/text/rhythm-sustain-notes.json` 字元 179-201 `summary.zh`
顯示：按準開頭只是開始，還要把輸入保持到指定終點。

## 規則

「长音标出开始和持续区段，玩家到点按下后必须维持对应输入。过早松开会丢失后续判定或收益；若同时出现别的提示，还要在保持长按的同时处理它。结束时是否另判一次松手，应由具体规则明确。」
出處：`sources/text/rhythm-sustain-notes.json` 字元 333-421 `rules.zh`
顯示：長音標出開始和持續區段，玩家到點按下後必須維持對應輸入。過早鬆開會丟失後續判定或收益；若同時出現別的提示，還要在保持長按的同時處理它。結束時是否另判一次鬆手，應由具體規則明確。

## 核心循環

「读出长音起点与长度」
出處：`sources/text/rhythm-sustain-notes.json` 字元 762-771 `loop[0].zh`
顯示：讀出長音起點與長度

「到点按下并持续保持」
出處：`sources/text/rhythm-sustain-notes.json` 字元 847-856 `loop[1].zh`
顯示：到點按下並持續保持

「兼顾长音期间的新提示」
出處：`sources/text/rhythm-sustain-notes.json` 字元 930-940 `loop[2].zh`
顯示：兼顧長音期間的新提示

「结束长音并准备下一个输入」
出處：`sources/text/rhythm-sustain-notes.json` 字元 1018-1030 `loop[3].zh`
顯示：結束長音並準備下一個輸入

## 玩家取捨

「长音还没结束时，怎样分配手指去处理另一条输入？」
出處：`sources/text/rhythm-sustain-notes.json` 字元 1137-1160 `decisions[0].zh`
顯示：長音還沒結束時，怎樣分配手指去處理另一條輸入？

「两个输入来不及兼顾时，要保住正在持续的长音，还是提前松开争取下一次命中？」
出處：`sources/text/rhythm-sustain-notes.json` 字元 1274-1310 `decisions[1].zh`
顯示：兩個輸入來不及兼顧時，要保住正在持續的長音，還是提前鬆開爭取下一次命中？

## 可調參數

「持续长度」
出處：`sources/text/rhythm-sustain-notes.json` 字元 1491-1495 `parameters[0].name.zh`
顯示：持續長度

「更长会占用手指更久，只有搭配清楚的节奏变化才不容易变成单纯等待。」
出處：`sources/text/rhythm-sustain-notes.json` 字元 1568-1600 `parameters[0].effect.zh`
顯示：更長會佔用手指更久，只有搭配清楚的節奏變化纔不容易變成單純等待。

「长按期间的并行输入」
出處：`sources/text/rhythm-sustain-notes.json` 字元 1770-1779 `parameters[1].name.zh`
顯示：長按期間的並行輸入

「加入另一轨的短音能测试协调；应逐步增加，避免第一次就要求复杂指法。」
出處：`sources/text/rhythm-sustain-notes.json` 字元 1861-1894 `parameters[1].effect.zh`
顯示：加入另一軌的短音能測試協調；應逐步增加，避免第一次就要求複雜指法。

「松手判定」
出處：`sources/text/rhythm-sustain-notes.json` 字元 2079-2083 `parameters[2].name.zh`
顯示：鬆手判定

「只要求按够时长更易理解；额外判定松手时刻会增加一个独立的精准操作。」
出處：`sources/text/rhythm-sustain-notes.json` 字元 2161-2194 `parameters[2].effect.zh`
顯示：只要求按夠時長更易理解；額外判定鬆手時刻會增加一個獨立的精準操作。

## 原型

「只做两个键、四个长音和两个穿插短音；显示长音起止以及保持是否中断。」
出處：`sources/text/rhythm-sustain-notes.json` 字元 3780-3813 `prototype.firstStep.zh`
顯示：只做兩個鍵、四個長音和兩個穿插短音；顯示長音起止以及保持是否中斷。

「玩家能否指出自己是开头没按准，还是中途松开导致丢分？」
出處：`sources/text/rhythm-sustain-notes.json` 字元 4176-4202 `prototype.test.zh`
顯示：玩家能否指出自己是開頭沒按準，還是中途鬆開導致丟分？

「只在起点判定会让长按变成装饰；每帧乱扣分又会让一次误松被重复惩罚。」
出處：`sources/text/rhythm-sustain-notes.json` 字元 3974-4007 `prototype.pitfall.zh`
顯示：只在起點判定會讓長按變成裝飾；每幀亂扣分又會讓一次誤松被重複懲罰。

## 相關模式

- [提示回應](rhythm-cue-response.md)
- [提示消失後的內在節拍](rhythm-hidden-beats.md)
- [拍點上動作](rhythm-onbeat-actions.md)
- [計量精度](cooking-measurement-precision.md)

## 參考來源

- [Hold through a sustained note — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/rhythm-sustain-notes/) — 查閱：2026-11-02；取得方式：page-text。
