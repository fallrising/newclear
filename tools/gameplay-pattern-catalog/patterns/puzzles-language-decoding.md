---
{
  "schema_version": 2,
  "id": "puzzles-language-decoding",
  "title": "語言解碼",
  "title_en": "Decoding language from context",
  "category": "puzzles",
  "source_category": "puzzles",
  "tags": [
    "information",
    "discovery",
    "narrative"
  ],
  "summary": "从行为、图像和重复词形推测一句话的含义。",
  "note_status": "draft",
  "related": [
    "puzzles-scene-deduction",
    "puzzles-visual-rule-learning",
    "commerce-interpret-orders",
    "puzzles-box-pushing"
  ],
  "sources": [
    {
      "title": "Decoding language from context — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/puzzles-language-decoding/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「从行为、图像和重复词形推测一句话的含义。」
出處：`sources/text/puzzles-language-decoding.json` 字元 186-206 `summary.zh`
顯示：從行爲、圖像和重複詞形推測一句話的含義。

## 規則

「玩家将陌生文字与场景、行为和重复语句对照，提出词义假设。新上下文会支持或推翻判断；翻译使指示或历史变得可理解，再反过来指导下一次调查。」
出處：`sources/text/puzzles-language-decoding.json` 字元 310-377 `rules.zh`
顯示：玩家將陌生文字與場景、行爲和重複語句對照，提出詞義假設。新上下文會支持或推翻判斷；翻譯使指示或歷史變得可理解，再反過來指導下一次調查。

## 核心循環

「收集带语境的文字」
出處：`sources/text/puzzles-language-decoding.json` 字元 634-642 `loop[0].zh`
顯示：收集帶語境的文字

「比较重复符号」
出處：`sources/text/puzzles-language-decoding.json` 字元 712-718 `loop[1].zh`
顯示：比較重複符號

「填写或选择词义」
出處：`sources/text/puzzles-language-decoding.json` 字元 787-794 `loop[2].zh`
顯示：填寫或選擇詞義

「用新语境检验」
出處：`sources/text/puzzles-language-decoding.json` 字元 863-869 `loop[3].zh`
顯示：用新語境檢驗

## 玩家取捨

「符号是人名、动作还是类别，哪种解释更广？」
出處：`sources/text/puzzles-language-decoding.json` 字元 958-978 `decisions[0].zh`
顯示：符號是人名、動作還是類別，哪種解釋更廣？

「使用不确定译文推进，还是寻找第二条证据？」
出處：`sources/text/puzzles-language-decoding.json` 字元 1086-1106 `decisions[1].zh`
顯示：使用不確定譯文推進，還是尋找第二條證據？

## 可調參數

「验证时机」
出處：`sources/text/puzzles-language-decoding.json` 字元 1249-1253 `parameters[0].name.zh`
顯示：驗證時機

「即时确认给进展感；延后确认保留考古式不确定性。」
出處：`sources/text/puzzles-language-decoding.json` 字元 1332-1355 `parameters[0].effect.zh`
顯示：即時確認給進展感；延後確認保留考古式不確定性。

「候选词提示」
出處：`sources/text/puzzles-language-decoding.json` 字元 1509-1514 `parameters[1].name.zh`
顯示：候選詞提示

「候选词降低门槛；自由输入强调自主归纳。」
出處：`sources/text/puzzles-language-decoding.json` 字元 1594-1613 `parameters[1].effect.zh`
顯示：候選詞降低門檻；自由輸入強調自主歸納。

## 原型

「设计六个符号、三处互相印证的场景和可修改的个人词典。」
出處：`sources/text/puzzles-language-decoding.json` 字元 3083-3109 `prototype.firstStep.zh`
顯示：設計六個符號、三處互相印證的場景和可修改的個人詞典。

「给出未见过但使用已知词的句子，观察玩家能否解释并采取正确行动。」
出處：`sources/text/puzzles-language-decoding.json` 字元 3437-3468 `prototype.test.zh`
顯示：給出未見過但使用已知詞的句子，觀察玩家能否解釋並採取正確行動。

「先别写庞大语言；同一个词需要足够上下文，才能支持推理而非记忆配对。」
出處：`sources/text/puzzles-language-decoding.json` 字元 3248-3281 `prototype.pitfall.zh`
顯示：先別寫龐大語言；同一個詞需要足夠上下文，才能支持推理而非記憶配對。

## 相關模式

- [現場推理](puzzles-scene-deduction.md)
- [視覺規則學習](puzzles-visual-rule-learning.md)
- [顧客訂單的解讀](commerce-interpret-orders.md)
- [不可逆推動與位置可達性](puzzles-box-pushing.md)

## 參考來源

- [Decoding language from context — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/puzzles-language-decoding/) — 查閱：2026-11-02；取得方式：page-text。
