---
{
  "schema_version": 2,
  "id": "allocation-worker-placement",
  "title": "工人放置",
  "title_en": "Commit a worker to occupy an action",
  "category": "allocation",
  "source_category": "allocation",
  "tags": [
    "planning",
    "economy"
  ],
  "summary": "先去的位置能做事，也会暂时挡住别人。",
  "note_status": "draft",
  "related": [
    "allocation-area-majority",
    "allocation-follow-phase",
    "allocation-public-goal-race",
    "allocation-public-pick"
  ],
  "sources": [
    {
      "title": "Commit a worker to occupy an action — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/allocation-worker-placement/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先去的位置能做事，也会暂时挡住别人。」
出處：`sources/text/allocation-worker-placement.json` 字元 198-216 `summary.zh`
顯示：先去的位置能做事，也會暫時擋住別人。

## 規則

「玩家把有限工人放到公开行动位，支付要求并获得效果；多数位置被占后本轮不能再放人。玩家要安排先后顺序，既完成自己的计划，也判断哪个位置等不到下一次；轮末收回工人后重新争夺。」
出處：`sources/text/allocation-worker-placement.json` 字元 321-406 `rules.zh`
顯示：玩家把有限工人放到公開行動位，支付要求並獲得效果；多數位置被佔後本輪不能再放人。玩家要安排先後順序，既完成自己的計劃，也判斷哪個位置等不到下一次；輪末收回工人後重新爭奪。

## 核心循環

「查看空位与行动条件」
出處：`sources/text/allocation-worker-placement.json` 字元 691-700 `loop[0].zh`
顯示：查看空位與行動條件

「派一个工人执行行动」
出處：`sources/text/allocation-worker-placement.json` 字元 780-789 `loop[1].zh`
顯示：派一個工人執行行動

「位置被占，更新备选方案」
出處：`sources/text/allocation-worker-placement.json` 字元 861-872 `loop[2].zh`
顯示：位置被佔，更新備選方案

「收回工人开始下一轮」
出處：`sources/text/allocation-worker-placement.json` 字元 946-955 `loop[3].zh`
顯示：收回工人開始下一輪

## 玩家取捨

「先拿资源再建造，还是先抢快被占的关键行动？」
出處：`sources/text/allocation-worker-placement.json` 字元 1055-1076 `decisions[0].zh`
顯示：先拿資源再建造，還是先搶快被佔的關鍵行動？

「为阻止对手占一个自己收益较低的位置，划算吗？」
出處：`sources/text/allocation-worker-placement.json` 字元 1182-1204 `decisions[1].zh`
顯示：爲阻止對手佔一個自己收益較低的位置，划算嗎？

## 可調參數

「每轮工人数」
出處：`sources/text/allocation-worker-placement.json` 字元 1352-1357 `parameters[0].name.zh`
顯示：每輪工人數

「工人越少，每次占位越像不可回头的承诺。」
出處：`sources/text/allocation-worker-placement.json` 字元 1436-1455 `parameters[0].effect.zh`
顯示：工人越少，每次佔位越像不可回頭的承諾。

「位置容量」
出處：`sources/text/allocation-worker-placement.json` 字元 1583-1587 `parameters[1].name.zh`

「允许多人但提高后续成本，可缓和完全被堵死的挫败。」
出處：`sources/text/allocation-worker-placement.json` 字元 1663-1687 `parameters[1].effect.zh`
顯示：允許多人但提高後續成本，可緩和完全被堵死的挫敗。

## 原型

「三名本地玩家各两枚工人，五个固定行动位，只做一轮占位与回收。」
出處：`sources/text/allocation-worker-placement.json` 字元 3107-3137 `prototype.firstStep.zh`
顯示：三名本地玩家各兩枚工人，五個固定行動位，只做一輪佔位與回收。

「关键位置被占后，玩家能否马上理解原因并找到备选行动？」
出處：`sources/text/allocation-worker-placement.json` 字元 3412-3438 `prototype.test.zh`
顯示：關鍵位置被佔後，玩家能否馬上理解原因並找到備選行動？

「过多访问条件和例外会掩盖占位的基本冲突。」
出處：`sources/text/allocation-worker-placement.json` 字元 3272-3292 `prototype.pitfall.zh`
顯示：過多訪問條件和例外會掩蓋佔位的基本衝突。

## 相關模式

- [區域多數](allocation-area-majority.md)
- [跟進階段](allocation-follow-phase.md)
- [公開目標競速](allocation-public-goal-race.md)
- [公開選取](allocation-public-pick.md)

## 參考來源

- [Commit a worker to occupy an action — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/allocation-worker-placement/) — 查閱：2026-11-02；取得方式：page-text。
