---
{
  "schema_version": 2,
  "id": "farming-crop-protection",
  "title": "作物保護",
  "title_en": "Crop protection",
  "category": "farming",
  "source_category": "farming",
  "tags": [
    "risk",
    "spatial",
    "planning"
  ],
  "summary": "产量不仅靠种出来，也要靠布防保下来。",
  "note_status": "draft",
  "related": [
    "building-structural-support",
    "building-water-engineering",
    "combat-cover-flanking",
    "combat-destructible-cover"
  ],
  "sources": [
    {
      "title": "Crop protection — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/farming-crop-protection/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「产量不仅靠种出来，也要靠布防保下来。」
出處：`sources/text/farming-crop-protection.json` 字元 165-183 `summary.zh`
顯示：產量不僅靠種出來，也要靠佈防保下來。

## 規則

「作物可能被害鸟等外部威胁破坏。玩家建设防护物，检查保护范围并在扩田时补齐空隙；损失体现为缺失植株，形成预防成本与预期损失的比较。」
出處：`sources/text/farming-crop-protection.json` 字元 269-333 `rules.zh`
顯示：作物可能被害鳥等外部威脅破壞。玩家建設防護物，檢查保護範圍並在擴田時補齊空隙；損失體現爲缺失植株，形成預防成本與預期損失的比較。

## 核心循環

「识别损失来源」
出處：`sources/text/farming-crop-protection.json` 字元 578-584 `loop[0].zh`
顯示：識別損失來源

「配置防护范围」
出處：`sources/text/farming-crop-protection.json` 字元 647-653 `loop[1].zh`
顯示：配置防護範圍

「检查未覆盖地块」
出處：`sources/text/farming-crop-protection.json` 字元 724-731 `loop[2].zh`
顯示：檢查未覆蓋地塊

「扩田时同步补防」
出處：`sources/text/farming-crop-protection.json` 字元 796-803 `loop[3].zh`
顯示：擴田時同步補防

## 玩家取捨

「小田可以暂时容忍损失，昂贵作物则值得优先保护。」
出處：`sources/text/farming-crop-protection.json` 字元 897-920 `decisions[0].zh`
顯示：小田可以暫時容忍損失，昂貴作物則值得優先保護。

「防护物占用的田地也有成本，最密集布局未必最稳。」
出處：`sources/text/farming-crop-protection.json` 字元 1042-1065 `decisions[1].zh`
顯示：防護物佔用的田地也有成本，最密集佈局未必最穩。

## 可調參數

「威胁可见性」
出處：`sources/text/farming-crop-protection.json` 字元 1227-1232 `parameters[0].name.zh`
顯示：威脅可見性

「可见敌害鼓励主动干预，离线结算则更依赖规划。」
出處：`sources/text/farming-crop-protection.json` 字元 1311-1333 `parameters[0].effect.zh`
顯示：可見敵害鼓勵主動干預，離線結算則更依賴規劃。

「损失规模」
出處：`sources/text/farming-crop-protection.json` 字元 1487-1491 `parameters[1].name.zh`
顯示：損失規模

「偶发单株损失较温和，成片破坏会推动强制布防。」
出處：`sources/text/farming-crop-protection.json` 字元 1563-1585 `parameters[1].effect.zh`
顯示：偶發單株損失較溫和，成片破壞會推動強制佈防。

## 原型

「做一种定期出现的威胁、一个覆盖范围和失去作物的可见记录。」
出處：`sources/text/farming-crop-protection.json` 字元 3017-3045 `prototype.firstStep.zh`
顯示：做一種定期出現的威脅、一個覆蓋範圍和失去作物的可見記錄。

「玩家见到一次损失后，能否指出漏防格并通过重新布局降低风险？」
出處：`sources/text/farming-crop-protection.json` 字元 3350-3379 `prototype.test.zh`
顯示：玩家見到一次損失後，能否指出漏防格並通過重新佈局降低風險？

「别让随机损失完全没有预警或记录，否则玩家无法区分漏防与程序错误。」
出處：`sources/text/farming-crop-protection.json` 字元 3188-3220 `prototype.pitfall.zh`
顯示：別讓隨機損失完全沒有預警或記錄，否則玩家無法區分漏防與程序錯誤。

## 相關模式

- [支撐約束與結構失效](building-structural-support.md)
- [水位與蓄留](building-water-engineering.md)
- [掩體側擊](combat-cover-flanking.md)
- [可破壞掩體](combat-destructible-cover.md)

## 參考來源

- [Crop protection — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/farming-crop-protection/) — 查閱：2026-11-02；取得方式：page-text。
