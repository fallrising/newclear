---
{
  "schema_version": 2,
  "id": "inventory-weight-budget",
  "title": "重量預算",
  "title_en": "Carry-weight budgets",
  "category": "inventory",
  "source_category": "inventory",
  "tags": [
    "planning",
    "risk",
    "economy"
  ],
  "summary": "容量不是能否装下，而是还能否带着它行动。",
  "note_status": "draft",
  "related": [
    "inventory-death-retrieval",
    "inventory-durability",
    "inventory-light-reserve",
    "inventory-stack-limits"
  ],
  "sources": [
    {
      "title": "Carry-weight budgets — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/inventory-weight-budget/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「容量不是能否装下，而是还能否带着它行动。」
出處：`sources/text/inventory-weight-budget.json` 字元 175-195 `summary.zh`
顯示：容量不是能否裝下，而是還能否帶着它行動。

## 規則

「每件物品贡献重量，累计超额后行动受到限制。玩家比较用途与重量，丢弃、存放或分批搬运战利品；重量条将看不见的后勤成本变成即时反馈。」
出處：`sources/text/inventory-weight-budget.json` 字元 285-349 `rules.zh`
顯示：每件物品貢獻重量，累計超額後行動受到限制。玩家比較用途與重量，丟棄、存放或分批搬運戰利品；重量條將看不見的後勤成本變成即時反饋。

## 核心循環

「估算返程所需补给」
出處：`sources/text/inventory-weight-budget.json` 字元 580-588 `loop[0].zh`
顯示：估算返程所需補給

「拾取并查看负重」
出處：`sources/text/inventory-weight-budget.json` 字元 656-663 `loop[1].zh`
顯示：拾取並查看負重

「比较保留价值」
出處：`sources/text/inventory-weight-budget.json` 字元 728-734 `loop[2].zh`
顯示：比較保留價值

「卸货后继续探索」
出處：`sources/text/inventory-weight-budget.json` 字元 800-807 `loop[3].zh`
顯示：卸貨後繼續探索

## 玩家取捨

「低价值重物值得多走一趟，还是应留给后续专门运输？」
出處：`sources/text/inventory-weight-budget.json` 字元 889-913 `decisions[0].zh`
顯示：低價值重物值得多走一趟，還是應留給後續專門運輸？

「把容量用于收益还是安全补给？」
出處：`sources/text/inventory-weight-budget.json` 字元 1030-1044 `decisions[1].zh`
顯示：把容量用於收益還是安全補給？

## 可調參數

「超重惩罚曲线」
出處：`sources/text/inventory-weight-budget.json` 字元 1175-1181 `parameters[0].name.zh`
顯示：超重懲罰曲線

「突然无法行动制造强制取舍；渐进减速让风险更可估量。」
出處：`sources/text/inventory-weight-budget.json` 字元 1256-1281 `parameters[0].effect.zh`
顯示：突然無法行動製造強制取捨；漸進減速讓風險更可估量。

「卸货距离」
出處：`sources/text/inventory-weight-budget.json` 字元 1439-1443 `parameters[1].name.zh`
顯示：卸貨距離

「距离越远，路线与中转点越有价值。」
出處：`sources/text/inventory-weight-budget.json` 字元 1523-1539 `parameters[1].effect.zh`
顯示：距離越遠，路線與中轉點越有價值。

## 原型

「做十种有重量与用途的物品、一条负重条和超重减速。」
出處：`sources/text/inventory-weight-budget.json` 字元 2927-2951 `prototype.firstStep.zh`
顯示：做十種有重量與用途的物品、一條負重條和超重減速。

「改变下一次任务需求，观察玩家是否保留不同物品而非总按售价排序。」
出處：`sources/text/inventory-weight-budget.json` 字元 3253-3284 `prototype.test.zh`
顯示：改變下一次任務需求，觀察玩家是否保留不同物品而非總按售價排序。

「物品价值如果总和重量成正比，取舍会退化成固定排序。」
出處：`sources/text/inventory-weight-budget.json` 字元 3091-3116 `prototype.pitfall.zh`
顯示：物品價值如果總和重量成正比，取捨會退化成固定排序。

## 相關模式

- [死亡取回](inventory-death-retrieval.md)
- [工具耐久與維護決策](inventory-durability.md)
- [消耗型光源的存量](inventory-light-reserve.md)
- [堆疊限制](inventory-stack-limits.md)

## 參考來源

- [Carry-weight budgets — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/inventory-weight-budget/) — 查閱：2026-11-02；取得方式：page-text。
