---
{
  "schema_version": 2,
  "id": "building-structural-support",
  "title": "支撐約束與結構失效",
  "title_en": "Structural support and collapse",
  "category": "building",
  "source_category": "building",
  "tags": [
    "constraint-graph",
    "stability",
    "spatial-planning"
  ],
  "summary": "建得高、伸得远之前，先找到能够承受结构的支点。",
  "note_status": "draft",
  "related": [
    "automation-belt-routing",
    "puzzles-box-pushing"
  ],
  "sources": [
    {
      "title": "Structural support and collapse — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/building-structural-support/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「建得高、伸得远之前，先找到能够承受结构的支点。」
出處：`sources/text/building-structural-support.json` 字元 189-212 `summary.zh`
顯示：建得高、伸得遠之前，先找到能夠承受結構的支點。

## 規則

「玩家搭建墙、梁和地板，结构必须满足支撑规则。悬挑或远离稳固支点会降低安全余量，失去支撑可能坍塌；根据提示加固后继续扩建。」
出處：`sources/text/building-structural-support.json` 字元 323-383 `rules.zh`
顯示：玩家搭建牆、梁和地板，結構必須滿足支撐規則。懸挑或遠離穩固支點會降低安全餘量，失去支撐可能坍塌；根據提示加固後繼續擴建。

## 核心循環

「建立稳固支点」
出處：`sources/text/building-structural-support.json` 字元 570-576 `loop[0].zh`
顯示：建立穩固支點

「向外扩展结构」
出處：`sources/text/building-structural-support.json` 字元 641-647 `loop[1].zh`
顯示：向外擴展結構

「读取稳定性提示」
出處：`sources/text/building-structural-support.json` 字元 711-718 `loop[2].zh`
顯示：讀取穩定性提示

「加固或改变形状」
出處：`sources/text/building-structural-support.json` 字元 785-792 `loop[3].zh`
顯示：加固或改變形狀

## 玩家取捨

「更多柱子更安全，却占据活动空间。」
出處：`sources/text/building-structural-support.json` 字元 877-893 `decisions[0].zh`
顯示：更多柱子更安全，卻佔據活動空間。

「更强材料允许大胆形状，但需要额外探索或加工。」
出處：`sources/text/building-structural-support.json` 字元 990-1012 `decisions[1].zh`
顯示：更強材料允許大膽形狀，但需要額外探索或加工。

## 可調參數

「支撑距离」
出處：`sources/text/building-structural-support.json` 字元 1156-1160 `parameters[0].name.zh`
顯示：支撐距離

「更长跨度放松工程约束，鼓励造型。」
出處：`sources/text/building-structural-support.json` 字元 1235-1251 `parameters[0].effect.zh`
顯示：更長跨度放鬆工程約束，鼓勵造型。

「坍塌损失」
出處：`sources/text/building-structural-support.json` 字元 1377-1381 `parameters[1].name.zh`
顯示：坍塌損失

「材料可回收鼓励试验，连锁损坏会要求先做小原型。」
出處：`sources/text/building-structural-support.json` 字元 1456-1479 `parameters[1].effect.zh`
顯示：材料可回收鼓勵試驗，連鎖損壞會要求先做小原型。

## 原型

「先用二维格子与“离地基的连接距离”判定支撑，不用真实刚体坍塌。」
出處：`sources/text/building-structural-support.json` 字元 2894-2925 `prototype.firstStep.zh`
顯示：先用二維格子與“離地基的連接距離”判定支撐，不用真實剛體坍塌。

「看到危险提示后，玩家能否推断该加固哪里，并预测拆除某支点的影响？」
出處：`sources/text/building-structural-support.json` 字元 3307-3339 `prototype.test.zh`
顯示：看到危險提示後，玩家能否推斷該加固哪裏，並預測拆除某支點的影響？

「结构分析、破坏传播和物理碎块是不同成本，先把安全提示与规则做一致。」
出處：`sources/text/building-structural-support.json` 字元 3101-3134 `prototype.pitfall.zh`
顯示：結構分析、破壞傳播和物理碎塊是不同成本，先把安全提示與規則做一致。

## 相關模式

- [受限空間中的物流路由](automation-belt-routing.md)
- [不可逆推動與位置可達性](puzzles-box-pushing.md)

## 參考來源

- [Structural support and collapse — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/building-structural-support/) — 查閱：2026-11-02；取得方式：page-text。
