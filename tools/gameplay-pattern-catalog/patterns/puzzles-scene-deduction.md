---
{
  "schema_version": 2,
  "id": "puzzles-scene-deduction",
  "title": "現場推理",
  "title_en": "Reconstructing events from evidence",
  "category": "puzzles",
  "source_category": "puzzles",
  "tags": [
    "information",
    "narrative",
    "discovery"
  ],
  "summary": "把零散可见事实连成一个可以检验的解释。",
  "note_status": "draft",
  "related": [
    "puzzles-language-decoding",
    "puzzles-visual-rule-learning",
    "commerce-interpret-orders",
    "puzzles-box-pushing"
  ],
  "sources": [
    {
      "title": "Reconstructing events from evidence — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/puzzles-scene-deduction/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把零散可见事实连成一个可以检验的解释。」
出處：`sources/text/puzzles-scene-deduction.json` 字元 188-207 `summary.zh`
顯示：把零散可見事實連成一個可以檢驗的解釋。

## 規則

「玩家检查可回访的场景，收集人物、物件、语言和时间线索，再填写身份、行为或因果关系。系统验证解释是否匹配证据，发现矛盾后可以返回场景继续观察。」
出處：`sources/text/puzzles-scene-deduction.json` 字元 298-368 `rules.zh`
顯示：玩家檢查可回訪的場景，收集人物、物件、語言和時間線索，再填寫身份、行爲或因果關係。系統驗證解釋是否匹配證據，發現矛盾後可以返回場景繼續觀察。

## 核心循環

「观察并记下事实」
出處：`sources/text/puzzles-scene-deduction.json` 字元 615-622 `loop[0].zh`
顯示：觀察並記下事實

「跨场景对照线索」
出處：`sources/text/puzzles-scene-deduction.json` 字元 690-697 `loop[1].zh`
顯示：跨場景對照線索

「提出身份与因果判断」
出處：`sources/text/puzzles-scene-deduction.json` 字元 765-774 `loop[2].zh`
顯示：提出身份與因果判斷

「验证并修正矛盾」
出處：`sources/text/puzzles-scene-deduction.json` 字元 846-853 `loop[3].zh`
顯示：驗證並修正矛盾

## 玩家取捨

「先确认少量可靠身份，还是同时提出完整故事？」
出處：`sources/text/puzzles-scene-deduction.json` 字元 953-974 `decisions[0].zh`
顯示：先確認少量可靠身份，還是同時提出完整故事？

「装束与口音只是倾向吗，能否找到另一条支持？」
出處：`sources/text/puzzles-scene-deduction.json` 字元 1079-1100 `decisions[1].zh`
顯示：裝束與口音只是傾向嗎，能否找到另一條支持？

## 可調參數

「验证粒度」
出處：`sources/text/puzzles-scene-deduction.json` 字元 1253-1257 `parameters[0].name.zh`
顯示：驗證粒度

「逐项反馈减少卡关；成组确认抑制枚举。」
出處：`sources/text/puzzles-scene-deduction.json` 字元 1341-1359 `parameters[0].effect.zh`
顯示：逐項反饋減少卡關；成組確認抑制枚舉。

「回访成本」
出處：`sources/text/puzzles-scene-deduction.json` 字元 1504-1508 `parameters[1].name.zh`
顯示：回訪成本

「快速回访鼓励交叉验证；高成本把推理变成记忆考试。」
出處：`sources/text/puzzles-scene-deduction.json` 字元 1582-1606 `parameters[1].effect.zh`
顯示：快速回訪鼓勵交叉驗證；高成本把推理變成記憶考試。

## 原型

「做一个静态场景、三名人物、六条线索与一组可填写的结论。」
出處：`sources/text/puzzles-scene-deduction.json` 字元 3079-3106 `prototype.firstStep.zh`
顯示：做一個靜態場景、三名人物、六條線索與一組可填寫的結論。

「让玩家为每条结论指出依据；靠试遍选项通过的部分需要补充线索。」
出處：`sources/text/puzzles-scene-deduction.json` 字元 3418-3448 `prototype.test.zh`
顯示：讓玩家爲每條結論指出依據；靠試遍選項通過的部分需要補充線索。

「先验证证据能唯一支持答案；增加人物和文本会迅速增加校对成本。」
出處：`sources/text/puzzles-scene-deduction.json` 字元 3236-3266 `prototype.pitfall.zh`
顯示：先驗證證據能唯一支持答案；增加人物和文本會迅速增加校對成本。

## 相關模式

- [語言解碼](puzzles-language-decoding.md)
- [視覺規則學習](puzzles-visual-rule-learning.md)
- [顧客訂單的解讀](commerce-interpret-orders.md)
- [不可逆推動與位置可達性](puzzles-box-pushing.md)

## 參考來源

- [Reconstructing events from evidence — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/puzzles-scene-deduction/) — 查閱：2026-11-02；取得方式：page-text。
