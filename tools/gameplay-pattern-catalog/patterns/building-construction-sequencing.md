---
{
  "schema_version": 2,
  "id": "building-construction-sequencing",
  "title": "施工工序",
  "title_en": "Construction sequencing",
  "category": "building",
  "source_category": "building",
  "tags": [
    "planning",
    "time",
    "optimization"
  ],
  "summary": "先画计划，再让工人按资源、通路和紧急程度落地。",
  "note_status": "draft",
  "related": [
    "building-access-network",
    "building-service-coverage",
    "building-room-requirements",
    "building-structural-support"
  ],
  "sources": [
    {
      "title": "Construction sequencing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/building-construction-sequencing/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先画计划，再让工人按资源、通路和紧急程度落地。」
出處：`sources/text/building-construction-sequencing.json` 字元 187-210 `summary.zh`
顯示：先畫計劃，再讓工人按資源、通路和緊急程度落地。

## 規則

「玩家下达施工任务而非立刻生成成品。工人搬运材料并建造，缺料或不可达会阻塞；分阶段施工和优先级避免任务卡死。」
出處：`sources/text/building-construction-sequencing.json` 字元 321-374 `rules.zh`
顯示：玩家下達施工任務而非立刻生成成品。工人搬運材料並建造，缺料或不可達會阻塞；分階段施工和優先級避免任務卡死。

## 核心循環

「放置施工计划」
出處：`sources/text/building-construction-sequencing.json` 字元 614-620 `loop[0].zh`
顯示：放置施工計劃

「确保材料通路」
出處：`sources/text/building-construction-sequencing.json` 字元 675-681 `loop[1].zh`
顯示：確保材料通路

「安排优先级」
出處：`sources/text/building-construction-sequencing.json` 字元 751-756 `loop[2].zh`
顯示：安排優先級

「检查阻塞任务」
出處：`sources/text/building-construction-sequencing.json` 字元 814-820 `loop[3].zh`
顯示：檢查阻塞任務

## 玩家取捨

「同时开很多项目会分散工人和材料。」
出處：`sources/text/building-construction-sequencing.json` 字元 906-922 `decisions[0].zh`
顯示：同時開很多項目會分散工人和材料。

「先修应急设施更稳，但可能需要后续拆改。」
出處：`sources/text/building-construction-sequencing.json` 字元 1008-1027 `decisions[1].zh`
顯示：先修應急設施更穩，但可能需要後續拆改。

## 可調參數

「施工耗时」
出處：`sources/text/building-construction-sequencing.json` 字元 1170-1174 `parameters[0].name.zh`
顯示：施工耗時

「长工期让顺序影响生存，短工期更偏布局创作。」
出處：`sources/text/building-construction-sequencing.json` 字元 1250-1271 `parameters[0].effect.zh`
顯示：長工期讓順序影響生存，短工期更偏佈局創作。

「优先级粒度」
出處：`sources/text/building-construction-sequencing.json` 字元 1413-1418 `parameters[1].name.zh`
顯示：優先級粒度

「细分可精确调度，也可能变成繁琐排队。」
出處：`sources/text/building-construction-sequencing.json` 字元 1500-1518 `parameters[1].effect.zh`
顯示：細分可精確調度，也可能變成繁瑣排隊。

## 原型

「做一名工人、材料堆、三项施工任务和优先级，显示任务等待原因。」
出處：`sources/text/building-construction-sequencing.json` 字元 2985-3015 `prototype.firstStep.zh`
顯示：做一名工人、材料堆、三項施工任務和優先級，顯示任務等待原因。

「出现因封路卡住的施工时，玩家能否通过改顺序或留通道自行恢复？」
出處：`sources/text/building-construction-sequencing.json` 字元 3356-3386 `prototype.test.zh`
顯示：出現因封路卡住的施工時，玩家能否通過改順序或留通道自行恢復？

「多工人抢任务、搬运预约和中途改计划都需要状态处理，先让单工人完整跑通。」
出處：`sources/text/building-construction-sequencing.json` 字元 3156-3191 `prototype.pitfall.zh`
顯示：多工人搶任務、搬運預約和中途改計劃都需要狀態處理，先讓單工人完整跑通。

## 相關模式

- [進出網路](building-access-network.md)
- [服務覆蓋](building-service-coverage.md)
- [房間需求條件](building-room-requirements.md)
- [支撐約束與結構失效](building-structural-support.md)

## 參考來源

- [Construction sequencing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/building-construction-sequencing/) — 查閱：2026-11-02；取得方式：page-text。
