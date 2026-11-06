---
{
  "schema_version": 2,
  "id": "deckbuilding-trigger-order",
  "title": "觸發順序",
  "title_en": "Ordering effects to change the result",
  "category": "deckbuilding",
  "source_category": "deckbuilding",
  "tags": [
    "planning",
    "optimization"
  ],
  "summary": "先加再乘，或先挂弱点再攻击，把顺序本身变成决策。",
  "note_status": "draft",
  "related": [
    "deckbuilding-dice-allocation",
    "deckbuilding-duplicate-investment",
    "deckbuilding-opening-hand-control",
    "deckbuilding-reward-choice"
  ],
  "sources": [
    {
      "title": "Ordering effects to change the result — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-trigger-order/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先加再乘，或先挂弱点再攻击，把顺序本身变成决策。」
出處：`sources/text/deckbuilding-trigger-order.json` 字元 204-228 `summary.zh`
顯示：先加再乘，或先掛弱點再攻擊，把順序本身變成決策。

## 規則

「让效果按可理解的顺序逐个结算，而不是同时生效。玩家调整卡牌顺序或出牌先后，使前一步为后一步创造条件；界面应展示每次触发和当前结果，方便核对。」
出處：`sources/text/deckbuilding-trigger-order.json` 字元 363-433 `rules.zh`
顯示：讓效果按可理解的順序逐個結算，而不是同時生效。玩家調整卡牌順序或出牌先後，使前一步爲後一步創造條件；界面應展示每次觸發和當前結果，方便覈對。

## 核心循環

「查看各效果的条件」
出處：`sources/text/deckbuilding-trigger-order.json` 字元 660-668 `loop[0].zh`
顯示：查看各效果的條件

「安排先后顺序」
出處：`sources/text/deckbuilding-trigger-order.json` 字元 740-746 `loop[1].zh`
顯示：安排先後順序

「逐步观察结算」
出處：`sources/text/deckbuilding-trigger-order.json` 字元 809-815 `loop[2].zh`
顯示：逐步觀察結算

「比较并修正顺序」
出處：`sources/text/deckbuilding-trigger-order.json` 字元 880-887 `loop[3].zh`
顯示：比較並修正順序

## 玩家取捨

「先加固定数值再翻倍，还是先翻倍再加？要看它们在哪个结算阶段生效。」
出處：`sources/text/deckbuilding-trigger-order.json` 字元 970-1002 `decisions[0].zh`
顯示：先加固定數值再翻倍，還是先翻倍再加？要看它們在哪個結算階段生效。

「把能量先花在弱点上，剩下的攻击是否足以收回这笔准备成本？」
出處：`sources/text/deckbuilding-trigger-order.json` 字元 1114-1142 `decisions[1].zh`
顯示：把能量先花在弱點上，剩下的攻擊是否足以收回這筆準備成本？

## 可調參數

「顺序可编辑范围」
出處：`sources/text/deckbuilding-trigger-order.json` 字元 1302-1309 `parameters[0].name.zh`
顯示：順序可編輯範圍

「只让玩家排同一阶段的效果，较容易预测和解释。」
出處：`sources/text/deckbuilding-trigger-order.json` 字元 1385-1407 `parameters[0].effect.zh`
顯示：只讓玩家排同一階段的效果，較容易預測和解釋。

「中间结果可见度」
出處：`sources/text/deckbuilding-trigger-order.json` 字元 1550-1557 `parameters[1].name.zh`
顯示：中間結果可見度

「逐步显示计算能把试错变成理解，减少只查攻略的情况。」
出處：`sources/text/deckbuilding-trigger-order.json` 字元 1640-1665 `parameters[1].effect.zh`
顯示：逐步顯示計算能把試錯變成理解，減少只查攻略的情況。

## 原型

「做三种效果和一条可拖动结算队列，每一步显示前后数值。」
出處：`sources/text/deckbuilding-trigger-order.json` 字元 3047-3073 `prototype.firstStep.zh`
顯示：做三種效果和一條可拖動結算隊列，每一步顯示前後數值。

「玩家能在点击结算前预测两种排列的差别，并用动画验证。」
出處：`sources/text/deckbuilding-trigger-order.json` 字元 3353-3379 `prototype.test.zh`
顯示：玩家能在點擊結算前預測兩種排列的差別，並用動畫驗證。

「不要一开始就混合多套隐藏优先级；无法解释的例外会破坏学习。」
出處：`sources/text/deckbuilding-trigger-order.json` 字元 3207-3236 `prototype.pitfall.zh`
顯示：不要一開始就混合多套隱藏優先級；無法解釋的例外會破壞學習。

## 相關模式

- [骰子配給](deckbuilding-dice-allocation.md)
- [複製投入](deckbuilding-duplicate-investment.md)
- [起手牌的可控範圍](deckbuilding-opening-hand-control.md)
- [獎勵選擇](deckbuilding-reward-choice.md)

## 參考來源

- [Ordering effects to change the result — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-trigger-order/) — 查閱：2026-11-02；取得方式：page-text。
