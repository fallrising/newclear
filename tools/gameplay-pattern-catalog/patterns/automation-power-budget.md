---
{
  "schema_version": 2,
  "id": "automation-power-budget",
  "title": "電力預算",
  "title_en": "Power supply balancing",
  "category": "automation",
  "source_category": "automation",
  "tags": [
    "planning",
    "risk",
    "optimization"
  ],
  "summary": "让发电、储能与负载保持匹配，避免扩产拖垮整座工厂。",
  "note_status": "draft",
  "related": [
    "automation-byproduct-loop",
    "automation-aerial-logistics",
    "automation-belt-routing",
    "automation-blueprint-reuse"
  ],
  "sources": [
    {
      "title": "Power supply balancing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/automation-power-budget/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「让发电、储能与负载保持匹配，避免扩产拖垮整座工厂。」
出處：`sources/text/automation-power-budget.json` 字元 177-202 `summary.zh`
顯示：讓發電、儲能與負載保持匹配，避免擴產拖垮整座工廠。

## 規則

「玩家接通机器并建设电源，观察总需求与可用供给。用电高峰或燃料中断造成减速或停机；预留余量、储能和分区是不同的应对方法。」
出處：`sources/text/automation-power-budget.json` 字元 324-383 `rules.zh`
顯示：玩家接通機器並建設電源，觀察總需求與可用供給。用電高峯或燃料中斷造成減速或停機；預留餘量、儲能和分區是不同的應對方法。

## 核心循環

「估算新增负载」
出處：`sources/text/automation-power-budget.json` 字元 620-626 `loop[0].zh`
顯示：估算新增負載

「增加电源或储能」
出處：`sources/text/automation-power-budget.json` 字元 689-696 `loop[1].zh`
顯示：增加電源或儲能

「接入新设备」
出處：`sources/text/automation-power-budget.json` 字元 765-770 `loop[2].zh`
顯示：接入新設備

「观察峰值与故障」
出處：`sources/text/automation-power-budget.json` 字元 830-837 `loop[3].zh`
顯示：觀察峯值與故障

## 玩家取捨

「提前铺大发电设施更稳，却推迟其他生产投资。」
出處：`sources/text/automation-power-budget.json` 字元 926-947 `decisions[0].zh`
顯示：提前鋪大發電設施更穩，卻推遲其他生產投資。

「独立电网能隔离故障，但不能直接共享所有余量。」
出處：`sources/text/automation-power-budget.json` 字元 1059-1081 `decisions[1].zh`
顯示：獨立電網能隔離故障，但不能直接共享所有餘量。

## 可調參數

「峰谷差」
出處：`sources/text/automation-power-budget.json` 字元 1238-1241 `parameters[0].name.zh`
顯示：峯谷差

「波动大时，储能与启动顺序比平均功率更重要。」
出處：`sources/text/automation-power-budget.json` 字元 1319-1340 `parameters[0].effect.zh`
顯示：波動大時，儲能與啓動順序比平均功率更重要。

「缺电惩罚」
出處：`sources/text/automation-power-budget.json` 字元 1490-1494 `parameters[1].name.zh`
顯示：缺電懲罰

「减速给玩家恢复时间；全网跳闸会强化预警与备用方案。」
出處：`sources/text/automation-power-budget.json` 字元 1573-1598 `parameters[1].effect.zh`
顯示：減速給玩家恢復時間；全網跳閘會強化預警與備用方案。

## 原型

「做总供给、三台不同负载和开关，明确显示超载如何影响设备。」
出處：`sources/text/automation-power-budget.json` 字元 3042-3070 `prototype.firstStep.zh`
顯示：做總供給、三臺不同負載和開關，明確顯示超載如何影響設備。

「供电不足时，玩家是否能选出暂时停掉的工序，并解释保留哪些产出？」
出處：`sources/text/automation-power-budget.json` 字元 3415-3446 `prototype.test.zh`
顯示：供電不足時，玩家是否能選出暫時停掉的工序，並解釋保留哪些產出？

「先决定断电规则；一会儿全停、一会儿随机停且无解释，会破坏可预测性。」
出處：`sources/text/automation-power-budget.json` 字元 3226-3259 `prototype.pitfall.zh`
顯示：先決定斷電規則；一會兒全停、一會兒隨機停且無解釋，會破壞可預測性。

## 相關模式

- [副產品循環](automation-byproduct-loop.md)
- [空中搬運物流](automation-aerial-logistics.md)
- [受限空間中的物流路由](automation-belt-routing.md)
- [藍圖重用](automation-blueprint-reuse.md)

## 參考來源

- [Power supply balancing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/automation-power-budget/) — 查閱：2026-11-02；取得方式：page-text。
