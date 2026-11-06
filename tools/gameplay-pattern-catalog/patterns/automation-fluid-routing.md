---
{
  "schema_version": 2,
  "id": "automation-fluid-routing",
  "title": "流體路由",
  "title_en": "Fluid routing",
  "category": "automation",
  "source_category": "automation",
  "tags": [
    "spatial",
    "optimization",
    "information"
  ],
  "summary": "通过管线、泵与分支把液体送到正确设备。",
  "note_status": "draft",
  "related": [
    "automation-aerial-logistics",
    "automation-belt-routing",
    "automation-conditional-control",
    "automation-flow-splitting"
  ],
  "sources": [
    {
      "title": "Fluid routing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/automation-fluid-routing/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「通过管线、泵与分支把液体送到正确设备。」
出處：`sources/text/automation-fluid-routing.json` 字元 170-189 `summary.zh`
顯示：通過管線、泵與分支把液體送到正確設備。

## 規則

「玩家连接液体来源与消耗端，并处理距离、高度或分支造成的限制。缺液会停产，错误连接可能混入不需要的液体；检查流量和设备状态后改管。」
出處：`sources/text/automation-fluid-routing.json` 字元 295-359 `rules.zh`
顯示：玩家連接液體來源與消耗端，並處理距離、高度或分支造成的限制。缺液會停產，錯誤連接可能混入不需要的液體；檢查流量和設備狀態後改管。

## 核心循環

「标出供液端」
出處：`sources/text/automation-fluid-routing.json` 字元 616-621 `loop[0].zh`
顯示：標出供液端

「规划管道与泵」
出處：`sources/text/automation-fluid-routing.json` 字元 682-688 `loop[1].zh`
顯示：規劃管道與泵

「接入生产设备」
出處：`sources/text/automation-fluid-routing.json` 字元 752-758 `loop[2].zh`
顯示：接入生產設備

「检查流动并修正」
出處：`sources/text/automation-fluid-routing.json` 字元 819-826 `loop[3].zh`
顯示：檢查流動並修正

## 玩家取捨

「共用管网节省建造，但故障影响范围更大。」
出處：`sources/text/automation-fluid-routing.json` 字元 914-933 `decisions[0].zh`
顯示：共用管網節省建造，但故障影響範圍更大。

「增加泵或独立支路提高可控性，同时提高用电与维护成本。」
出處：`sources/text/automation-fluid-routing.json` 字元 1034-1060 `decisions[1].zh`
顯示：增加泵或獨立支路提高可控性，同時提高用電與維護成本。

## 可調參數

「高度限制」
出處：`sources/text/automation-fluid-routing.json` 字元 1226-1230 `parameters[0].name.zh`

「需要克服高度时，厂区选址也成为物流决策。」
出處：`sources/text/automation-fluid-routing.json` 字元 1307-1327 `parameters[0].effect.zh`
顯示：需要克服高度時，廠區選址也成爲物流決策。

「流量可视化」
出處：`sources/text/automation-fluid-routing.json` 字元 1464-1469 `parameters[1].name.zh`
顯示：流量可視化

「直接显示方向和瓶颈能把试错变成可推理的诊断。」
出處：`sources/text/automation-fluid-routing.json` 字元 1546-1568 `parameters[1].effect.zh`
顯示：直接顯示方向和瓶頸能把試錯變成可推理的診斷。

## 原型

「先做节点式管网、储液量和一条明确的高度限制，不必模拟真实流体表面。」
出處：`sources/text/automation-fluid-routing.json` 字元 2993-3026 `prototype.firstStep.zh`
顯示：先做節點式管網、儲液量和一條明確的高度限制，不必模擬真實流體表面。

「出现缺液时，玩家能否区分“源头不够”“输送太慢”和“高度不达标”？」
出處：`sources/text/automation-fluid-routing.json` 字元 3380-3413 `prototype.test.zh`
顯示：出現缺液時，玩家能否區分“源頭不夠”“輸送太慢”和“高度不達標”？

「物理精度、循环管网和多液体混合会大幅增加状态问题，应分阶段加入。」
出處：`sources/text/automation-fluid-routing.json` 字元 3201-3233 `prototype.pitfall.zh`
顯示：物理精度、循環管網和多液體混合會大幅增加狀態問題，應分階段加入。

## 相關模式

- [空中搬運物流](automation-aerial-logistics.md)
- [受限空間中的物流路由](automation-belt-routing.md)
- [條件控制](automation-conditional-control.md)
- [流量分流](automation-flow-splitting.md)

## 參考來源

- [Fluid routing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/automation-fluid-routing/) — 查閱：2026-11-02；取得方式：page-text。
