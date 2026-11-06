---
{
  "schema_version": 2,
  "id": "exploration-stealth-awareness",
  "title": "潛行警戒",
  "title_en": "Escalating awareness and stealth routing",
  "category": "stealth",
  "source_category": "stealth",
  "tags": [
    "information",
    "timing",
    "spatial"
  ],
  "summary": "被看见并非立刻失败，警觉阶段为玩家留下处理窗口。",
  "note_status": "draft",
  "related": [
    "stealth-light-shadow",
    "stealth-sound-lures",
    "stealth-hiding-spots",
    "stealth-synchronized-actions"
  ],
  "sources": [
    {
      "title": "Escalating awareness and stealth routing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/exploration-stealth-awareness/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「被看见并非立刻失败，警觉阶段为玩家留下处理窗口。」
出處：`sources/text/exploration-stealth-awareness.json` 字元 201-225 `summary.zh`
顯示：被看見並非立刻失敗，警覺階段爲玩家留下處理窗口。

## 規則

「在敌人的视线、听觉和巡逻路线间移动。可疑行为先累积警觉，再触发搜索或战斗；玩家可停下、遮挡视线、制造诱饵或换路，警觉反馈帮助理解哪里出了问题。」
出處：`sources/text/exploration-stealth-awareness.json` 字元 356-427 `rules.zh`
顯示：在敵人的視線、聽覺和巡邏路線間移動。可疑行爲先累積警覺，再觸發搜索或戰鬥；玩家可停下、遮擋視線、製造誘餌或換路，警覺反饋幫助理解哪裏出了問題。

## 核心循環

「观察巡逻与视线」
出處：`sources/text/exploration-stealth-awareness.json` 字元 667-674 `loop[0].zh`
顯示：觀察巡邏與視線

「选择遮挡与时机」
出處：`sources/text/exploration-stealth-awareness.json` 字元 748-755 `loop[1].zh`
顯示：選擇遮擋與時機

「通过或制造诱饵」
出處：`sources/text/exploration-stealth-awareness.json` 字元 822-829 `loop[2].zh`
顯示：通過或製造誘餌

「处理警觉后继续」
出處：`sources/text/exploration-stealth-awareness.json` 字元 897-904 `loop[3].zh`
顯示：處理警覺後繼續

## 玩家取捨

「等待巡逻离开最稳，制造声音更快，却会改变后续巡逻状态。」
出處：`sources/text/exploration-stealth-awareness.json` 字元 998-1025 `decisions[0].zh`
顯示：等待巡邏離開最穩，製造聲音更快，卻會改變後續巡邏狀態。

「发现尸体或违法动作会带来连锁后果，路线必须考虑离开时的状态。」
出處：`sources/text/exploration-stealth-awareness.json` 字元 1152-1182 `decisions[1].zh`
顯示：發現屍體或違法動作會帶來連鎖後果，路線必須考慮離開時的狀態。

## 可調參數

「警觉累积速度」
出處：`sources/text/exploration-stealth-awareness.json` 字元 1354-1360 `parameters[0].name.zh`
顯示：警覺累積速度

「缓慢累积允许补救，快速累积强调提前侦察。」
出處：`sources/text/exploration-stealth-awareness.json` 字元 1439-1459 `parameters[0].effect.zh`
顯示：緩慢累積允許補救，快速累積強調提前偵察。

「搜索持续时间」
出處：`sources/text/exploration-stealth-awareness.json` 字元 1601-1607 `parameters[1].name.zh`
顯示：搜索持續時間

「长时间搜索让失误改变整段关卡，短时间搜索更便于试错。」
出處：`sources/text/exploration-stealth-awareness.json` 字元 1687-1713 `parameters[1].effect.zh`
顯示：長時間搜索讓失誤改變整段關卡，短時間搜索更便於試錯。

## 原型

「做一条巡逻路线、视野范围，以及平静、怀疑、追踪三个明确状态。」
出處：`sources/text/exploration-stealth-awareness.json` 字元 3233-3263 `prototype.firstStep.zh`
顯示：做一條巡邏路線、視野範圍，以及平靜、懷疑、追蹤三個明確狀態。

「被怀疑后，玩家能否看懂警觉进度并成功采取一次补救行动。」
出處：`sources/text/exploration-stealth-awareness.json` 字元 3573-3600 `prototype.test.zh`
顯示：被懷疑後，玩家能否看懂警覺進度併成功採取一次補救行動。

「不要一开始叠加听觉、伪装和群体警报；先保证每次状态变化有原因。」
出處：`sources/text/exploration-stealth-awareness.json` 字元 3399-3430 `prototype.pitfall.zh`
顯示：不要一開始疊加聽覺、僞裝和羣體警報；先保證每次狀態變化有原因。

## 相關模式

- [光影之間的路線](stealth-light-shadow.md)
- [聲音誘餌](stealth-sound-lures.md)
- [藏點與脫離時機](stealth-hiding-spots.md)
- [同步動作](stealth-synchronized-actions.md)

## 參考來源

- [Escalating awareness and stealth routing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/exploration-stealth-awareness/) — 查閱：2026-11-02；取得方式：page-text。
