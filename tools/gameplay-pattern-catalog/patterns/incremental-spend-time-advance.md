---
{
  "schema_version": 2,
  "id": "incremental-spend-time-advance",
  "title": "花費時間提前結算",
  "title_en": "Spend an item to bring future earnings forward",
  "category": "incremental",
  "source_category": "incremental",
  "tags": [
    "time",
    "economy",
    "planning"
  ],
  "summary": "同一张时间券，配置更好时使用会得到不同结果。",
  "note_status": "draft",
  "related": [
    "incremental-offline-window",
    "commerce-timed-contracts",
    "incremental-allocate-progress-capacity",
    "incremental-escalating-copy-price"
  ],
  "sources": [
    {
      "title": "Spend an item to bring future earnings forward — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/incremental-spend-time-advance/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「同一张时间券，配置更好时使用会得到不同结果。」
出處：`sources/text/incremental-spend-time-advance.json` 字元 217-239 `summary.zh`
顯示：同一張時間券，配置更好時使用會得到不同結果。

## 規則

「玩家拥有数量有限的时间推进道具，使用后按当前可生效的产出或进度规则立即结算一段时间。先升级再使用通常会改变收益，而等待升级也有机会成本。应明确它推进哪些系统，以及临时效果是否被计入。」
出處：`sources/text/incremental-spend-time-advance.json` 字元 360-451 `rules.zh`
顯示：玩家擁有數量有限的時間推進道具，使用後按當前可生效的產出或進度規則立即結算一段時間。先升級再使用通常會改變收益，而等待升級也有機會成本。應明確它推進哪些系統，以及臨時效果是否被計入。

## 核心循環

「查看道具的预计结算」
出處：`sources/text/incremental-spend-time-advance.json` 字元 771-780 `loop[0].zh`
顯示：查看道具的預計結算

「判断是否先调整产出」
出處：`sources/text/incremental-spend-time-advance.json` 字元 856-865 `loop[1].zh`
顯示：判斷是否先調整產出

「使用道具推进允许的进度」
出處：`sources/text/incremental-spend-time-advance.json` 字元 950-961 `loop[2].zh`
顯示：使用道具推進允許的進度

「用收益投入下一轮」
出處：`sources/text/incremental-spend-time-advance.json` 字元 1042-1050 `loop[3].zh`
顯示：用收益投入下一輪

## 玩家取捨

「现在用道具跨过卡点，还是再等一个产量升级让它更值钱？」
出處：`sources/text/incremental-spend-time-advance.json` 字元 1153-1179 `decisions[0].zh`
顯示：現在用道具跨過卡點，還是再等一個產量升級讓它更值錢？

「一次用完多个，还是每次结算后重新投资再用下一张？」
出處：`sources/text/incremental-spend-time-advance.json` 字元 1312-1336 `decisions[1].zh`
顯示：一次用完多個，還是每次結算後重新投資再用下一張？

## 可調參數

「结算依据」
出處：`sources/text/incremental-spend-time-advance.json` 字元 1467-1471 `parameters[0].name.zh`
顯示：結算依據

「按当前速率结算易于预测；模拟过程则要解释中途停工与解锁。」
出處：`sources/text/incremental-spend-time-advance.json` 字元 1549-1577 `parameters[0].effect.zh`
顯示：按當前速率結算易於預測；模擬過程則要解釋中途停工與解鎖。

「作用范围」
出處：`sources/text/incremental-spend-time-advance.json` 字元 1746-1750 `parameters[1].name.zh`
顯示：作用範圍

「只影响一个产线或地区会增加选择；全局推进则需要统一边界提示。」
出處：`sources/text/incremental-spend-time-advance.json` 字元 1828-1858 `parameters[1].effect.zh`
顯示：隻影響一個產線或地區會增加選擇；全局推進則需要統一邊界提示。

## 原型

「只推进一种资源，使用前明确显示时间长度、预计收入和排除项。」
出處：`sources/text/incremental-spend-time-advance.json` 字元 3390-3419 `prototype.firstStep.zh`
顯示：只推進一種資源，使用前明確顯示時間長度、預計收入和排除項。

「玩家是否会先检查当前产出，再决定用券或保留？」
出處：`sources/text/incremental-spend-time-advance.json` 字元 3711-3733 `prototype.test.zh`
顯示：玩家是否會先檢查當前產出，再決定用券或保留？

「不要把本机制的原型验证绑定真实付费；先用关卡奖励发券。」
出處：`sources/text/incremental-spend-time-advance.json` 字元 3553-3580 `prototype.pitfall.zh`
顯示：不要把本機制的原型驗證綁定真實付費；先用關卡獎勵發券。

## 相關模式

- [離線窗口](incremental-offline-window.md)
- [限時合約](commerce-timed-contracts.md)
- [分配進度容量](incremental-allocate-progress-capacity.md)
- [複本愈多愈貴](incremental-escalating-copy-price.md)

## 參考來源

- [Spend an item to bring future earnings forward — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/incremental-spend-time-advance/) — 查閱：2026-11-02；取得方式：page-text。
