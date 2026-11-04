---
{
  "schema_version": 2,
  "id": "survival-competing-needs",
  "title": "競爭需求",
  "title_en": "Competing survival needs",
  "category": "survival",
  "source_category": "survival",
  "tags": [
    "planning",
    "risk"
  ],
  "summary": "解决饥饿时，口渴和疲劳还在继续累积。",
  "note_status": "draft",
  "related": [
    "survival-bleeding-triage",
    "survival-fatigue-rest",
    "survival-limb-impairment",
    "survival-safe-water"
  ],
  "sources": [
    {
      "title": "Competing survival needs — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/survival-competing-needs/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「解决饥饿时，口渴和疲劳还在继续累积。」
出處：`sources/text/survival-competing-needs.json` 字元 181-199 `summary.zh`
顯示：解決飢餓時，口渴和疲勞還在繼續累積。

## 規則

「玩家查看多个持续变化的需求，挑选当前最值得处理的一项。采集、吃饭、休息都要花时间；补上一条状态时，其他状态可能恶化，因此目标是维持可行动的余量。」
出處：`sources/text/survival-competing-needs.json` 字元 298-370 `rules.zh`
顯示：玩家查看多個持續變化的需求，挑選當前最值得處理的一項。採集、喫飯、休息都要花時間；補上一條狀態時，其他狀態可能惡化，因此目標是維持可行動的餘量。

## 核心循環

「查看最紧迫的需求」
出處：`sources/text/survival-competing-needs.json` 字元 620-628 `loop[0].zh`
顯示：查看最緊迫的需求

「选择补给或休息」
出處：`sources/text/survival-competing-needs.json` 字元 698-705 `loop[1].zh`
顯示：選擇補給或休息

「付出时间并恢复一项」
出處：`sources/text/survival-competing-needs.json` 字元 772-781 `loop[2].zh`
顯示：付出時間並恢復一項

「重看其他需求再安排」
出處：`sources/text/survival-competing-needs.json` 字元 855-864 `loop[3].zh`

## 玩家取捨

「先补最少的一条，还是先处理下降最快的一条？剩余量和恶化速度都要看。」
出處：`sources/text/survival-competing-needs.json` 字元 948-981 `decisions[0].zh`
顯示：先補最少的一條，還是先處理下降最快的一條？剩餘量和惡化速度都要看。

「绕路拿更多食物，还是趁精力足够先回营地？」
出處：`sources/text/survival-competing-needs.json` 字元 1101-1121 `decisions[1].zh`
顯示：繞路拿更多食物，還是趁精力足夠先回營地？

## 可調參數

「下降速度差」
出處：`sources/text/survival-competing-needs.json` 字元 1264-1269 `parameters[0].name.zh`

「不同速度使优先级不断变化；完全同速容易变成固定轮流补满。」
出處：`sources/text/survival-competing-needs.json` 字元 1352-1380 `parameters[0].effect.zh`
顯示：不同速度使優先級不斷變化；完全同速容易變成固定輪流補滿。

「临界惩罚」
出處：`sources/text/survival-competing-needs.json` 字元 1536-1540 `parameters[1].name.zh`
顯示：臨界懲罰

「先降低行动效率、再扣生命，能给玩家一次调整计划的机会。」
出處：`sources/text/survival-competing-needs.json` 字元 1621-1648 `parameters[1].effect.zh`
顯示：先降低行動效率、再扣生命，能給玩家一次調整計劃的機會。

## 原型

「先做两个需求条、采集和休息两个按钮，每次操作推进一轮。」
出處：`sources/text/survival-competing-needs.json` 字元 2964-2991 `prototype.firstStep.zh`
顯示：先做兩個需求條、採集和休息兩個按鈕，每次操作推進一輪。

「交换两个需求的下降速度，看玩家是否主动改变行动顺序。」
出處：`sources/text/survival-competing-needs.json` 字元 3293-3319 `prototype.test.zh`
顯示：交換兩個需求的下降速度，看玩家是否主動改變行動順序。

「需求过多会把判断变成检查仪表；先让两项形成清楚冲突。」
出處：`sources/text/survival-competing-needs.json` 字元 3128-3154 `prototype.pitfall.zh`
顯示：需求過多會把判斷變成檢查儀表；先讓兩項形成清楚衝突。

## 相關模式

- [失血分診](survival-bleeding-triage.md)
- [疲勞休息點](survival-fatigue-rest.md)
- [肢體機能受損](survival-limb-impairment.md)
- [取水與淨水決策](survival-safe-water.md)

## 參考來源

- [Competing survival needs — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/survival-competing-needs/) — 查閱：2026-11-02；取得方式：page-text。
