---
{
  "schema_version": 2,
  "id": "incremental-allocate-progress-capacity",
  "title": "分配進度容量",
  "title_en": "Allocate capacity across ongoing projects",
  "category": "incremental",
  "source_category": "incremental",
  "tags": [
    "planning",
    "optimization",
    "time"
  ],
  "summary": "投入不会立刻消失，但被一个项目占用，就不能同时加速另一个。",
  "note_status": "draft",
  "related": [
    "incremental-escalating-copy-price",
    "incremental-limited-team-dispatch",
    "incremental-offline-window",
    "incremental-spend-held-bonus"
  ],
  "sources": [
    {
      "title": "Allocate capacity across ongoing projects — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/incremental-allocate-progress-capacity/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「投入不会立刻消失，但被一个项目占用，就不能同时加速另一个。」
出處：`sources/text/incremental-allocate-progress-capacity.json` 字元 217-246 `summary.zh`
顯示：投入不會立刻消失，但被一個項目佔用，就不能同時加速另一個。

## 規則

「玩家把有限的可分配资源投入多个持续推进的项目。投入越多通常越快，但单项可能存在速度上限；资源可抽回再分配。玩家比较进度条和收益，决定集中冲完一项，还是让多项同时推进。」
出處：`sources/text/incremental-allocate-progress-capacity.json` 字元 394-477 `rules.zh`
顯示：玩家把有限的可分配資源投入多個持續推進的項目。投入越多通常越快，但單項可能存在速度上限；資源可抽回再分配。玩家比較進度條和收益，決定集中衝完一項，還是讓多項同時推進。

## 核心循環

「查看可分配总量」
出處：`sources/text/incremental-allocate-progress-capacity.json` 字元 790-797 `loop[0].zh`
顯示：查看可分配總量

「分给几个持续项目」
出處：`sources/text/incremental-allocate-progress-capacity.json` 字元 865-873 `loop[1].zh`
顯示：分給幾個持續項目

「观察速度和进度上限」
出處：`sources/text/incremental-allocate-progress-capacity.json` 字元 948-957 `loop[2].zh`
顯示：觀察速度和進度上限

「抽回多余投入重新分配」
出處：`sources/text/incremental-allocate-progress-capacity.json` 字元 1023-1033 `loop[3].zh`
顯示：抽回多餘投入重新分配

## 玩家取捨

「把所有资源投给短期急需的项目，还是让长期项目也不停工？」
出處：`sources/text/incremental-allocate-progress-capacity.json` 字元 1126-1153 `decisions[0].zh`
顯示：把所有資源投給短期急需的項目，還是讓長期項目也不停工？

「某项已经达到最快速度，继续留资源是省操作，还是浪费机会？」
出處：`sources/text/incremental-allocate-progress-capacity.json` 字元 1269-1297 `decisions[1].zh`
顯示：某項已經達到最快速度，繼續留資源是省操作，還是浪費機會？

## 可調參數

「投入与速度曲线」
出處：`sources/text/incremental-allocate-progress-capacity.json` 字元 1472-1479 `parameters[0].name.zh`
顯示：投入與速度曲線

「线性关系容易估计；有上限或递减收益会鼓励重新分配。」
出處：`sources/text/incremental-allocate-progress-capacity.json` 字元 1566-1591 `parameters[0].effect.zh`
顯示：線性關係容易估計；有上限或遞減收益會鼓勵重新分配。

「调配成本」
出處：`sources/text/incremental-allocate-progress-capacity.json` 字元 1757-1761 `parameters[1].name.zh`
顯示：調配成本

「自由调配支持随时优化；冷却或进度损失会让承诺更重要。」
出處：`sources/text/incremental-allocate-progress-capacity.json` 字元 1840-1866 `parameters[1].effect.zh`
顯示：自由調配支持隨時優化；冷卻或進度損失會讓承諾更重要。

## 原型

「做两条进度条、一个总量固定的资源池和加减分配按钮。」
出處：`sources/text/incremental-allocate-progress-capacity.json` 字元 3416-3441 `prototype.firstStep.zh`
顯示：做兩條進度條、一個總量固定的資源池和加減分配按鈕。

「玩家是否会在项目接近上限或完成时主动回收多余产能？」
出處：`sources/text/incremental-allocate-progress-capacity.json` 字元 3754-3779 `prototype.test.zh`
顯示：玩家是否會在項目接近上限或完成時主動回收多餘產能？

「要清楚区分“消耗掉”和“暂时占用”，否则玩家不敢调整。」
出處：`sources/text/incremental-allocate-progress-capacity.json` 字元 3569-3596 `prototype.pitfall.zh`
顯示：要清楚區分“消耗掉”和“暫時佔用”，否則玩家不敢調整。

## 相關模式

- [複本愈多愈貴](incremental-escalating-copy-price.md)
- [有限隊伍派遣](incremental-limited-team-dispatch.md)
- [離線窗口](incremental-offline-window.md)
- [花費持有加成](incremental-spend-held-bonus.md)

## 參考來源

- [Allocate capacity across ongoing projects — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/incremental-allocate-progress-capacity/) — 查閱：2026-11-02；取得方式：page-text。
