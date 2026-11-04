---
{
  "schema_version": 2,
  "id": "gathering-hidden-deposit-clues",
  "title": "隱藏礦床線索",
  "title_en": "Clues to buried deposits",
  "category": "gathering",
  "source_category": "gathering",
  "tags": [
    "information",
    "discovery",
    "spatial"
  ],
  "summary": "读懂地表痕迹，再挖出藏在下面的收获。",
  "note_status": "draft",
  "related": [
    "gathering-resource-detection",
    "exploration-ability-gates",
    "exploration-earned-map",
    "gathering-depth-targeting"
  ],
  "sources": [
    {
      "title": "Clues to buried deposits — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/gathering-hidden-deposit-clues/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「读懂地表痕迹，再挖出藏在下面的收获。」
出處：`sources/text/gathering-hidden-deposit-clues.json` 字元 185-203 `summary.zh`
顯示：讀懂地表痕跡，再挖出藏在下面的收穫。

## 規則

「埋藏物会在地面或岩壁留下可见痕迹，例如虫纹、碎晶或透出的光。玩家先识别线索，再用合适工具挖掘；线索可能精确指向一格，也可能只圈定一块需要试挖的区域，物品在出土后揭晓。」
出處：`sources/text/gathering-hidden-deposit-clues.json` 字元 300-383 `rules.zh`
顯示：埋藏物會在地面或巖壁留下可見痕跡，例如蟲紋、碎晶或透出的光。玩家先識別線索，再用合適工具挖掘；線索可能精確指向一格，也可能只圈定一塊需要試挖的區域，物品在出土後揭曉。

## 核心循環

「发现表面痕迹」
出處：`sources/text/gathering-hidden-deposit-clues.json` 字元 691-697 `loop[0].zh`
顯示：發現表面痕跡

「判断位置与适用工具」
出處：`sources/text/gathering-hidden-deposit-clues.json` 字元 763-772 `loop[1].zh`
顯示：判斷位置與適用工具

「挖开标记处或周围岩层」
出處：`sources/text/gathering-hidden-deposit-clues.json` 字元 846-856 `loop[2].zh`
顯示：挖開標記處或周圍岩層

「取出并确认收获」
出處：`sources/text/gathering-hidden-deposit-clues.json` 字元 938-945 `loop[3].zh`
顯示：取出並確認收穫

## 玩家取捨

「是否为这条线索偏离当前路线，尤其在时间或背包余量有限时？」
出處：`sources/text/gathering-hidden-deposit-clues.json` 字元 1040-1068 `decisions[0].zh`
顯示：是否爲這條線索偏離當前路線，尤其在時間或揹包餘量有限時？

「线索指向精确一格，还是需要根据光和碎屑重新判断挖掘方向？」
出處：`sources/text/gathering-hidden-deposit-clues.json` 字元 1195-1223 `decisions[1].zh`
顯示：線索指向精確一格，還是需要根據光和碎屑重新判斷挖掘方向？

## 可調參數

「线索精度」
出處：`sources/text/gathering-hidden-deposit-clues.json` 字元 1409-1413 `parameters[0].name.zh`
顯示：線索精度

「精确标记偏效率；散布线索要求玩家形成空间判断。」
出處：`sources/text/gathering-hidden-deposit-clues.json` 字元 1489-1512 `parameters[0].effect.zh`
顯示：精確標記偏效率；散佈線索要求玩家形成空間判斷。

「试挖成本」
出處：`sources/text/gathering-hidden-deposit-clues.json` 字元 1662-1666 `parameters[1].name.zh`
顯示：試挖成本

「低成本鼓励探索；高成本让每次定位更慎重。」
出處：`sources/text/gathering-hidden-deposit-clues.json` 字元 1738-1758 `parameters[1].effect.zh`
顯示：低成本鼓勵探索；高成本讓每次定位更慎重。

## 原型

「先用二维格子做表面痕迹、埋藏目标与逐格挖开，让线索和距离有稳定关系。」
出處：`sources/text/gathering-hidden-deposit-clues.json` 字元 3307-3341 `prototype.firstStep.zh`
顯示：先用二維格子做表面痕跡、埋藏目標與逐格挖開，讓線索和距離有穩定關係。

「看过一次示例后，玩家能否在新区域指出值得挖的位置并说明线索？」
出處：`sources/text/gathering-hidden-deposit-clues.json` 字元 3693-3723 `prototype.test.zh`
顯示：看過一次示例後，玩家能否在新區域指出值得挖的位置並說明線索？

「线索和奖励若没有稳定关系，玩家会退回全图乱挖。」
出處：`sources/text/gathering-hidden-deposit-clues.json` 字元 3528-3551 `prototype.pitfall.zh`
顯示：線索和獎勵若沒有穩定關係，玩家會退回全圖亂挖。

## 相關模式

- [資源偵測](gathering-resource-detection.md)
- [能力解鎖與回訪](exploration-ability-gates.md)
- [掙得地圖](exploration-earned-map.md)
- [深度鎖定層](gathering-depth-targeting.md)

## 參考來源

- [Clues to buried deposits — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/gathering-hidden-deposit-clues/) — 查閱：2026-11-02；取得方式：page-text。
