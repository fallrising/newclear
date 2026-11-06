---
{
  "schema_version": 2,
  "id": "incremental-limited-team-dispatch",
  "title": "有限隊伍派遣",
  "title_en": "Dispatch limited teams for delayed rewards",
  "category": "incremental",
  "source_category": "incremental",
  "tags": [
    "planning",
    "time",
    "risk"
  ],
  "summary": "长任务占住名额，更高奖励要和错过其他任务一起计算。",
  "note_status": "draft",
  "related": [
    "cooking-order-triage",
    "incremental-allocate-progress-capacity",
    "incremental-offline-window",
    "incremental-spend-time-advance"
  ],
  "sources": [
    {
      "title": "Dispatch limited teams for delayed rewards — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/incremental-limited-team-dispatch/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「长任务占住名额，更高奖励要和错过其他任务一起计算。」
出處：`sources/text/incremental-limited-team-dispatch.json` 字元 215-240 `summary.zh`
顯示：長任務佔住名額，更高獎勵要和錯過其他任務一起計算。

## 規則

「玩家把有限的队伍或角色派到有时长与回报的任务中。被派出的单位暂时不可参加其他任务，能力匹配和风险影响结果；任务完成后再回收队伍与奖励。关键是名额被占用的时间，不是玩家亲自完成订单。」
出處：`sources/text/incremental-limited-team-dispatch.json` 字元 372-462 `rules.zh`
顯示：玩家把有限的隊伍或角色派到有時長與回報的任務中。被派出的單位暫時不可參加其他任務，能力匹配和風險影響結果；任務完成後再回收隊伍與獎勵。關鍵是名額被佔用的時間，不是玩家親自完成訂單。

## 核心循環

「查看队伍与可选任务」
出處：`sources/text/incremental-limited-team-dispatch.json` 字元 805-814 `loop[0].zh`
顯示：查看隊伍與可選任務

「按能力与时长分配」
出處：`sources/text/incremental-limited-team-dispatch.json` 字元 891-899 `loop[1].zh`
顯示：按能力與時長分配

「等待并承担期间机会成本」
出處：`sources/text/incremental-limited-team-dispatch.json` 字元 977-988 `loop[2].zh`
顯示：等待並承擔期間機會成本

「回收队伍后重新派遣」
出處：`sources/text/incremental-limited-team-dispatch.json` 字元 1065-1074 `loop[3].zh`
顯示：回收隊伍後重新派遣

## 玩家取捨

「把最强队伍锁进高回报长任务，还是留着应对可能出现的新机会？」
出處：`sources/text/incremental-limited-team-dispatch.json` 字元 1171-1200 `decisions[0].zh`
顯示：把最強隊伍鎖進高回報長任務，還是留着應對可能出現的新機會？

「用不完全匹配的队伍冒险，还是让一个名额暂时空着？」
出處：`sources/text/incremental-limited-team-dispatch.json` 字元 1330-1354 `decisions[1].zh`
顯示：用不完全匹配的隊伍冒險，還是讓一個名額暫時空着？

## 可調參數

「并行任务名额」
出處：`sources/text/incremental-limited-team-dispatch.json` 字元 1486-1492 `parameters[0].name.zh`
顯示：並行任務名額

「名额少会突出优先级；名额太多容易只剩全派出去。」
出處：`sources/text/incremental-limited-team-dispatch.json` 字元 1576-1599 `parameters[0].effect.zh`
顯示：名額少會突出優先級；名額太多容易只剩全派出去。

「时长与风险的关系」
出處：`sources/text/incremental-limited-team-dispatch.json` 字元 1756-1764 `parameters[1].name.zh`
顯示：時長與風險的關係

「长任务不应只按比例放大奖励，还可改变风险、稀缺产物或准备需求。」
出處：`sources/text/incremental-limited-team-dispatch.json` 字元 1852-1883 `parameters[1].effect.zh`
顯示：長任務不應只按比例放大獎勵，還可改變風險、稀缺產物或準備需求。

## 原型

「做两个队伍槽、三个定时任务和一次完成结算，不需要真实多人或后台服务器。」
出處：`sources/text/incremental-limited-team-dispatch.json` 字元 3408-3443 `prototype.firstStep.zh`
顯示：做兩個隊伍槽、三個定時任務和一次完成結算，不需要真實多人或後臺服務器。

「玩家是否会为预计出现的任务保留队伍，而不总是立刻全派出去？」
出處：`sources/text/incremental-limited-team-dispatch.json` 字元 3780-3809 `prototype.test.zh`
顯示：玩家是否會爲預計出現的任務保留隊伍，而不總是立刻全派出去？

「任务完成、领取奖励和释放队伍必须是清楚且不会重复领取的状态。」
出處：`sources/text/incremental-limited-team-dispatch.json` 字元 3602-3632 `prototype.pitfall.zh`
顯示：任務完成、領取獎勵和釋放隊伍必須是清楚且不會重複領取的狀態。

## 相關模式

- [限時訂單的取捨順序](cooking-order-triage.md)
- [分配進度容量](incremental-allocate-progress-capacity.md)
- [離線窗口](incremental-offline-window.md)
- [花費時間提前結算](incremental-spend-time-advance.md)

## 參考來源

- [Dispatch limited teams for delayed rewards — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/incremental-limited-team-dispatch/) — 查閱：2026-11-02；取得方式：page-text。
