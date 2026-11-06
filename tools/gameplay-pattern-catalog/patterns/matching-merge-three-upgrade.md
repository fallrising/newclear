---
{
  "schema_version": 2,
  "id": "matching-merge-three-upgrade",
  "title": "合成三消升級",
  "title_en": "Merge matching items into the next tier",
  "category": "matching",
  "source_category": "matching",
  "tags": [
    "planning",
    "spatial",
    "optimization"
  ],
  "summary": "合并既带来升级，也把多个占位缩成一个。",
  "note_status": "draft",
  "related": [
    "matching-complete-lines",
    "matching-pattern-creates-power",
    "matching-swap-to-align",
    "matching-tap-connected-group"
  ],
  "sources": [
    {
      "title": "Merge matching items into the next tier — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/matching-merge-three-upgrade/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「合并既带来升级，也把多个占位缩成一个。」
出處：`sources/text/matching-merge-three-upgrade.json` 字元 202-221 `summary.zh`
顯示：合併既帶來升級，也把多個佔位縮成一個。

## 規則

「玩家把足够数量的同级物件聚在一起，消耗它们生成更高一级物件。升级产物继续占据棋盘，并能参与下一层合并；玩家要为当前素材、未来产物和暂时无法合并的零散物件分配空间。」
出處：`sources/text/matching-merge-three-upgrade.json` 字元 341-422 `rules.zh`
顯示：玩家把足夠數量的同級物件聚在一起，消耗它們生成更高一級物件。升級產物繼續佔據棋盤，並能參與下一層合併；玩家要爲當前素材、未來產物和暫時無法合併的零散物件分配空間。

## 核心循環

「收集同级素材」
出處：`sources/text/matching-merge-three-upgrade.json` 字元 715-721 `loop[0].zh`
顯示：收集同級素材

「为合并安排位置」
出處：`sources/text/matching-merge-three-upgrade.json` 字元 793-800 `loop[1].zh`
顯示：爲合併安排位置

「生成高一级物件」
出處：`sources/text/matching-merge-three-upgrade.json` 字元 871-878 `loop[2].zh`
顯示：生成高一級物件

「围绕产物准备下一组合」
出處：`sources/text/matching-merge-three-upgrade.json` 字元 947-957 `loop[3].zh`
顯示：圍繞產物準備下一組合

## 玩家取捨

「马上合并腾空间，还是多等几个素材争取更好的批量收益？」
出處：`sources/text/matching-merge-three-upgrade.json` 字元 1062-1088 `decisions[0].zh`
顯示：馬上合併騰空間，還是多等幾個素材爭取更好的批量收益？

「把产物留在中央方便下一次合并，还是放边缘减少挡路？」
出處：`sources/text/matching-merge-three-upgrade.json` 字元 1210-1235 `decisions[1].zh`
顯示：把產物留在中央方便下一次合併，還是放邊緣減少擋路？

## 可調參數

「每次消耗数量」
出處：`sources/text/matching-merge-three-upgrade.json` 字元 1399-1405 `parameters[0].name.zh`
顯示：每次消耗數量

「需要更多素材会增加占位压力，也让腾出空间的瞬间更明显。」
出處：`sources/text/matching-merge-three-upgrade.json` 字元 1483-1510 `parameters[0].effect.zh`
顯示：需要更多素材會增加佔位壓力，也讓騰出空間的瞬間更明顯。

「批量合并奖励」
出處：`sources/text/matching-merge-three-upgrade.json` 字元 1664-1670 `parameters[1].name.zh`
顯示：批量合併獎勵

「批量奖励鼓励等待，但过大时会让小规模合并失去价值。」
出處：`sources/text/matching-merge-three-upgrade.json` 字元 1743-1768 `parameters[1].effect.zh`
顯示：批量獎勵鼓勵等待，但過大時會讓小規模合併失去價值。

## 原型

「做四乘四棋盘、三个物件等级和固定的三合一规则。」
出處：`sources/text/matching-merge-three-upgrade.json` 字元 3357-3380 `prototype.firstStep.zh`
顯示：做四乘四棋盤、三個物件等級和固定的三合一規則。

「玩家是否能说出自己这次合并主要为了升级，还是为了腾位置？」
出處：`sources/text/matching-merge-three-upgrade.json` 字元 3700-3728 `prototype.test.zh`
顯示：玩家是否能說出自己這次合併主要爲了升級，還是爲了騰位置？

「不要一开始就加入几十条升级链；先验证空间压力是否足以形成选择。」
出處：`sources/text/matching-merge-three-upgrade.json` 字元 3514-3545 `prototype.pitfall.zh`
顯示：不要一開始就加入幾十條升級鏈；先驗證空間壓力是否足以形成選擇。

## 相關模式

- [完成整行](matching-complete-lines.md)
- [圖形生成電力](matching-pattern-creates-power.md)
- [交換對齊](matching-swap-to-align.md)
- [點選相連群組](matching-tap-connected-group.md)

## 參考來源

- [Merge matching items into the next tier — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/matching-merge-three-upgrade/) — 查閱：2026-11-02；取得方式：page-text。
