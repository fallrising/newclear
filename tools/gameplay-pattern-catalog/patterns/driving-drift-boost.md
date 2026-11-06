---
{
  "schema_version": 2,
  "id": "driving-drift-boost",
  "title": "漂移加速",
  "title_en": "Drift to charge a release boost",
  "category": "driving",
  "source_category": "driving",
  "tags": [
    "timing",
    "precision",
    "risk"
  ],
  "summary": "弯道里多维持一会儿漂移，换取出弯时更长的加速。",
  "note_status": "draft",
  "related": [
    "driving-air-balance",
    "driving-air-stunt",
    "driving-slipstream",
    "driving-start-charge"
  ],
  "sources": [
    {
      "title": "Drift to charge a release boost — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/driving-drift-boost/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「弯道里多维持一会儿漂移，换取出弯时更长的加速。」
出處：`sources/text/driving-drift-boost.json` 字元 182-205 `summary.zh`
顯示：彎道里多維持一會兒漂移，換取出彎時更長的加速。

## 規則

「入弯后维持侧滑，积累加速奖励，并用方向输入调整行驶路线。松开漂移键会把已积累的奖励转成短暂加速。玩家要判断还能安全蓄多久，以及出弯后有没有足够空间使用加速；漂移本身不等于越久越好。」
出處：`sources/text/driving-drift-boost.json` 字元 315-405 `rules.zh`
顯示：入彎後維持側滑，積累加速獎勵，並用方向輸入調整行駛路線。鬆開漂移鍵會把已積累的獎勵轉成短暫加速。玩家要判斷還能安全蓄多久，以及出彎後有沒有足夠空間使用加速；漂移本身不等於越久越好。

## 核心循環

「观察弯道和出口」
出處：`sources/text/driving-drift-boost.json` 字元 688-695 `loop[0].zh`
顯示：觀察彎道和出口

「入弯并维持漂移」
出處：`sources/text/driving-drift-boost.json` 字元 761-768 `loop[1].zh`
顯示：入彎並維持漂移

「修正路线与观察蓄力」
出處：`sources/text/driving-drift-boost.json` 字元 834-843 `loop[2].zh`
顯示：修正路線與觀察蓄力

「松开漂移，利用加速」
出處：`sources/text/driving-drift-boost.json` 字元 919-928 `loop[3].zh`
顯示：鬆開漂移，利用加速

## 玩家取捨

「继续蓄力还是现在放开，避免冲到路外？」
出處：`sources/text/driving-drift-boost.json` 字元 1018-1036 `decisions[0].zh`
顯示：繼續蓄力還是現在放開，避免衝到路外？

「下一弯很近，值得把这次加速蓄满吗？」
出處：`sources/text/driving-drift-boost.json` 字元 1129-1146 `decisions[1].zh`
顯示：下一彎很近，值得把這次加速蓄滿嗎？

## 可調參數

「蓄力分档」
出處：`sources/text/driving-drift-boost.json` 字元 1282-1286 `parameters[0].name.zh`
顯示：蓄力分檔

「档位之间的距离决定玩家会不会冒险再撑一小段。」
出處：`sources/text/driving-drift-boost.json` 字元 1365-1387 `parameters[0].effect.zh`
顯示：檔位之間的距離決定玩家會不會冒險再撐一小段。

「漂移可修正幅度」
出處：`sources/text/driving-drift-boost.json` 字元 1536-1543 `parameters[1].name.zh`

「修正余地越小，入弯位置越重要；余地太大会削弱路线取舍。」
出處：`sources/text/driving-drift-boost.json` 字元 1628-1655 `parameters[1].effect.zh`
顯示：修正餘地越小，入彎位置越重要；餘地太大會削弱路線取捨。

## 原型

「用俯视方块小车、一个弯和两档蓄力条，先验证松开时机。」
出處：`sources/text/driving-drift-boost.json` 字元 3207-3233 `prototype.firstStep.zh`
顯示：用俯視方塊小車、一個彎和兩檔蓄力條，先驗證鬆開時機。

「玩家能否说清楚为什么这一弯提前松开，下一弯继续蓄力？」
出處：`sources/text/driving-drift-boost.json` 字元 3554-3580 `prototype.test.zh`
顯示：玩家能否說清楚爲什麼這一彎提前鬆開，下一彎繼續蓄力？

「先做稳定可预测的转向；漂移反馈不清时，增加车型和赛道只会放大问题。」
出處：`sources/text/driving-drift-boost.json` 字元 3375-3408 `prototype.pitfall.zh`
顯示：先做穩定可預測的轉向；漂移反饋不清時，增加車型和賽道只會放大問題。

## 相關模式

- [空中平衡](driving-air-balance.md)
- [空中特技](driving-air-stunt.md)
- [尾流跟車加速](driving-slipstream.md)
- [起步蓄力](driving-start-charge.md)

## 參考來源

- [Drift to charge a release boost — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/driving-drift-boost/) — 查閱：2026-11-02；取得方式：page-text。
