---
{
  "schema_version": 2,
  "id": "automation-blueprint-reuse",
  "title": "藍圖重用",
  "title_en": "Reusable factory blueprints",
  "category": "automation",
  "source_category": "automation",
  "tags": [
    "creativity",
    "planning",
    "optimization"
  ],
  "summary": "把验证过的生产单元保存下来，快速复制并适配新场地。",
  "note_status": "draft",
  "related": [
    "automation-aerial-logistics",
    "automation-belt-routing",
    "automation-byproduct-loop",
    "automation-conditional-control"
  ],
  "sources": [
    {
      "title": "Reusable factory blueprints — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/automation-blueprint-reuse/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把验证过的生产单元保存下来，快速复制并适配新场地。」
出處：`sources/text/automation-blueprint-reuse.json` 字元 187-212 `summary.zh`
顯示：把驗證過的生產單元保存下來，快速複製並適配新場地。

## 規則

「玩家先搭出能运行的模块，再记录布局与配置并重复放置。材料、可用空间和外部连接仍需满足；复制后用产出表现检验接口是否接好。」
出處：`sources/text/automation-blueprint-reuse.json` 字元 328-388 `rules.zh`
顯示：玩家先搭出能運行的模塊，再記錄佈局與配置並重復放置。材料、可用空間和外部連接仍需滿足；複製後用產出表現檢驗接口是否接好。

## 核心循環

「试做一个模块」
出處：`sources/text/automation-blueprint-reuse.json` 字元 623-629 `loop[0].zh`
顯示：試做一個模塊

「保存布局」
出處：`sources/text/automation-blueprint-reuse.json` 字元 693-697 `loop[1].zh`
顯示：保存佈局

「选择位置并复制」
出處：`sources/text/automation-blueprint-reuse.json` 字元 756-763 `loop[2].zh`
顯示：選擇位置並複製

「接好外部接口」
出處：`sources/text/automation-blueprint-reuse.json` 字元 819-825 `loop[3].zh`

## 玩家取捨

「通用模块适应面广，但可能不如定制布局紧凑。」
出處：`sources/text/automation-blueprint-reuse.json` 字元 917-938 `decisions[0].zh`
顯示：通用模塊適應面廣，但可能不如定製佈局緊湊。

「先复制一份测试接口，还是一次铺满以节省操作？原模块有错会跟着复制多少次？」
出處：`sources/text/automation-blueprint-reuse.json` 字元 1066-1102 `decisions[1].zh`
顯示：先複製一份測試接口，還是一次鋪滿以節省操作？原模塊有錯會跟着複製多少次？

## 可調參數

「模板尺寸」
出處：`sources/text/automation-blueprint-reuse.json` 字元 1292-1296 `parameters[0].name.zh`

「小模板鼓励接口标准化，大模板降低重复劳动。」
出處：`sources/text/automation-blueprint-reuse.json` 字元 1371-1392 `parameters[0].effect.zh`
顯示：小模板鼓勵接口標準化，大模板降低重複勞動。

「复制成本」
出處：`sources/text/automation-blueprint-reuse.json` 字元 1541-1545 `parameters[1].name.zh`
顯示：複製成本

「保留材料成本让蓝图省操作而不跳过资源经营。」
出處：`sources/text/automation-blueprint-reuse.json` 字元 1623-1644 `parameters[1].effect.zh`
顯示：保留材料成本讓藍圖省操作而不跳過資源經營。

## 原型

「做小网格上的框选、保存与放置，并检查材料和占位；先只支持几种建筑。」
出處：`sources/text/automation-blueprint-reuse.json` 字元 3144-3177 `prototype.firstStep.zh`
顯示：做小網格上的框選、保存與放置，並檢查材料和佔位；先只支持幾種建築。

「玩家复制后是否会检查接口，且发现原模块错误后能修正而非继续放大故障？」
出處：`sources/text/automation-blueprint-reuse.json` 字元 3559-3593 `prototype.test.zh`
顯示：玩家複製後是否會檢查接口，且發現原模塊錯誤後能修正而非繼續放大故障？

「旋转、镜像、跨层与版本兼容会增加保存格式复杂度，先把原样复制做可靠。」
出處：`sources/text/automation-blueprint-reuse.json` 字元 3358-3392 `prototype.pitfall.zh`
顯示：旋轉、鏡像、跨層與版本兼容會增加保存格式複雜度，先把原樣複製做可靠。

## 相關模式

- [空中搬運物流](automation-aerial-logistics.md)
- [受限空間中的物流路由](automation-belt-routing.md)
- [副產品循環](automation-byproduct-loop.md)
- [條件控制](automation-conditional-control.md)

## 參考來源

- [Reusable factory blueprints — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/automation-blueprint-reuse/) — 查閱：2026-11-02；取得方式：page-text。
