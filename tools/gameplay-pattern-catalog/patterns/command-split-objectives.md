---
{
  "schema_version": 2,
  "id": "command-split-objectives",
  "title": "分工目標組",
  "title_en": "Split forces between simultaneous objectives",
  "category": "command",
  "source_category": "command",
  "tags": [
    "planning",
    "spatial"
  ],
  "summary": "同一批人无法同时守住每个地方。",
  "note_status": "draft",
  "related": [
    "command-frontline-shielding",
    "command-prebattle-formation",
    "command-focus-fire",
    "command-initiative-order"
  ],
  "sources": [
    {
      "title": "Split forces between simultaneous objectives — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/command-split-objectives/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「同一批人无法同时守住每个地方。」
出處：`sources/text/command-split-objectives.json` 字元 202-217 `summary.zh`
顯示：同一批人無法同時守住每個地方。

## 規則

「多个目标同时需要人员，玩家把有限单位分组分别移动、守点或执行任务。分兵扩大覆盖范围，也让每组更脆弱；距离和到达时间决定是否来得及相互支援。」
出處：`sources/text/command-split-objectives.json` 字元 308-377 `rules.zh`
顯示：多個目標同時需要人員，玩家把有限單位分組分別移動、守點或執行任務。分兵擴大覆蓋範圍，也讓每組更脆弱；距離和到達時間決定是否來得及相互支援。

## 核心循環

「比较同时发生的需求」
出處：`sources/text/command-split-objectives.json` 字元 638-647 `loop[0].zh`
顯示：比較同時發生的需求

「给各目标分配人数」
出處：`sources/text/command-split-objectives.json` 字元 719-727 `loop[1].zh`
顯示：給各目標分配人數

「分别执行并观察压力」
出處：`sources/text/command-split-objectives.json` 字元 799-808 `loop[2].zh`
顯示：分別執行並觀察壓力

「调回援军或放弃一处」
出處：`sources/text/command-split-objectives.json` 字元 885-894 `loop[3].zh`
顯示：調回援軍或放棄一處

## 玩家取捨

「守住所有入口但每处都薄弱，还是集中守一个关键点？」
出處：`sources/text/command-split-objectives.json` 字元 990-1014 `decisions[0].zh`
顯示：守住所有入口但每處都薄弱，還是集中守一個關鍵點？

「派精锐救远端目标，会不会让本阵失守？」
出處：`sources/text/command-split-objectives.json` 字元 1123-1141 `decisions[1].zh`
顯示：派精銳救遠端目標，會不會讓本陣失守？

## 可調參數

「目标间距离」
出處：`sources/text/command-split-objectives.json` 字元 1284-1289 `parameters[0].name.zh`
顯示：目標間距離

「越远越难临时改派，分兵决策更接近承诺。」
出處：`sources/text/command-split-objectives.json` 字元 1378-1397 `parameters[0].effect.zh`
顯示：越遠越難臨時改派，分兵決策更接近承諾。

「失败后果差异」
出處：`sources/text/command-split-objectives.json` 字元 1534-1540 `parameters[1].name.zh`
顯示：失敗後果差異

「不同损失让优先级成立，而非只比较最近哪个点。」
出處：`sources/text/command-split-objectives.json` 字元 1623-1645 `parameters[1].effect.zh`
顯示：不同損失讓優先級成立，而非只比較最近哪個點。

## 原型

「两个倒计时目标、六个可拖动人员标记和固定旅行时间。」
出處：`sources/text/command-split-objectives.json` 字元 2980-3005 `prototype.firstStep.zh`
顯示：兩個倒計時目標、六個可拖動人員標記和固定旅行時間。

「玩家是否会根据目标价值改变人数，而不是始终平均分配？」
出處：`sources/text/command-split-objectives.json` 字元 3267-3293 `prototype.test.zh`
顯示：玩家是否會根據目標價值改變人數，而不是始終平均分配？

「别一开始就做复杂寻路；先验证分配是否有取舍。」
出處：`sources/text/command-split-objectives.json` 字元 3135-3157 `prototype.pitfall.zh`
顯示：別一開始就做複雜尋路；先驗證分配是否有取捨。

## 相關模式

- [前線掩護](command-frontline-shielding.md)
- [戰前陣型](command-prebattle-formation.md)
- [集中火力決策](command-focus-fire.md)
- [先攻順序](command-initiative-order.md)

## 參考來源

- [Split forces between simultaneous objectives — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/command-split-objectives/) — 查閱：2026-11-02；取得方式：page-text。
