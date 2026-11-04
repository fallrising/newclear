---
{
  "schema_version": 2,
  "id": "survival-wound-cleanliness",
  "title": "傷口清潔決策",
  "title_en": "Wound hygiene and infection prevention",
  "category": "survival",
  "source_category": "survival",
  "tags": [
    "planning",
    "risk"
  ],
  "summary": "今天省下的护理，可能变成明天的新麻烦。",
  "note_status": "draft",
  "related": [
    "survival-bleeding-triage",
    "survival-competing-needs",
    "survival-fatigue-rest",
    "survival-limb-impairment"
  ],
  "sources": [
    {
      "title": "Wound hygiene and infection prevention — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/survival-wound-cleanliness/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「今天省下的护理，可能变成明天的新麻烦。」
出處：`sources/text/survival-wound-cleanliness.json` 字元 197-216 `summary.zh`
顯示：今天省下的護理，可能變成明天的新麻煩。

## 規則

「伤口在恢复期间仍有状态变化。玩家清洁伤口、选择敷料并检查是否需要更换；即时目标是控制风险，反馈则是伤口状态和后来是否出现感染。」
出處：`sources/text/survival-wound-cleanliness.json` 字元 315-378 `rules.zh`
顯示：傷口在恢復期間仍有狀態變化。玩家清潔傷口、選擇敷料並檢查是否需要更換；即時目標是控制風險，反饋則是傷口狀態和後來是否出現感染。

## 核心循環

「检查伤口和敷料状态」
出處：`sources/text/survival-wound-cleanliness.json` 字元 611-620 `loop[0].zh`
顯示：檢查傷口和敷料狀態

「选择清洁或更换」
出處：`sources/text/survival-wound-cleanliness.json` 字元 692-699 `loop[1].zh`
顯示：選擇清潔或更換

「消耗用品并继续活动」
出處：`sources/text/survival-wound-cleanliness.json` 字元 772-781 `loop[2].zh`
顯示：消耗用品並繼續活動

「过一段时间复查」
出處：`sources/text/survival-wound-cleanliness.json` 字元 859-866 `loop[3].zh`
顯示：過一段時間複查

## 玩家取捨

「把最后一份清洁用品用于旧伤，还是留给下一次意外？」
出處：`sources/text/survival-wound-cleanliness.json` 字元 944-968 `decisions[0].zh`
顯示：把最後一份清潔用品用於舊傷，還是留給下一次意外？

「立即停下工作复查伤口，还是等这轮任务结束再处理？」
出處：`sources/text/survival-wound-cleanliness.json` 字元 1075-1099 `decisions[1].zh`
顯示：立即停下工作複查傷口，還是等這輪任務結束再處理？

## 可調參數

「感染提示延迟」
出處：`sources/text/survival-wound-cleanliness.json` 字元 1255-1261 `parameters[0].name.zh`
顯示：感染提示延遲

「延迟反馈让预防重要，也需要日志说明原因，避免像随机惩罚。」
出處：`sources/text/survival-wound-cleanliness.json` 字元 1341-1369 `parameters[0].effect.zh`
顯示：延遲反饋讓預防重要，也需要日誌說明原因，避免像隨機懲罰。

「敷料消耗速度」
出處：`sources/text/survival-wound-cleanliness.json` 字元 1506-1512 `parameters[1].name.zh`

「过快会变成重复家务；适中速度能形成出发前检查。」
出處：`sources/text/survival-wound-cleanliness.json` 字元 1587-1610 `parameters[1].effect.zh`
顯示：過快會變成重複家務；適中速度能形成出發前檢查。

## 原型

「做清洁、脏污、感染三种可见状态；只需一类伤口和两种物资。」
出處：`sources/text/survival-wound-cleanliness.json` 字元 2911-2939 `prototype.firstStep.zh`
顯示：做清潔、髒污、感染三種可見狀態；只需一類傷口和兩種物資。

「让玩家不查攻略处理两次伤口，检查是否理解状态变化。」
出處：`sources/text/survival-wound-cleanliness.json` 字元 3231-3256 `prototype.test.zh`
顯示：讓玩家不查攻略處理兩次傷口，檢查是否理解狀態變化。

「不要把现实医疗知识作为玩家必备条件；道具提示应说明游戏内用途。」
出處：`sources/text/survival-wound-cleanliness.json` 字元 3072-3103 `prototype.pitfall.zh`
顯示：不要把現實醫療知識作爲玩家必備條件；道具提示應說明遊戲內用途。

## 相關模式

- [失血分診](survival-bleeding-triage.md)
- [競爭需求](survival-competing-needs.md)
- [疲勞休息點](survival-fatigue-rest.md)
- [肢體機能受損](survival-limb-impairment.md)

## 參考來源

- [Wound hygiene and infection prevention — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/survival-wound-cleanliness/) — 查閱：2026-11-02；取得方式：page-text。
