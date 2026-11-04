---
{
  "schema_version": 2,
  "id": "automation-flow-splitting",
  "title": "流量分流",
  "title_en": "Flow splitting and ratios",
  "category": "automation",
  "source_category": "automation",
  "tags": [
    "optimization",
    "planning",
    "spatial"
  ],
  "summary": "把有限输入分给多台机器，避免一边吃撑、一边断粮。",
  "note_status": "draft",
  "related": [
    "automation-aerial-logistics",
    "automation-belt-routing",
    "automation-blueprint-reuse",
    "automation-byproduct-loop"
  ],
  "sources": [
    {
      "title": "Flow splitting and ratios — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/automation-flow-splitting/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把有限输入分给多台机器，避免一边吃撑、一边断粮。」
出處：`sources/text/automation-flow-splitting.json` 字元 183-207 `summary.zh`
顯示：把有限輸入分給多臺機器，避免一邊喫撐、一邊斷糧。

## 規則

「玩家用分流器把一条输入接到多个消费者。每台机器有不同消耗速度，某个出口积压会改变实际分配；以稳定开工率而非建筑数量判断成功。」
出處：`sources/text/automation-flow-splitting.json` 字元 316-378 `rules.zh`
顯示：玩家用分流器把一條輸入接到多個消費者。每臺機器有不同消耗速度，某個出口積壓會改變實際分配；以穩定開工率而非建築數量判斷成功。

## 核心循環

「计算各支路需求」
出處：`sources/text/automation-flow-splitting.json` 字元 598-605 `loop[0].zh`
顯示：計算各支路需求

「选择分流拓扑」
出處：`sources/text/automation-flow-splitting.json` 字元 671-677 `loop[1].zh`
顯示：選擇分流拓撲

「运行到稳定状态」
出處：`sources/text/automation-flow-splitting.json` 字元 745-752 `loop[2].zh`
顯示：運行到穩定狀態

「调整机器或支路」
出處：`sources/text/automation-flow-splitting.json` 字元 821-828 `loop[3].zh`
顯示：調整機器或支路

## 玩家取捨

「平均分配简单，但需求不等时会浪费供给。」
出處：`sources/text/automation-flow-splitting.json` 字元 920-939 `decisions[0].zh`
顯示：平均分配簡單，但需求不等時會浪費供給。

「串联喂料占地小，却需要等待前端缓冲填满。」
出處：`sources/text/automation-flow-splitting.json` 字元 1051-1071 `decisions[1].zh`
顯示：串聯喂料佔地小，卻需要等待前端緩衝填滿。

## 可調參數

「需求比例差」
出處：`sources/text/automation-flow-splitting.json` 字元 1216-1221 `parameters[0].name.zh`

「差异越大，平均分流越不够用，需要优先级或多级分配。」
出處：`sources/text/automation-flow-splitting.json` 字元 1299-1324 `parameters[0].effect.zh`
顯示：差異越大，平均分流越不夠用，需要優先級或多級分配。

「缓冲容量」
出處：`sources/text/automation-flow-splitting.json` 字元 1487-1491 `parameters[1].name.zh`
顯示：緩衝容量

「大缓冲平滑短时波动，也拉长稳定运行前的等待。」
出處：`sources/text/automation-flow-splitting.json` 字元 1564-1586 `parameters[1].effect.zh`
顯示：大緩衝平滑短時波動，也拉長穩定運行前的等待。

## 原型

「做一个固定供给源、两个不同消耗速度的接收器和可调分流器，显示开工率。」
出處：`sources/text/automation-flow-splitting.json` 字元 3022-3056 `prototype.firstStep.zh`
顯示：做一個固定供給源、兩個不同消耗速度的接收器和可調分流器，顯示開工率。

「玩家看到“一台堆料、一台停机”时，是否会改比例，而非只增加输入？」
出處：`sources/text/automation-flow-splitting.json` 字元 3394-3426 `prototype.test.zh`
顯示：玩家看到“一臺堆料、一臺停機”時，是否會改比例，而非只增加輸入？

「不要先加入几十种配方；两种不同需求已经能检验比例是否影响产出。」
出處：`sources/text/automation-flow-splitting.json` 字元 3214-3245 `prototype.pitfall.zh`
顯示：不要先加入幾十種配方；兩種不同需求已經能檢驗比例是否影響產出。

## 相關模式

- [空中搬運物流](automation-aerial-logistics.md)
- [受限空間中的物流路由](automation-belt-routing.md)
- [藍圖重用](automation-blueprint-reuse.md)
- [副產品循環](automation-byproduct-loop.md)

## 參考來源

- [Flow splitting and ratios — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/automation-flow-splitting/) — 查閱：2026-11-02；取得方式：page-text。
