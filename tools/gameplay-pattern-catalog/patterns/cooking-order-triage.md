---
{
  "schema_version": 2,
  "id": "cooking-order-triage",
  "title": "限時訂單的取捨順序",
  "title_en": "Timed order triage",
  "category": "cooking",
  "source_category": "cooking",
  "tags": [
    "time",
    "planning",
    "risk"
  ],
  "summary": "不只做得快，还要判断哪张单值得先做。",
  "note_status": "draft",
  "related": [
    "cooking-food-preservation",
    "cooking-heat-window",
    "commerce-regional-arbitrage",
    "commerce-timed-contracts"
  ],
  "sources": [
    {
      "title": "Timed order triage — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooking-order-triage/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「不只做得快，还要判断哪张单值得先做。」
出處：`sources/text/cooking-order-triage.json` 字元 167-185 `summary.zh`
顯示：不只做得快，還要判斷哪張單值得先做。

## 規則

「多个订单同时等待，制作耗时不同，耐心或截止时间持续下降。玩家选择处理顺序并交付匹配菜品，及时服务获得收益，延误则失去奖励或结束营业。」
出處：`sources/text/cooking-order-triage.json` 字元 301-367 `rules.zh`
顯示：多個訂單同時等待，製作耗時不同，耐心或截止時間持續下降。玩家選擇處理順序並交付匹配菜品，及時服務獲得收益，延誤則失去獎勵或結束營業。

## 核心循環

「查看等待订单」
出處：`sources/text/cooking-order-triage.json` 字元 636-642 `loop[0].zh`
顯示：查看等待訂單

「估算剩余时间与工时」
出處：`sources/text/cooking-order-triage.json` 字元 707-716 `loop[1].zh`
顯示：估算剩餘時間與工時

「优先制作」
出處：`sources/text/cooking-order-triage.json` 字元 795-799 `loop[2].zh`
顯示：優先製作

「交付后重排」
出處：`sources/text/cooking-order-triage.json` 字元 868-873 `loop[3].zh`
顯示：交付後重排

## 玩家取捨

「先做快到期的复杂单，还是先清掉两个快单？」
出處：`sources/text/cooking-order-triage.json` 字元 962-982 `decisions[0].zh`
顯示：先做快到期的複雜單，還是先清掉兩個快單？

「为了守住连单奖励，是否值得放弃更方便的顺序？」
出處：`sources/text/cooking-order-triage.json` 字元 1082-1104 `decisions[1].zh`
顯示：爲了守住連單獎勵，是否值得放棄更方便的順序？

## 可調參數

「截止时间差异」
出處：`sources/text/cooking-order-triage.json` 字元 1247-1253 `parameters[0].name.zh`
顯示：截止時間差異

「差异越大越需要动态调度；相同时间容易退化为队列。」
出處：`sources/text/cooking-order-triage.json` 字元 1333-1357 `parameters[0].effect.zh`
顯示：差異越大越需要動態調度；相同時間容易退化爲隊列。

「失败容忍度」
出處：`sources/text/cooking-order-triage.json` 字元 1516-1521 `parameters[1].name.zh`
顯示：失敗容忍度

「单次失误只扣分允许冒险；一桌离开就结束会鼓励保险计划。」
出處：`sources/text/cooking-order-triage.json` 字元 1600-1627 `parameters[1].effect.zh`
顯示：單次失誤只扣分允許冒險；一桌離開就結束會鼓勵保險計劃。

## 原型

「做三个同时倒计时的订单卡和固定制作时长，先用点击选择制作对象。」
出處：`sources/text/cooking-order-triage.json` 字元 3045-3076 `prototype.firstStep.zh`
顯示：做三個同時倒計時的訂單卡和固定制作時長，先用點擊選擇製作對象。

「改变一张订单的剩余耐心，玩家是否会调整顺序，而不是照出现次序完成？」
出處：`sources/text/cooking-order-triage.json` 字元 3406-3439 `prototype.test.zh`
顯示：改變一張訂單的剩餘耐心，玩家是否會調整順序，而不是照出現次序完成？

「别先增加大量菜谱；不同工时与截止时间已足够验证调度决策。」
出處：`sources/text/cooking-order-triage.json` 字元 3220-3248 `prototype.pitfall.zh`
顯示：別先增加大量菜譜；不同工時與截止時間已足夠驗證調度決策。

## 相關模式

- [食物保存](cooking-food-preservation.md)
- [熱度窗口](cooking-heat-window.md)
- [區域價差](commerce-regional-arbitrage.md)
- [限時合約](commerce-timed-contracts.md)

## 參考來源

- [Timed order triage — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooking-order-triage/) — 查閱：2026-11-02；取得方式：page-text。
