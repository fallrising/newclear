---
{
  "schema_version": 2,
  "id": "matching-pattern-creates-power",
  "title": "圖形生成電力",
  "title_en": "Create a power piece with a match pattern",
  "category": "matching",
  "source_category": "matching",
  "tags": [
    "planning",
    "spatial",
    "optimization"
  ],
  "summary": "同样是消除，凑成哪种形状决定留下什么工具。",
  "note_status": "draft",
  "related": [
    "matching-complete-lines",
    "matching-merge-three-upgrade",
    "matching-swap-to-align",
    "matching-tap-connected-group"
  ],
  "sources": [
    {
      "title": "Create a power piece with a match pattern — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/matching-pattern-creates-power/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「同样是消除，凑成哪种形状决定留下什么工具。」
出處：`sources/text/matching-pattern-creates-power.json` 字元 206-227 `summary.zh`
顯示：同樣是消除，湊成哪種形狀決定留下什麼工具。

## 規則

「普通匹配只清除物件，较长直线或拐角形状还会留下特殊块。玩家先通过移动准备形状，再决定何时触发特殊块；生成位置和作用范围必须看得清，才能规划它将来帮助哪一片区域。」
出處：`sources/text/matching-pattern-creates-power.json` 字元 330-410 `rules.zh`
顯示：普通匹配只清除物件，較長直線或拐角形狀還會留下特殊塊。玩家先通過移動準備形狀，再決定何時觸發特殊塊；生成位置和作用範圍必須看得清，才能規劃它將來幫助哪一片區域。

## 核心循環

「寻找能扩成特殊形状的匹配」
出處：`sources/text/matching-pattern-creates-power.json` 字元 687-699 `loop[0].zh`
顯示：尋找能擴成特殊形狀的匹配

「调整位置完成形状」
出處：`sources/text/matching-pattern-creates-power.json` 字元 789-797 `loop[1].zh`
顯示：調整位置完成形狀

「留下对应的特殊块」
出處：`sources/text/matching-pattern-creates-power.json` 字元 869-877 `loop[2].zh`
顯示：留下對應的特殊塊

「选择位置与时机使用」
出處：`sources/text/matching-pattern-creates-power.json` 字元 957-966 `loop[3].zh`
顯示：選擇位置與時機使用

## 玩家取捨

「现在做普通三连完成一点目标，还是多花一步凑出能清整列的工具？」
出處：`sources/text/matching-pattern-creates-power.json` 字元 1062-1092 `decisions[0].zh`
顯示：現在做普通三連完成一點目標，還是多花一步湊出能清整列的工具？

「特殊块更强，但生成位置离目标太远，是否值得准备？」
出處：`sources/text/matching-pattern-creates-power.json` 字元 1223-1247 `decisions[1].zh`
顯示：特殊塊更強，但生成位置離目標太遠，是否值得準備？

## 可調參數

「形状到效果的对应」
出處：`sources/text/matching-pattern-creates-power.json` 字元 1400-1408 `parameters[0].name.zh`
顯示：形狀到效果的對應

「少量固定对应易于记忆；形状过多会让玩家转而依赖提示。」
出處：`sources/text/matching-pattern-creates-power.json` 字元 1495-1521 `parameters[0].effect.zh`
顯示：少量固定對應易於記憶；形狀過多會讓玩家轉而依賴提示。

「特殊块生成位置」
出處：`sources/text/matching-pattern-creates-power.json` 字元 1679-1686 `parameters[1].name.zh`
顯示：特殊塊生成位置

「位置可预测时能提前布局；随机位置会削弱空间规划。」
出處：`sources/text/matching-pattern-creates-power.json` 字元 1761-1785 `parameters[1].effect.zh`
顯示：位置可預測時能提前佈局；隨機位置會削弱空間規劃。

## 原型

「只做普通三连和一种四连特殊块，让生成位置固定且可预览。」
出處：`sources/text/matching-pattern-creates-power.json` 字元 3416-3443 `prototype.firstStep.zh`
顯示：只做普通三連和一種四連特殊塊，讓生成位置固定且可預覽。

「玩家会不会为了未来作用范围，主动放弃眼前的普通匹配？」
出處：`sources/text/matching-pattern-creates-power.json` 字元 3772-3798 `prototype.test.zh`
顯示：玩家會不會爲了未來作用範圍，主動放棄眼前的普通匹配？

「同时解释多种形状和多种爆炸范围会压过核心选择，先验证一种。」
出處：`sources/text/matching-pattern-creates-power.json` 字元 3600-3629 `prototype.pitfall.zh`
顯示：同時解釋多種形狀和多種爆炸範圍會壓過核心選擇，先驗證一種。

## 相關模式

- [完成整行](matching-complete-lines.md)
- [合成三消升級](matching-merge-three-upgrade.md)
- [交換對齊](matching-swap-to-align.md)
- [點選相連群組](matching-tap-connected-group.md)

## 參考來源

- [Create a power piece with a match pattern — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/matching-pattern-creates-power/) — 查閱：2026-11-02；取得方式：page-text。
