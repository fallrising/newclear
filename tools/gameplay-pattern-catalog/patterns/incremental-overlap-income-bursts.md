---
{
  "schema_version": 2,
  "id": "incremental-overlap-income-bursts",
  "title": "重疊收入爆發段",
  "title_en": "Overlap temporary income boosts",
  "category": "incremental",
  "source_category": "incremental",
  "tags": [
    "timing",
    "economy",
    "planning"
  ],
  "summary": "两个加成一起生效的短时间，可能比各自开满更值钱。",
  "note_status": "draft",
  "related": [
    "incremental-escalating-copy-price",
    "incremental-offline-window",
    "incremental-quantity-milestones",
    "incremental-spend-held-bonus"
  ],
  "sources": [
    {
      "title": "Overlap temporary income boosts — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/incremental-overlap-income-bursts/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「两个加成一起生效的短时间，可能比各自开满更值钱。」
出處：`sources/text/incremental-overlap-income-bursts.json` 字元 203-227 `summary.zh`
顯示：兩個加成一起生效的短時間，可能比各自開滿更值錢。

## 規則

「玩家拥有持续时间有限的增产效果，有些可主动触发，有些来自随机机会。不同加成同时存在时，收益规则可能相乘或放大特定动作。玩家在等待重叠与立刻兑现之间取舍，并在窗口结束后重新积累触发条件。」
出處：`sources/text/incremental-overlap-income-bursts.json` 字元 347-439 `rules.zh`
顯示：玩家擁有持續時間有限的增產效果，有些可主動觸發，有些來自隨機機會。不同加成同時存在時，收益規則可能相乘或放大特定動作。玩家在等待重疊與立刻兌現之間取捨，並在窗口結束後重新積累觸發條件。

## 核心循環

「观察已有加成与剩余时间」
出處：`sources/text/incremental-overlap-income-bursts.json` 字元 770-781 `loop[0].zh`
顯示：觀察已有加成與剩餘時間

「准备另一种可兼容加成」
出處：`sources/text/incremental-overlap-income-bursts.json` 字元 865-875 `loop[1].zh`
顯示：準備另一種可兼容加成

「在重叠窗口集中操作」
出處：`sources/text/incremental-overlap-income-bursts.json` 字元 953-962 `loop[2].zh`
顯示：在重疊窗口集中操作

「结算后准备下一次窗口」
出處：`sources/text/incremental-overlap-income-bursts.json` 字元 1044-1054 `loop[3].zh`
顯示：結算後準備下一次窗口

## 玩家取捨

「现在使用技能拿确定收益，还是等一个可能错过的搭配机会？」
出處：`sources/text/incremental-overlap-income-bursts.json` 字元 1151-1178 `decisions[0].zh`
顯示：現在使用技能拿確定收益，還是等一個可能錯過的搭配機會？

「窗口很短时，是继续配置，还是立即执行能吃到倍率的动作？」
出處：`sources/text/incremental-overlap-income-bursts.json` 字元 1292-1319 `decisions[1].zh`
顯示：窗口很短時，是繼續配置，還是立即執行能喫到倍率的動作？

## 可調參數

「加成叠加规则」
出處：`sources/text/incremental-overlap-income-bursts.json` 字元 1482-1488 `parameters[0].name.zh`
顯示：加成疊加規則

「相乘会放大时机价值；相加更平缓；互斥关系要明确提示。」
出處：`sources/text/incremental-overlap-income-bursts.json` 字元 1563-1589 `parameters[0].effect.zh`
顯示：相乘會放大時機價值；相加更平緩；互斥關係要明確提示。

「重叠窗口长度」
出處：`sources/text/incremental-overlap-income-bursts.json` 字元 1760-1766 `parameters[1].name.zh`
顯示：重疊窗口長度

「窗口短强调准备和执行，窗口长更侧重资源配置。」
出處：`sources/text/incremental-overlap-income-bursts.json` 字元 1844-1866 `parameters[1].effect.zh`
顯示：窗口短強調準備和執行，窗口長更側重資源配置。

## 原型

「做两个定时加成和一个产出按钮，把同时生效的计算过程显示出来。」
出處：`sources/text/incremental-overlap-income-bursts.json` 字元 3425-3455 `prototype.firstStep.zh`
顯示：做兩個定時加成和一個產出按鈕，把同時生效的計算過程顯示出來。

「玩家是否会主动等待一个可解释的重叠机会，而不是看到亮起就按？」
出處：`sources/text/incremental-overlap-income-bursts.json` 字元 3749-3779 `prototype.test.zh`
顯示：玩家是否會主動等待一個可解釋的重疊機會，而不是看到亮起就按？

「别让玩家必须靠外部计算器才知道哪些效果互斥。」
出處：`sources/text/incremental-overlap-income-bursts.json` 字元 3604-3626 `prototype.pitfall.zh`
顯示：別讓玩家必須靠外部計算器才知道哪些效果互斥。

## 相關模式

- [複本愈多愈貴](incremental-escalating-copy-price.md)
- [離線窗口](incremental-offline-window.md)
- [數量門檻獎](incremental-quantity-milestones.md)
- [花費持有加成](incremental-spend-held-bonus.md)

## 參考來源

- [Overlap temporary income boosts — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/incremental-overlap-income-bursts/) — 查閱：2026-11-02；取得方式：page-text。
