---
{
  "schema_version": 2,
  "id": "farming-growth-care",
  "title": "照料排程與延遲收成",
  "title_en": "Planting and crop care",
  "category": "farming",
  "source_category": "farming",
  "tags": [
    "time-budget",
    "delayed-reward",
    "maintenance"
  ],
  "summary": "把一次播种变成一串有节奏的投入，成熟后回收产物。",
  "note_status": "draft",
  "related": [
    "cooking-recipe-learning",
    "automation-belt-routing"
  ],
  "sources": [
    {
      "title": "Planting and crop care — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/farming-growth-care/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把一次播种变成一串有节奏的投入，成熟后回收产物。」
出處：`sources/text/farming-growth-care.json` 字元 171-195 `summary.zh`
顯示：把一次播種變成一串有節奏的投入，成熟後回收產物。

## 規則

「玩家整理土地、播种并供水，使作物达到可收获状态。成长由时间与照料条件共同推进，缺少照料会推迟收益；芽、成熟外观和收获物让进度可见。」
出處：`sources/text/farming-growth-care.json` 字元 306-371 `rules.zh`
顯示：玩家整理土地、播種並供水，使作物達到可收穫狀態。成長由時間與照料條件共同推進，缺少照料會推遲收益；芽、成熟外觀和收穫物讓進度可見。

## 核心循環

「准备土地与种子」
出處：`sources/text/farming-growth-care.json` 字元 615-622 `loop[0].zh`
顯示：準備土地與種子

「播种并满足供水条件」
出處：`sources/text/farming-growth-care.json` 字元 688-697 `loop[1].zh`
顯示：播種並滿足供水條件

「安排等待期间的活动」
出處：`sources/text/farming-growth-care.json` 字元 777-786 `loop[2].zh`
顯示：安排等待期間的活動

「收获并决定下一轮」
出處：`sources/text/farming-growth-care.json` 字元 853-861 `loop[3].zh`
顯示：收穫並決定下一輪

## 玩家取捨

「地种得越多，日常照料越重：扩张必须匹配行动预算。」
出處：`sources/text/farming-growth-care.json` 字元 958-982 `decisions[0].zh`
顯示：地種得越多，日常照料越重：擴張必須匹配行動預算。

「把成熟时间错开，可以平滑收入；集中成熟则适合一次性加工。」
出處：`sources/text/farming-growth-care.json` 字元 1092-1120 `decisions[1].zh`
顯示：把成熟時間錯開，可以平滑收入；集中成熟則適合一次性加工。

## 可調參數

「照料频率」
出處：`sources/text/farming-growth-care.json` 字元 1280-1284 `parameters[0].name.zh`
顯示：照料頻率

「频率越高，越强调日程；降低频率会释放探索时间。」
出處：`sources/text/farming-growth-care.json` 字元 1360-1383 `parameters[0].effect.zh`
顯示：頻率越高，越強調日程；降低頻率會釋放探索時間。

「成长时长」
出處：`sources/text/farming-growth-care.json` 字元 1540-1544 `parameters[1].name.zh`
顯示：成長時長

「长周期放大前期选择的重要性，短周期鼓励试错。」
出處：`sources/text/farming-growth-care.json` 字元 1621-1643 `parameters[1].effect.zh`
顯示：長週期放大前期選擇的重要性，短週期鼓勵試錯。

## 原型

「先做4块田、1种作物和“播种／浇水／过一天”三个按钮，用颜色表示成长阶段。」
出處：`sources/text/farming-growth-care.json` 字元 3061-3098 `prototype.firstStep.zh`
顯示：先做4塊田、1種作物和“播種／澆水／過一天”三個按鈕，用顏色表示成長階段。

「让试玩者自己决定种几块田，观察他会不会为了留出别的行动而主动少种。」
出處：`sources/text/farming-growth-care.json` 字元 3422-3455 `prototype.test.zh`
顯示：讓試玩者自己決定種幾塊田，觀察他會不會爲了留出別的行動而主動少種。

「先验证照料是否有取舍；过早加入几十种作物只会增加配表与检查量。」
出處：`sources/text/farming-growth-care.json` 字元 3252-3283 `prototype.pitfall.zh`
顯示：先驗證照料是否有取捨；過早加入幾十種作物只會增加配表與檢查量。

## 相關模式

- [知識與材料雙重解鎖](cooking-recipe-learning.md)
- [受限空間中的物流路由](automation-belt-routing.md)

## 參考來源

- [Planting and crop care — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/farming-growth-care/) — 查閱：2026-11-02；取得方式：page-text。
