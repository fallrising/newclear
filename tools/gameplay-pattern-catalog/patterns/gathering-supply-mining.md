---
{
  "schema_version": 2,
  "id": "gathering-supply-mining",
  "title": "供給開採",
  "title_en": "Gathering to sustain gathering",
  "category": "gathering",
  "source_category": "gathering",
  "tags": [
    "economy",
    "risk",
    "optimization"
  ],
  "summary": "途中补充继续采集所需的弹药、能源或生命。",
  "note_status": "draft",
  "related": [
    "gathering-gathering-quota",
    "gathering-salvage-dismantling",
    "automation-byproduct-loop",
    "automation-power-budget"
  ],
  "sources": [
    {
      "title": "Gathering to sustain gathering — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/gathering-supply-mining/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「途中补充继续采集所需的弹药、能源或生命。」
出處：`sources/text/gathering-supply-mining.json` 字元 184-204 `summary.zh`
顯示：途中補充繼續採集所需的彈藥、能源或生命。

## 規則

「部分资源不直接作为最终目标，而是转化为持续行动所需的补给。玩家在推进目标与维持工具、队伍续航之间切换；补给过少会迫使行动提前结束。」
出處：`sources/text/gathering-supply-mining.json` 字元 309-374 `rules.zh`
顯示：部分資源不直接作爲最終目標，而是轉化爲持續行動所需的補給。玩家在推進目標與維持工具、隊伍續航之間切換；補給過少會迫使行動提前結束。

## 核心循環

「检查续航缺口」
出處：`sources/text/gathering-supply-mining.json` 字元 621-627 `loop[0].zh`
顯示：檢查續航缺口

「寻找补给资源」
出處：`sources/text/gathering-supply-mining.json` 字元 689-695 `loop[1].zh`
顯示：尋找補給資源

「消耗资源恢复能力」
出處：`sources/text/gathering-supply-mining.json` 字元 764-772 `loop[2].zh`
顯示：消耗資源恢復能力

「继续目标采集」
出處：`sources/text/gathering-supply-mining.json` 字元 846-852 `loop[3].zh`
顯示：繼續目標採集

## 玩家取捨

「眼前就有目标资源，要不要先绕路补给？」
出處：`sources/text/gathering-supply-mining.json` 字元 943-961 `decisions[0].zh`
顯示：眼前就有目標資源，要不要先繞路補給？

「备用补给攒到多少才足够，何时变成无效囤积？」
出處：`sources/text/gathering-supply-mining.json` 字元 1060-1081 `decisions[1].zh`
顯示：備用補給攢到多少才足夠，何時變成無效囤積？

## 可調參數

「补给转换率」
出處：`sources/text/gathering-supply-mining.json` 字元 1231-1236 `parameters[0].name.zh`
顯示：補給轉換率

「高转换率降低维护频率；低转换率可能让玩家一直在为采集而采集。」
出處：`sources/text/gathering-supply-mining.json` 字元 1315-1345 `parameters[0].effect.zh`
顯示：高轉換率降低維護頻率；低轉換率可能讓玩家一直在爲採集而採集。

「资源分布重叠」
出處：`sources/text/gathering-supply-mining.json` 字元 1506-1512 `parameters[1].name.zh`
顯示：資源分佈重疊

「补给与目标重叠使流程顺滑；分离分布制造明确路线取舍。」
出處：`sources/text/gathering-supply-mining.json` 字元 1590-1616 `parameters[1].effect.zh`
顯示：補給與目標重疊使流程順滑；分離分佈製造明確路線取捨。

## 原型

「做目标矿与能源矿两类节点、一个电量条和明确的采矿耗能。」
出處：`sources/text/gathering-supply-mining.json` 字元 3128-3155 `prototype.firstStep.zh`
顯示：做目標礦與能源礦兩類節點、一個電量條和明確的採礦耗能。

「玩家能否提前补能，并根据距离选择带多少储备，而非总被耗尽提示赶着走？」
出處：`sources/text/gathering-supply-mining.json` 字元 3484-3518 `prototype.test.zh`
顯示：玩家能否提前補能，並根據距離選擇帶多少儲備，而非總被耗盡提示趕着走？

「补能过程若消耗比产出还大又没有替代路径，会形成无法恢复的死循环。」
出處：`sources/text/gathering-supply-mining.json` 字元 3293-3325 `prototype.pitfall.zh`
顯示：補能過程若消耗比產出還大又沒有替代路徑，會形成無法恢復的死循環。

## 相關模式

- [採集配額決策](gathering-gathering-quota.md)
- [拆件拆解](gathering-salvage-dismantling.md)
- [副產品循環](automation-byproduct-loop.md)
- [電力預算](automation-power-budget.md)

## 參考來源

- [Gathering to sustain gathering — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/gathering-supply-mining/) — 查閱：2026-11-02；取得方式：page-text。
