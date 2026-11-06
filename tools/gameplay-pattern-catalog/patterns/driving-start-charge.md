---
{
  "schema_version": 2,
  "id": "driving-start-charge",
  "title": "起步蓄力",
  "title_en": "Time the throttle during the countdown",
  "category": "driving",
  "source_category": "driving",
  "tags": [
    "timing",
    "precision",
    "dexterity"
  ],
  "summary": "比赛开始前的一次或几次油门输入，决定起步能否抢得速度。",
  "note_status": "draft",
  "related": [
    "driving-air-balance",
    "driving-air-stunt",
    "driving-drift-boost",
    "cooking-measurement-precision"
  ],
  "sources": [
    {
      "title": "Time the throttle during the countdown — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/driving-start-charge/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「比赛开始前的一次或几次油门输入，决定起步能否抢得速度。」
出處：`sources/text/driving-start-charge.json` 字元 191-218 `summary.zh`
顯示：比賽開始前的一次或幾次油門輸入，決定起步能否搶得速度。

## 規則

「倒计时提供可预测的声音或画面提示。玩家在有效窗口踩油门，积累或触发起步加速；过早、漏按或错误节奏可能失去奖励。回合从辨认提示开始，以看到起步结果并调整下一次时机结束，适合短距离反复练习。」
出處：`sources/text/driving-start-charge.json` 字元 340-433 `rules.zh`
顯示：倒計時提供可預測的聲音或畫面提示。玩家在有效窗口踩油門，積累或觸發起步加速；過早、漏按或錯誤節奏可能失去獎勵。回合從辨認提示開始，以看到起步結果並調整下一次時機結束，適合短距離反覆練習。

## 核心循環

「识别倒计时提示」
出處：`sources/text/driving-start-charge.json` 字元 759-766 `loop[0].zh`
顯示：識別倒計時提示

「在窗口内踩油门」
出處：`sources/text/driving-start-charge.json` 字元 832-839 `loop[1].zh`
顯示：在窗口內踩油門

「看起步加速或失败反馈」
出處：`sources/text/driving-start-charge.json` 字元 911-921 `loop[2].zh`
顯示：看起步加速或失敗反饋

「下一次调整输入时机」
出處：`sources/text/driving-start-charge.json` 字元 999-1008 `loop[3].zh`
顯示：下一次調整輸入時機

## 玩家取捨

「采用稳妥的宽窗口，还是追求更精确的高收益时机？」
出處：`sources/text/driving-start-charge.json` 字元 1106-1129 `decisions[0].zh`
顯示：採用穩妥的寬窗口，還是追求更精確的高收益時機？

「连按蓄力时，继续追下一次提示还是保住当前掌握的节奏？」
出處：`sources/text/driving-start-charge.json` 字元 1245-1271 `decisions[1].zh`
顯示：連按蓄力時，繼續追下一次提示還是保住當前掌握的節奏？

## 可調參數

「有效输入窗口」
出處：`sources/text/driving-start-charge.json` 字元 1445-1451 `parameters[0].name.zh`
顯示：有效輸入窗口

「宽窗口易上手；窄窗口需要更清楚的声音、动画和失败原因。」
出處：`sources/text/driving-start-charge.json` 字元 1531-1558 `parameters[0].effect.zh`
顯示：寬窗口易上手；窄窗口需要更清楚的聲音、動畫和失敗原因。

「失败损失」
出處：`sources/text/driving-start-charge.json` 字元 1718-1722 `parameters[1].name.zh`
顯示：失敗損失

「只失去奖励适合学习；额外起步迟滞会让抢按风险更大。」
出處：`sources/text/driving-start-charge.json` 字元 1796-1821 `parameters[1].effect.zh`
顯示：只失去獎勵適合學習；額外起步遲滯會讓搶按風險更大。

## 原型

「做倒计时、一个按钮和三秒直线冲刺，并在每次结束后显示早晚偏差。」
出處：`sources/text/driving-start-charge.json` 字元 3326-3357 `prototype.firstStep.zh`
顯示：做倒計時、一個按鈕和三秒直線衝刺，並在每次結束後顯示早晚偏差。

「只看反馈，玩家是否能稳定地把下一次输入往正确方向调整？」
出處：`sources/text/driving-start-charge.json` 字元 3676-3703 `prototype.test.zh`
顯示：只看反饋，玩家是否能穩定地把下一次輸入往正確方向調整？

「先处理输入延迟与提示同步，避免玩家被设备差异误导。」
出處：`sources/text/driving-start-charge.json` 字元 3520-3545 `prototype.pitfall.zh`
顯示：先處理輸入延遲與提示同步，避免玩家被設備差異誤導。

## 相關模式

- [空中平衡](driving-air-balance.md)
- [空中特技](driving-air-stunt.md)
- [漂移加速](driving-drift-boost.md)
- [計量精度](cooking-measurement-precision.md)

## 參考來源

- [Time the throttle during the countdown — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/driving-start-charge/) — 查閱：2026-11-02；取得方式：page-text。
