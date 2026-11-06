---
{
  "schema_version": 2,
  "id": "allocation-area-majority",
  "title": "區域多數",
  "title_en": "Control an area by having more presence",
  "category": "allocation",
  "source_category": "allocation",
  "tags": [
    "spatial",
    "planning"
  ],
  "summary": "多放一个单位，可能就改变一整片区域的归属。",
  "note_status": "draft",
  "related": [
    "allocation-follow-phase",
    "allocation-public-goal-race",
    "allocation-public-pick",
    "allocation-route-denial"
  ],
  "sources": [
    {
      "title": "Control an area by having more presence — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/allocation-area-majority/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「多放一个单位，可能就改变一整片区域的归属。」
出處：`sources/text/allocation-area-majority.json` 字元 198-219 `summary.zh`
顯示：多放一個單位，可能就改變一整片區域的歸屬。

## 規則

「各方往同一区域投入可计数的单位或标记，在指定时点比较数量决定控制权或奖励。玩家要在多个区域分配有限力量，避免过量投入，也防止领先被刚好超过；平局如何处理必须明确。」
出處：`sources/text/allocation-area-majority.json` 字元 311-392 `rules.zh`
顯示：各方往同一區域投入可計數的單位或標記，在指定時點比較數量決定控制權或獎勵。玩家要在多個區域分配有限力量，避免過量投入，也防止領先被剛好超過；平局如何處理必須明確。

## 核心循環

「比较各区的投入数量」
出處：`sources/text/allocation-area-majority.json` 字元 672-681 `loop[0].zh`
顯示：比較各區的投入數量

「增援或连接到目标区域」
出處：`sources/text/allocation-area-majority.json` 字元 754-764 `loop[1].zh`
顯示：增援或連接到目標區域

「结算领先与归属」
出處：`sources/text/allocation-area-majority.json` 字元 831-838 `loop[2].zh`
顯示：結算領先與歸屬

「根据新局势转移投入」
出處：`sources/text/allocation-area-majority.json` 字元 912-921 `loop[3].zh`
顯示：根據新局勢轉移投入

## 玩家取捨

「把领先从一人扩大到两人，还是去争另一个空区？」
出處：`sources/text/allocation-area-majority.json` 字元 1020-1042 `decisions[0].zh`
顯示：把領先從一人擴大到兩人，還是去爭另一個空區？

「继续追赶已落后的地区，还是放弃并保住其他收益？」
出處：`sources/text/allocation-area-majority.json` 字元 1133-1156 `decisions[1].zh`
顯示：繼續追趕已落後的地區，還是放棄並保住其他收益？

## 可調參數

「结算时点」
出處：`sources/text/allocation-area-majority.json` 字元 1296-1300 `parameters[0].name.zh`
顯示：結算時點

「持续判定强化即时控制，阶段结算强化临近结算的反超。」
出處：`sources/text/allocation-area-majority.json` 字元 1374-1399 `parameters[0].effect.zh`
顯示：持續判定強化即時控制，階段結算強化臨近結算的反超。

「平局规则」
出處：`sources/text/allocation-area-majority.json` 字元 1555-1559 `parameters[1].name.zh`
顯示：平局規則

「无人控制、共享奖励与特定阵营胜出会产生不同争夺门槛。」
出處：`sources/text/allocation-area-majority.json` 字元 1630-1656 `parameters[1].effect.zh`
顯示：無人控制、共享獎勵與特定陣營勝出會產生不同爭奪門檻。

## 原型

「三个区域、每人六枚标记和一个固定结算回合，用颜色块即可。」
出處：`sources/text/allocation-area-majority.json` 字元 3110-3138 `prototype.firstStep.zh`
顯示：三個區域、每人六枚標記和一個固定結算回合，用顏色塊即可。

「玩家是否会停止给已稳占的区域加人，转去争新的区域？」
出處：`sources/text/allocation-area-majority.json` 字元 3387-3412 `prototype.test.zh`
顯示：玩家是否會停止給已穩佔的區域加人，轉去爭新的區域？

「必须让当前数量、领先者与结算时点同时可见。」
出處：`sources/text/allocation-area-majority.json` 字元 3259-3280 `prototype.pitfall.zh`
顯示：必須讓當前數量、領先者與結算時點同時可見。

## 相關模式

- [跟進階段](allocation-follow-phase.md)
- [公開目標競速](allocation-public-goal-race.md)
- [公開選取](allocation-public-pick.md)
- [路線封鎖](allocation-route-denial.md)

## 參考來源

- [Control an area by having more presence — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/allocation-area-majority/) — 查閱：2026-11-02；取得方式：page-text。
