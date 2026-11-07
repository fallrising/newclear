---
{
  "schema_version": 2,
  "id": "puzzles-visual-rule-learning",
  "title": "視覺規則學習",
  "title_en": "Inferring visual puzzle rules",
  "category": "puzzles",
  "source_category": "puzzles",
  "tags": [
    "information",
    "discovery",
    "planning"
  ],
  "summary": "不用说明书，让玩家从反馈中自己学会语法。",
  "note_status": "draft",
  "related": [
    "exploration-earned-map",
    "puzzles-box-pushing",
    "puzzles-language-decoding",
    "puzzles-scene-deduction"
  ],
  "sources": [
    {
      "title": "Inferring visual puzzle rules — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/puzzles-visual-rule-learning/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「不用说明书，让玩家从反馈中自己学会语法。」
出處：`sources/text/puzzles-visual-rule-learning.json` 字元 189-209 `summary.zh`
顯示：不用說明書，讓玩家從反饋中自己學會語法。

## 規則

「玩家面对统一输入界面和逐步变化的符号，先从简单题猜测规则，再用复杂题验证。错误说明当前组合不满足条件，玩家需要比较题目并修正假设，而不是盲目尝试。」
出處：`sources/text/puzzles-visual-rule-learning.json` 字元 307-380 `rules.zh`
顯示：玩家面對統一輸入界面和逐步變化的符號，先從簡單題猜測規則，再用複雜題驗證。錯誤說明當前組合不滿足條件，玩家需要比較題目並修正假設，而不是盲目嘗試。

## 核心循環

「比较简单样例」
出處：`sources/text/puzzles-visual-rule-learning.json` 字元 611-617 `loop[0].zh`
顯示：比較簡單樣例

「提出规则假设」
出處：`sources/text/puzzles-visual-rule-learning.json` 字元 684-690 `loop[1].zh`
顯示：提出規則假設

「在新题中验证」
出處：`sources/text/puzzles-visual-rule-learning.json` 字元 748-754 `loop[2].zh`
顯示：在新題中驗證

「用反例修正规则」
出處：`sources/text/puzzles-visual-rule-learning.json` 字元 818-825 `loop[3].zh`
顯示：用反例修正規則

## 玩家取捨

「哪个差异改变答案，哪些只是视觉装饰？」
出處：`sources/text/puzzles-visual-rule-learning.json` 字元 918-936 `decisions[0].zh`
顯示：哪個差異改變答案，哪些只是視覺裝飾？

「假设能解释所有已解题，还是只碰巧通过上一题？」
出處：`sources/text/puzzles-visual-rule-learning.json` 字元 1040-1062 `decisions[1].zh`
顯示：假設能解釋所有已解題，還是隻碰巧通過上一題？

## 可調參數

「示例排序」
出處：`sources/text/puzzles-visual-rule-learning.json` 字元 1204-1208 `parameters[0].name.zh`

「先隔离再组合规则可降低误学；过早混合增加负担。」
出處：`sources/text/puzzles-visual-rule-learning.json` 字元 1283-1306 `parameters[0].effect.zh`
顯示：先隔離再組合規則可降低誤學；過早混合增加負擔。

「错误反馈」
出處：`sources/text/puzzles-visual-rule-learning.json` 字元 1439-1443 `parameters[1].name.zh`
顯示：錯誤反饋

「指出错误位置更友善；只给成败要求更强归纳。」
出處：`sources/text/puzzles-visual-rule-learning.json` 字元 1519-1540 `parameters[1].effect.zh`
顯示：指出錯誤位置更友善；只給成敗要求更強歸納。

## 原型

「设计一条清晰规则、四道教学例题和两道会排除错误假设的题。」
出處：`sources/text/puzzles-visual-rule-learning.json` 字元 2925-2953 `prototype.firstStep.zh`
顯示：設計一條清晰規則、四道教學例題和兩道會排除錯誤假設的題。

「不解释规则，让玩家用自己的话描述它，再解一道没见过的新题。」
出處：`sources/text/puzzles-visual-rule-learning.json` 字元 3287-3316 `prototype.test.zh`
顯示：不解釋規則，讓玩家用自己的話描述它，再解一道沒見過的新題。

「关键成本在题目安排；规则复杂却没有辨别线索，只会变成猜答案。」
出處：`sources/text/puzzles-visual-rule-learning.json` 字元 3112-3142 `prototype.pitfall.zh`
顯示：關鍵成本在題目安排；規則複雜卻沒有辨別線索，只會變成猜答案。

## 相關模式

- [掙得地圖](exploration-earned-map.md)
- [不可逆推動與位置可達性](puzzles-box-pushing.md)
- [語言解碼](puzzles-language-decoding.md)
- [現場推理](puzzles-scene-deduction.md)

## 參考來源

- [Inferring visual puzzle rules — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/puzzles-visual-rule-learning/) — 查閱：2026-11-02；取得方式：page-text。
