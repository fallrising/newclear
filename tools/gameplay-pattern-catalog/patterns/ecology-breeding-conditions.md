---
{
  "schema_version": 2,
  "id": "ecology-breeding-conditions",
  "title": "繁育條件組",
  "title_en": "Prepare conditions that enable breeding",
  "category": "ecology",
  "source_category": "ecology",
  "tags": [
    "information",
    "discovery",
    "planning"
  ],
  "summary": "选对一对亲本还不够，时间、环境和育幼条件也要到位。",
  "note_status": "draft",
  "related": [
    "ecology-genetic-diversity",
    "ecology-plant-crossbreeding",
    "ecology-animal-taming",
    "ecology-habitat-capacity"
  ],
  "sources": [
    {
      "title": "Prepare conditions that enable breeding — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/ecology-breeding-conditions/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「选对一对亲本还不够，时间、环境和育幼条件也要到位。」
出處：`sources/text/ecology-breeding-conditions.json` 字元 199-224 `summary.zh`
顯示：選對一對親本還不夠，時間、環境和育幼條件也要到位。

## 規則

「繁殖结果需要亲本之外的特定条件。玩家读线索、调整环境并尝试，看到结果后判断缺了什么；成功后还要给新生个体准备合适的照料。」
出處：`sources/text/ecology-breeding-conditions.json` 字元 360-420 `rules.zh`
顯示：繁殖結果需要親本之外的特定條件。玩家讀線索、調整環境並嘗試，看到結果後判斷缺了什麼；成功後還要給新生個體準備合適的照料。

## 核心循環

「读取目标的繁殖线索」
出處：`sources/text/ecology-breeding-conditions.json` 字元 663-672 `loop[0].zh`
顯示：讀取目標的繁殖線索

「布置亲本与环境条件」
出處：`sources/text/ecology-breeding-conditions.json` 字元 748-757 `loop[1].zh`
顯示：佈置親本與環境條件

「尝试并观察是否触发」
出處：`sources/text/ecology-breeding-conditions.json` 字元 831-840 `loop[2].zh`
顯示：嘗試並觀察是否觸發

「照料新生个体并记录条件」
出處：`sources/text/ecology-breeding-conditions.json` 字元 915-926 `loop[3].zh`
顯示：照料新生個體並記錄條件

## 玩家取捨

「改变环境让这一对成功，还是选择更适合现有环境的另一对？」
出處：`sources/text/ecology-breeding-conditions.json` 字元 1031-1058 `decisions[0].zh`
顯示：改變環境讓這一對成功，還是選擇更適合現有環境的另一對？

「等天气或时段自然满足，还是投入资源主动创造条件？」
出處：`sources/text/ecology-breeding-conditions.json` 字元 1185-1209 `decisions[1].zh`
顯示：等天氣或時段自然滿足，還是投入資源主動創造條件？

## 可調參數

「条件数量与提示」
出處：`sources/text/ecology-breeding-conditions.json` 字元 1367-1374 `parameters[0].name.zh`
顯示：條件數量與提示

「条件越多越需要逐项反馈；只告诉玩家“失败”无法支持合理试验。」
出處：`sources/text/ecology-breeding-conditions.json` 字元 1456-1486 `parameters[0].effect.zh`
顯示：條件越多越需要逐項反饋；只告訴玩家“失敗”無法支持合理試驗。

「育幼负担」
出處：`sources/text/ecology-breeding-conditions.json` 字元 1659-1663 `parameters[1].name.zh`
顯示：育幼負擔

「成功后的额外照料能形成下一步，但不能在毫无预告时惩罚成功。」
出處：`sources/text/ecology-breeding-conditions.json` 字元 1739-1768 `parameters[1].effect.zh`
顯示：成功後的額外照料能形成下一步，但不能在毫無預告時懲罰成功。

## 原型

「用两组亲本、昼夜和有无遮挡两项条件，以及逐项通过提示。」
出處：`sources/text/ecology-breeding-conditions.json` 字元 3300-3327 `prototype.firstStep.zh`
顯示：用兩組親本、晝夜和有無遮擋兩項條件，以及逐項通過提示。

「给一次缺少单项条件的失败，看玩家能否只改相关条件并重复成功。」
出處：`sources/text/ecology-breeding-conditions.json` 字元 3688-3718 `prototype.test.zh`
顯示：給一次缺少單項條件的失敗，看玩家能否只改相關條件並重覆成功。

「避免第一版同时加入真实天气模拟和大量隐藏配方；先检验玩家能否隔离变量。」
出處：`sources/text/ecology-breeding-conditions.json` 字元 3481-3516 `prototype.pitfall.zh`
顯示：避免第一版同時加入真實天氣模擬和大量隱藏配方；先檢驗玩家能否隔離變量。

## 相關模式

- [遺傳多樣性](ecology-genetic-diversity.md)
- [植物雜交](ecology-plant-crossbreeding.md)
- [動物馴養](ecology-animal-taming.md)
- [棲地容量](ecology-habitat-capacity.md)

## 參考來源

- [Prepare conditions that enable breeding — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/ecology-breeding-conditions/) — 查閱：2026-11-02；取得方式：page-text。
