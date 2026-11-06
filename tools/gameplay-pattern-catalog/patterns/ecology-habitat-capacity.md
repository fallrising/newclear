---
{
  "schema_version": 2,
  "id": "ecology-habitat-capacity",
  "title": "棲地容量",
  "title_en": "Check habitat capacity before adding animals",
  "category": "ecology",
  "source_category": "ecology",
  "tags": [
    "planning",
    "economy",
    "spatial"
  ],
  "summary": "一只住得下，不代表再放五只仍然合适。",
  "note_status": "draft",
  "related": [
    "ecology-plant-crossbreeding",
    "ecology-population-limits",
    "ecology-species-compatibility",
    "building-access-network"
  ],
  "sources": [
    {
      "title": "Check habitat capacity before adding animals — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/ecology-habitat-capacity/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「一只住得下，不代表再放五只仍然合适。」
出處：`sources/text/ecology-habitat-capacity.json` 字元 202-220 `summary.zh`
顯示：一隻住得下，不代表再放五隻仍然合適。

## 規則

「玩家要同时满足物种的环境要求和整个群体的容量需求。新增或长大的动物会改变空间、设备或照料压力，因此每次扩群都要重新检查，而不是一次选对地形就永远完成。」
出處：`sources/text/ecology-habitat-capacity.json` 字元 322-397 `rules.zh`
顯示：玩家要同時滿足物種的環境要求和整個羣體的容量需求。新增或長大的動物會改變空間、設備或照料壓力，因此每次擴羣都要重新檢查，而不是一次選對地形就永遠完成。

## 核心循環

「查看现有环境与剩余容量」
出處：`sources/text/ecology-habitat-capacity.json` 字元 651-662 `loop[0].zh`
顯示：查看現有環境與剩餘容量

「预估新增个体带来的需求」
出處：`sources/text/ecology-habitat-capacity.json` 字元 741-752 `loop[1].zh`
顯示：預估新增個體帶來的需求

「扩建设备或分开安置」
出處：`sources/text/ecology-habitat-capacity.json` 字元 828-837 `loop[2].zh`
顯示：擴建設備或分開安置

「观察状态并保留余量」
出處：`sources/text/ecology-habitat-capacity.json` 字元 912-921 `loop[3].zh`
顯示：觀察狀態並保留餘量

## 玩家取捨

「增加一只高价值动物，还是把余量留给已出生的幼体长大？」
出處：`sources/text/ecology-habitat-capacity.json` 字元 1029-1055 `decisions[0].zh`
顯示：增加一隻高價值動物，還是把餘量留給已出生的幼體長大？

「升级原栖息地共用设施，还是新建一个独立区域？」
出處：`sources/text/ecology-habitat-capacity.json` 字元 1168-1190 `decisions[1].zh`
顯示：升級原棲息地共用設施，還是新建一個獨立區域？

## 可調參數

「需求增长方式」
出處：`sources/text/ecology-habitat-capacity.json` 字元 1325-1331 `parameters[0].name.zh`
顯示：需求增長方式

「每只固定增加与随体型增长，会分别强调数量控制和成长预期。」
出處：`sources/text/ecology-habitat-capacity.json` 字元 1407-1435 `parameters[0].effect.zh`
顯示：每隻固定增加與隨體型增長，會分別強調數量控制和成長預期。

「容量预警余量」
出處：`sources/text/ecology-habitat-capacity.json` 字元 1600-1606 `parameters[1].name.zh`
顯示：容量預警餘量

「只在超载后报警会迫使救火；提前显示余量能支持计划。」
出處：`sources/text/ecology-habitat-capacity.json` 字元 1684-1709 `parameters[1].effect.zh`
顯示：只在超載後報警會迫使救火；提前顯示餘量能支持計劃。

## 原型

「用一个水池、两种动物、当前与成年需求两列和一次升级操作。」
出處：`sources/text/ecology-habitat-capacity.json` 字元 3257-3285 `prototype.firstStep.zh`
顯示：用一個水池、兩種動物、當前與成年需求兩列和一次升級操作。

「显示幼体成年预告，看玩家是否会在当前容量尚充足时主动留位。」
出處：`sources/text/ecology-habitat-capacity.json` 字元 3606-3635 `prototype.test.zh`
顯示：顯示幼體成年預告，看玩家是否會在當前容量尚充足時主動留位。

「不要先模拟完整水化学；一条容量与一项环境条件足以验证扩群取舍。」
出處：`sources/text/ecology-habitat-capacity.json` 字元 3417-3448 `prototype.pitfall.zh`
顯示：不要先模擬完整水化學；一條容量與一項環境條件足以驗證擴羣取捨。

## 相關模式

- [植物雜交](ecology-plant-crossbreeding.md)
- [族群限制](ecology-population-limits.md)
- [物種共容](ecology-species-compatibility.md)
- [進出網路](building-access-network.md)

## 參考來源

- [Check habitat capacity before adding animals — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/ecology-habitat-capacity/) — 查閱：2026-11-02；取得方式：page-text。
