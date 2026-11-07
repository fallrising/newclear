---
{
  "schema_version": 2,
  "id": "matching-combine-power-pieces",
  "title": "合併電力棋子",
  "title_en": "Combine two power pieces into one effect",
  "category": "matching",
  "source_category": "matching",
  "tags": [
    "planning",
    "risk",
    "optimization"
  ],
  "summary": "两个道具各自使用很方便，留到相遇时可能改变整盘。",
  "note_status": "draft",
  "related": [
    "matching-complete-lines",
    "matching-merge-three-upgrade",
    "matching-pattern-creates-power",
    "matching-slide-board-merge"
  ],
  "sources": [
    {
      "title": "Combine two power pieces into one effect — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/matching-combine-power-pieces/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「两个道具各自使用很方便，留到相遇时可能改变整盘。」
出處：`sources/text/matching-combine-power-pieces.json` 字元 206-230 `summary.zh`
顯示：兩個道具各自使用很方便，留到相遇時可能改變整盤。

## 規則

「玩家先获得带特殊效果的物件，再让两个物件相邻并组合触发。组合结果可以扩大范围或把一种效果传播到另一批目标，而不是简单播放两次原有效果；准备组合期间必须承担占位和等待成本。」
出處：`sources/text/matching-combine-power-pieces.json` 字元 365-450 `rules.zh`
顯示：玩家先獲得帶特殊效果的物件，再讓兩個物件相鄰並組合觸發。組合結果可以擴大範圍或把一種效果傳播到另一批目標，而不是簡單播放兩次原有效果；準備組合期間必須承擔佔位和等待成本。

## 核心循環

「获得两个可组合工具」
出處：`sources/text/matching-combine-power-pieces.json` 字元 746-755 `loop[0].zh`
顯示：獲得兩個可組合工具

「保护并让它们靠近」
出處：`sources/text/matching-combine-power-pieces.json` 字元 826-834 `loop[1].zh`
顯示：保護並讓它們靠近

「预览并触发组合效果」
出處：`sources/text/matching-combine-power-pieces.json` 字元 910-919 `loop[2].zh`
顯示：預覽並觸發組合效果

「处理被重新打开的棋盘」
出處：`sources/text/matching-combine-power-pieces.json` 字元 1002-1012 `loop[3].zh`
顯示：處理被重新打開的棋盤

## 玩家取捨

「现在用一个工具解决紧急目标，还是把它留给更强的组合？」
出處：`sources/text/matching-combine-power-pieces.json` 字元 1109-1135 `decisions[0].zh`
顯示：現在用一個工具解決緊急目標，還是把它留給更強的組合？

「为了把两块移到一起花掉数步，最终收益是否仍比单独使用高？」
出處：`sources/text/matching-combine-power-pieces.json` 字元 1250-1278 `decisions[1].zh`
顯示：爲了把兩塊移到一起花掉數步，最終收益是否仍比單獨使用高？

## 可調參數

「组合效果差异」
出處：`sources/text/matching-combine-power-pieces.json` 字元 1441-1447 `parameters[0].name.zh`
顯示：組合效果差異

「组合只是数值变大时易懂；产生新作用方式时更有发现感，也更需要预览。」
出處：`sources/text/matching-combine-power-pieces.json` 字元 1537-1570 `parameters[0].effect.zh`
顯示：組合只是數值變大時易懂；產生新作用方式時更有發現感，也更需要預覽。

「准备成本」
出處：`sources/text/matching-combine-power-pieces.json` 字元 1742-1746 `parameters[1].name.zh`
顯示：準備成本

「移动受限或位置相隔较远会提高等待风险，不能让所有组合都无脑优于单用。」
出處：`sources/text/matching-combine-power-pieces.json` 字元 1818-1852 `parameters[1].effect.zh`
顯示：移動受限或位置相隔較遠會提高等待風險，不能讓所有組合都無腦優於單用。

## 原型

「做两种工具和三种组合结果，在确认前高亮受影响格子。」
出處：`sources/text/matching-combine-power-pieces.json` 字元 3512-3537 `prototype.firstStep.zh`
顯示：做兩種工具和三種組合結果，在確認前高亮受影響格子。

「玩家能否比较“分开用”和“组合用”的具体收益？」
出處：`sources/text/matching-combine-power-pieces.json` 字元 3867-3890 `prototype.test.zh`
顯示：玩家能否比較“分開用”和“組合用”的具體收益？

「不要依赖玩家背组合表；效果预览应能解释为什么组合值得等。」
出處：`sources/text/matching-combine-power-pieces.json` 字元 3690-3718 `prototype.pitfall.zh`
顯示：不要依賴玩家背組合表；效果預覽應能解釋爲什麼組合值得等。

## 相關模式

- [完成整行](matching-complete-lines.md)
- [合成三消升級](matching-merge-three-upgrade.md)
- [圖形生成電力](matching-pattern-creates-power.md)
- [滑動盤面合成](matching-slide-board-merge.md)

## 參考來源

- [Combine two power pieces into one effect — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/matching-combine-power-pieces/) — 查閱：2026-11-02；取得方式：page-text。
