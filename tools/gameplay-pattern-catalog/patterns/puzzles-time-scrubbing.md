---
{
  "schema_version": 2,
  "id": "puzzles-time-scrubbing",
  "title": "時間還原",
  "title_en": "Rewinding time to change outcomes",
  "category": "puzzles",
  "source_category": "puzzles",
  "tags": [
    "information",
    "timing",
    "planning"
  ],
  "summary": "回到关键时刻，理解哪些状态会随时间倒退。",
  "note_status": "draft",
  "related": [
    "puzzles-box-pushing",
    "puzzles-visual-rule-learning",
    "automation-item-filtering",
    "exploration-earned-map"
  ],
  "sources": [
    {
      "title": "Rewinding time to change outcomes — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/puzzles-time-scrubbing/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「回到关键时刻，理解哪些状态会随时间倒退。」
出處：`sources/text/puzzles-time-scrubbing.json` 字元 187-207 `summary.zh`
顯示：回到關鍵時刻，理解哪些狀態會隨時間倒退。

## 規則

「玩家推动或回拨时间，观察物体、角色与机关如何沿时间轴变化。目标不是单纯重试，而是利用不同状态的先后关系，让某个时间点出现可行通路或互动条件。」
出處：`sources/text/puzzles-time-scrubbing.json` 字元 310-380 `rules.zh`
顯示：玩家推動或回撥時間，觀察物體、角色與機關如何沿時間軸變化。目標不是單純重試，而是利用不同狀態的先後關係，讓某個時間點出現可行通路或互動條件。

## 核心循環

「观察事件顺序」
出處：`sources/text/puzzles-time-scrubbing.json` 字元 603-609 `loop[0].zh`
顯示：觀察事件順序

「回拨到关键状态」
出處：`sources/text/puzzles-time-scrubbing.json` 字元 672-679 `loop[1].zh`
顯示：回撥到關鍵狀態

「改变互动时机」
出處：`sources/text/puzzles-time-scrubbing.json` 字元 746-752 `loop[2].zh`
顯示：改變互動時機

「推进时间验证结果」
出處：`sources/text/puzzles-time-scrubbing.json` 字元 820-828 `loop[3].zh`
顯示：推進時間驗證結果

## 玩家取捨

「障碍来自位置，还是事件先后？」
出處：`sources/text/puzzles-time-scrubbing.json` 字元 913-927 `decisions[0].zh`
顯示：障礙來自位置，還是事件先後？

「部分对象不随时间回退时，如何利用状态差？」
出處：`sources/text/puzzles-time-scrubbing.json` 字元 1017-1037 `decisions[1].zh`
顯示：部分對象不隨時間回退時，如何利用狀態差？

## 可調參數

「可回拨对象」
出處：`sources/text/puzzles-time-scrubbing.json` 字元 1164-1169 `parameters[0].name.zh`
顯示：可回撥對象

「全部倒退易理解；选择性倒退产生更深因果组合。」
出處：`sources/text/puzzles-time-scrubbing.json` 字元 1243-1265 `parameters[0].effect.zh`
顯示：全部倒退易理解；選擇性倒退產生更深因果組合。

「控制粒度」
出處：`sources/text/puzzles-time-scrubbing.json` 字元 1412-1416 `parameters[1].name.zh`

「连续拖动适合精细时机；离散阶段便于比较状态。」
出處：`sources/text/puzzles-time-scrubbing.json` 字元 1493-1515 `parameters[1].effect.zh`
顯示：連續拖動適合精細時機；離散階段便於比較狀態。

## 原型

「做一个角色、一个移动平台和一扇门，记录并回放它们的有限状态。」
出處：`sources/text/puzzles-time-scrubbing.json` 字元 2927-2957 `prototype.firstStep.zh`
顯示：做一個角色、一個移動平臺和一扇門，記錄並回放它們的有限狀態。

「观察玩家回拨后是否有针对性地调整一个时机，而非重复整段相同操作。」
出處：`sources/text/puzzles-time-scrubbing.json` 字元 3285-3317 `prototype.test.zh`
顯示：觀察玩家回撥後是否有針對性地調整一個時機，而非重複整段相同操作。

「先规定哪些对象会回退；任意物理和大量随机事件会让回放难以一致。」
出處：`sources/text/puzzles-time-scrubbing.json` 字元 3100-3131 `prototype.pitfall.zh`
顯示：先規定哪些對象會回退；任意物理和大量隨機事件會讓回放難以一致。

## 相關模式

- [不可逆推動與位置可達性](puzzles-box-pushing.md)
- [視覺規則學習](puzzles-visual-rule-learning.md)
- [物品篩選](automation-item-filtering.md)
- [掙得地圖](exploration-earned-map.md)

## 參考來源

- [Rewinding time to change outcomes — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/puzzles-time-scrubbing/) — 查閱：2026-11-02；取得方式：page-text。
