---
{
  "schema_version": 2,
  "id": "automation-byproduct-loop",
  "title": "副產品循環",
  "title_en": "Byproduct consumption and recirculation",
  "category": "automation",
  "source_category": "automation",
  "tags": [
    "optimization",
    "planning",
    "risk"
  ],
  "summary": "给不想要的产出找到去处，避免它把主产品生产一起堵停。",
  "note_status": "draft",
  "related": [
    "automation-power-budget",
    "automation-aerial-logistics",
    "automation-belt-routing",
    "automation-blueprint-reuse"
  ],
  "sources": [
    {
      "title": "Byproduct consumption and recirculation — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/automation-byproduct-loop/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「给不想要的产出找到去处，避免它把主产品生产一起堵停。」
出處：`sources/text/automation-byproduct-loop.json` 字元 198-224 `summary.zh`
顯示：給不想要的產出找到去處，避免它把主產品生產一起堵停。

## 規則

「一条工序同时产生多种输出，玩家必须为每一种设计使用、储存或排出路径。副产物积满会限制生产，转化与回流则把废物变成下一环输入。」
出處：`sources/text/automation-byproduct-loop.json` 字元 347-409 `rules.zh`
顯示：一條工序同時產生多種輸出，玩家必須爲每一種設計使用、儲存或排出路徑。副產物積滿會限制生產，轉化與迴流則把廢物變成下一環輸入。

## 核心循環

「列出全部输出」
出處：`sources/text/automation-byproduct-loop.json` 字元 657-663 `loop[0].zh`
顯示：列出全部輸出

「安排主副产物流向」
出處：`sources/text/automation-byproduct-loop.json` 字元 723-731 `loop[1].zh`
顯示：安排主副產物流向

「监测积压」
出處：`sources/text/automation-byproduct-loop.json` 字元 804-808 `loop[2].zh`
顯示：監測積壓

「新增消耗或回流」
出處：`sources/text/automation-byproduct-loop.json` 字元 867-874 `loop[3].zh`
顯示：新增消耗或迴流

## 玩家取捨

「直接处理简单可靠，回收利用更省资源却增加耦合。」
出處：`sources/text/automation-byproduct-loop.json` 字元 971-994 `decisions[0].zh`
顯示：直接處理簡單可靠，回收利用更省資源卻增加耦合。

「临时大仓延后问题，但不能解决长期供需不平衡。」
出處：`sources/text/automation-byproduct-loop.json` 字元 1100-1122 `decisions[1].zh`
顯示：臨時大倉延後問題，但不能解決長期供需不平衡。

## 可調參數

「副产比例」
出處：`sources/text/automation-byproduct-loop.json` 字元 1267-1271 `parameters[0].name.zh`
顯示：副產比例

「比例越高，处理链越接近核心生产目标。」
出處：`sources/text/automation-byproduct-loop.json` 字元 1348-1366 `parameters[0].effect.zh`
顯示：比例越高，處理鏈越接近核心生產目標。

「可处置方式」
出處：`sources/text/automation-byproduct-loop.json` 字元 1497-1502 `parameters[1].name.zh`
顯示：可處置方式

「允许随时丢弃降低停线风险；必须利用则强化闭环规划。」
出處：`sources/text/automation-byproduct-loop.json` 字元 1580-1605 `parameters[1].effect.zh`
顯示：允許隨時丟棄降低停線風險；必須利用則強化閉環規劃。

## 原型

「做一种主产品、一种副产物和有限容量，提供“处理掉”与“再利用”两条路径。」
出處：`sources/text/automation-byproduct-loop.json` 字元 3121-3157 `prototype.firstStep.zh`
顯示：做一種主產品、一種副產物和有限容量，提供“處理掉”與“再利用”兩條路徑。

「让回收端暂时停机，玩家能否找出积压源并恢复主线，而非只继续加仓库？」
出處：`sources/text/automation-byproduct-loop.json` 字元 3476-3509 `prototype.test.zh`
顯示：讓回收端暫時停機，玩家能否找出積壓源並恢復主線，而非只繼續加倉庫？

「复杂回流容易产生互相等待的死锁；先保证每种产出都有可解释的最终去处。」
出處：`sources/text/automation-byproduct-loop.json` 字元 3298-3332 `prototype.pitfall.zh`
顯示：複雜迴流容易產生互相等待的死鎖；先保證每種產出都有可解釋的最終去處。

## 相關模式

- [電力預算](automation-power-budget.md)
- [空中搬運物流](automation-aerial-logistics.md)
- [受限空間中的物流路由](automation-belt-routing.md)
- [藍圖重用](automation-blueprint-reuse.md)

## 參考來源

- [Byproduct consumption and recirculation — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/automation-byproduct-loop/) — 查閱：2026-11-02；取得方式：page-text。
