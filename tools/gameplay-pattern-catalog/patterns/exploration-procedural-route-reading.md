---
{
  "schema_version": 2,
  "id": "exploration-procedural-route-reading",
  "title": "程序路線判讀",
  "title_en": "Route reading in procedural terrain",
  "category": "exploration",
  "source_category": "exploration",
  "tags": [
    "randomness",
    "discovery",
    "risk"
  ],
  "summary": "每局都要重新判断怎么走，而不是背熟同一条最优路。",
  "note_status": "draft",
  "related": [
    "exploration-ability-gates",
    "exploration-earned-map",
    "exploration-fast-travel-network",
    "gathering-depth-targeting"
  ],
  "sources": [
    {
      "title": "Route reading in procedural terrain — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/exploration-procedural-route-reading/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「每局都要重新判断怎么走，而不是背熟同一条最优路。」
出處：`sources/text/exploration-procedural-route-reading.json` 字元 208-232 `summary.zh`
顯示：每局都要重新判斷怎麼走，而不是背熟同一條最優路。

## 規則

「关卡用随机组合改变通道、危险与奖励位置。玩家观察当前局部信息，判断绕路收益与生存风险；学习保留的是规则和危险识别，而非每个房间的固定答案。」
出處：`sources/text/exploration-procedural-route-reading.json` 字元 342-411 `rules.zh`
顯示：關卡用隨機組合改變通道、危險與獎勵位置。玩家觀察當前局部信息，判斷繞路收益與生存風險；學習保留的是規則和危險識別，而非每個房間的固定答案。

## 核心循環

「观察新布局」
出處：`sources/text/exploration-procedural-route-reading.json` 字元 654-659 `loop[0].zh`
顯示：觀察新佈局

「评估出口与支路」
出處：`sources/text/exploration-procedural-route-reading.json` 字元 722-729 `loop[1].zh`
顯示：評估出口與支路

「选择路径并应对变化」
出處：`sources/text/exploration-procedural-route-reading.json` 字元 798-807 `loop[2].zh`
顯示：選擇路徑並應對變化

「带着规则经验进入下一层」
出處：`sources/text/exploration-procedural-route-reading.json` 字元 867-878 `loop[3].zh`
顯示：帶着規則經驗進入下一層

## 玩家取捨

「已知出口近在眼前，是否为看得到的奖励多冒一次险？」
出處：`sources/text/exploration-procedural-route-reading.json` 字元 981-1005 `decisions[0].zh`
顯示：已知出口近在眼前，是否爲看得到的獎勵多冒一次險？

「地形可改造时，绕路与直接开路的成本需要重新比较。」
出處：`sources/text/exploration-procedural-route-reading.json` 字元 1107-1131 `decisions[1].zh`
顯示：地形可改造時，繞路與直接開路的成本需要重新比較。

## 可調參數

「安全路径保证」
出處：`sources/text/exploration-procedural-route-reading.json` 字元 1287-1293 `parameters[0].name.zh`
顯示：安全路徑保證

「保证出口连通能把难度集中在选择；不保证则容易产生无解感。」
出處：`sources/text/exploration-procedural-route-reading.json` 字元 1383-1411 `parameters[0].effect.zh`
顯示：保證出口連通能把難度集中在選擇；不保證則容易產生無解感。

「信息可见范围」
出處：`sources/text/exploration-procedural-route-reading.json` 字元 1575-1581 `parameters[1].name.zh`
顯示：信息可見範圍

「短视野强调探路，长视野更像整体路线优化。」
出處：`sources/text/exploration-procedural-route-reading.json` 字元 1668-1688 `parameters[1].effect.zh`
顯示：短視野強調探路，長視野更像整體路線優化。

## 原型

「先随机组合少量手工房间，并验证入口到出口始终可达。」
出處：`sources/text/exploration-procedural-route-reading.json` 字元 3274-3299 `prototype.firstStep.zh`
顯示：先隨機組合少量手工房間，並驗證入口到出口始終可達。

「多次游玩后，观察玩家是否说出通用判断规则，而非只记住固定走法。」
出處：`sources/text/exploration-procedural-route-reading.json` 字元 3631-3662 `prototype.test.zh`
顯示：多次遊玩後，觀察玩家是否說出通用判斷規則，而非只記住固定走法。

「无限随机容易产生无解或无趣布局；先保证可读的选择，再增加组合数量。」
出處：`sources/text/exploration-procedural-route-reading.json` 字元 3443-3476 `prototype.pitfall.zh`
顯示：無限隨機容易產生無解或無趣佈局；先保證可讀的選擇，再增加組合數量。

## 相關模式

- [能力解鎖與回訪](exploration-ability-gates.md)
- [掙得地圖](exploration-earned-map.md)
- [快速旅行網路](exploration-fast-travel-network.md)
- [深度鎖定層](gathering-depth-targeting.md)

## 參考來源

- [Route reading in procedural terrain — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/exploration-procedural-route-reading/) — 查閱：2026-11-02；取得方式：page-text。
