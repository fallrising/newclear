---
{
  "schema_version": 2,
  "id": "incremental-offline-window",
  "title": "離線窗口",
  "title_en": "Set up earnings before leaving",
  "category": "incremental",
  "source_category": "incremental",
  "tags": [
    "time",
    "planning",
    "economy"
  ],
  "summary": "离线收益取决于离开时的安排，也可能受到时间上限约束。",
  "note_status": "draft",
  "related": [
    "incremental-spend-time-advance",
    "incremental-allocate-progress-capacity",
    "incremental-escalating-copy-price",
    "incremental-limited-team-dispatch"
  ],
  "sources": [
    {
      "title": "Set up earnings before leaving — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/incremental-offline-window/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「离线收益取决于离开时的安排，也可能受到时间上限约束。」
出處：`sources/text/incremental-offline-window.json` 字元 196-222 `summary.zh`
顯示：離線收益取決於離開時的安排，也可能受到時間上限約束。

## 規則

「玩家离开前选择持续执行的动作或产出配置。返回时按有效离线时长结算，耗材、容量或时间上限可能使后续时间不再产生同等收益。下一次离开前，玩家会依据停工原因重新准备。」
出處：`sources/text/incremental-offline-window.json` 字元 341-421 `rules.zh`
顯示：玩家離開前選擇持續執行的動作或產出配置。返回時按有效離線時長結算，耗材、容量或時間上限可能使後續時間不再產生同等收益。下一次離開前，玩家會依據停工原因重新準備。

## 核心循環

「查看本次要离开多久」
出處：`sources/text/incremental-offline-window.json` 字元 709-718 `loop[0].zh`
顯示：查看本次要離開多久

「选择可持续执行的安排」
出處：`sources/text/incremental-offline-window.json` 字元 780-790 `loop[1].zh`
顯示：選擇可持續執行的安排

「回来查看离线结算」
出處：`sources/text/incremental-offline-window.json` 字元 860-868 `loop[2].zh`
顯示：回來查看離線結算

「补足限制再安排下一次」
出處：`sources/text/incremental-offline-window.json` 字元 941-951 `loop[3].zh`
顯示：補足限制再安排下一次

## 玩家取捨

「离开很久时，选择收益高但很快耗尽材料的任务，还是低收益却能持续的任务？」
出處：`sources/text/incremental-offline-window.json` 字元 1053-1088 `decisions[0].zh`
顯示：離開很久時，選擇收益高但很快耗盡材料的任務，還是低收益卻能持續的任務？

「先提高产出速度，还是先延长有效离线时间？」
出處：`sources/text/incremental-offline-window.json` 字元 1228-1248 `decisions[1].zh`
顯示：先提高產出速度，還是先延長有效離線時間？

## 可調參數

「有效离线时长」
出處：`sources/text/incremental-offline-window.json` 字元 1399-1405 `parameters[0].name.zh`
顯示：有效離線時長

「上限越短，配置与实际离开时间越容易不匹配；应清楚显示何时停止结算。」
出處：`sources/text/incremental-offline-window.json` 字元 1488-1521 `parameters[0].effect.zh`
顯示：上限越短，配置與實際離開時間越容易不匹配；應清楚顯示何時停止結算。

「离线效率」
出處：`sources/text/incremental-offline-window.json` 字元 1678-1682 `parameters[1].name.zh`
顯示：離線效率

「与在线相同便于理解；不同时应同时显示速率和损失原因。」
出處：`sources/text/incremental-offline-window.json` 字元 1762-1788 `parameters[1].effect.zh`
顯示：與在線相同便於理解；不同時應同時顯示速率和損失原因。

## 原型

「保存退出时间与一种任务，返回时结算带上限的时间差，并展示计算明细。」
出處：`sources/text/incremental-offline-window.json` 字元 3374-3407 `prototype.firstStep.zh`
顯示：保存退出時間與一種任務，返回時結算帶上限的時間差，並展示計算明細。

「玩家能否从结算报告解释为什么少赚了一部分？」
出處：`sources/text/incremental-offline-window.json` 字元 3718-3739 `prototype.test.zh`
顯示：玩家能否從結算報告解釋爲什麼少賺了一部分？

「设备时间变化、重复结算和材料不足都要有确定规则。」
出處：`sources/text/incremental-offline-window.json` 字元 3562-3586 `prototype.pitfall.zh`
顯示：設備時間變化、重複結算和材料不足都要有確定規則。

## 相關模式

- [花費時間提前結算](incremental-spend-time-advance.md)
- [分配進度容量](incremental-allocate-progress-capacity.md)
- [複本愈多愈貴](incremental-escalating-copy-price.md)
- [有限隊伍派遣](incremental-limited-team-dispatch.md)

## 參考來源

- [Set up earnings before leaving — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/incremental-offline-window/) — 查閱：2026-11-02；取得方式：page-text。
