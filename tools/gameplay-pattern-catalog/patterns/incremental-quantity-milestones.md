---
{
  "schema_version": 2,
  "id": "incremental-quantity-milestones",
  "title": "數量門檻獎",
  "title_en": "Reach a quantity threshold for a production jump",
  "category": "incremental",
  "source_category": "incremental",
  "tags": [
    "progression",
    "economy",
    "planning"
  ],
  "summary": "临近门槛的最后几次投入，可能比平时更有价值。",
  "note_status": "draft",
  "related": [
    "incremental-escalating-copy-price",
    "incremental-farm-or-push",
    "incremental-manual-to-passive",
    "incremental-offline-window"
  ],
  "sources": [
    {
      "title": "Reach a quantity threshold for a production jump — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/incremental-quantity-milestones/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「临近门槛的最后几次投入，可能比平时更有价值。」
出處：`sources/text/incremental-quantity-milestones.json` 字元 219-241 `summary.zh`
顯示：臨近門檻的最後幾次投入，可能比平時更有價值。

## 規則

「购买或升级会增加数量，达到公开门槛时额外解锁速度或产量奖励。门槛之间的增幅较平缓，跨过门槛会出现一次跃升。玩家因此会比较离门槛的距离，而不只是比较当前单次购买回报。」
出處：`sources/text/incremental-quantity-milestones.json` 字元 362-444 `rules.zh`
顯示：購買或升級會增加數量，達到公開門檻時額外解鎖速度或產量獎勵。門檻之間的增幅較平緩，跨過門檻會出現一次躍升。玩家因此會比較離門檻的距離，而不只是比較當前單次購買回報。

## 核心循環

「查看每项距离下一门槛多远」
出處：`sources/text/incremental-quantity-milestones.json` 字元 752-764 `loop[0].zh`
顯示：查看每項距離下一門檻多遠

「计算凑齐还需投入多少」
出處：`sources/text/incremental-quantity-milestones.json` 字元 840-850 `loop[1].zh`
顯示：計算湊齊還需投入多少

「集中补齐或分散投资」
出處：`sources/text/incremental-quantity-milestones.json` 字元 923-932 `loop[2].zh`
顯示：集中補齊或分散投資

「获得跃升后重排优先级」
出處：`sources/text/incremental-quantity-milestones.json` 字元 1013-1023 `loop[3].zh`
顯示：獲得躍升後重排優先級

## 玩家取捨

「把钱投给当前效率最高的一项，还是补齐差一点就翻倍的另一项？」
出處：`sources/text/incremental-quantity-milestones.json` 字元 1115-1144 `decisions[0].zh`
顯示：把錢投給當前效率最高的一項，還是補齊差一點就翻倍的另一項？

「为了全体达标奖励，是否值得补齐最弱的一项？」
出處：`sources/text/incremental-quantity-milestones.json` 字元 1271-1292 `decisions[1].zh`
顯示：爲了全體達標獎勵，是否值得補齊最弱的一項？

## 可調參數

「门槛间距」
出處：`sources/text/incremental-quantity-milestones.json` 字元 1455-1459 `parameters[0].name.zh`
顯示：門檻間距

「间隔短形成频繁小目标；间隔长需要更明显的进度和下一次收益预告。」
出處：`sources/text/incremental-quantity-milestones.json` 字元 1538-1569 `parameters[0].effect.zh`
顯示：間隔短形成頻繁小目標；間隔長需要更明顯的進度和下一次收益預告。

「局部与全局奖励」
出處：`sources/text/incremental-quantity-milestones.json` 字元 1735-1742 `parameters[1].name.zh`
顯示：局部與全局獎勵

「只奖励该项鼓励集中；全体达标奖励会拉动落后的项目。」
出處：`sources/text/incremental-quantity-milestones.json` 字元 1830-1855 `parameters[1].effect.zh`
顯示：只獎勵該項鼓勵集中；全體達標獎勵會拉動落後的項目。

## 原型

「做两类生产器，每类一个数量门槛，购买按钮显示距奖励还差几次。」
出處：`sources/text/incremental-quantity-milestones.json` 字元 3340-3370 `prototype.firstStep.zh`
顯示：做兩類生產器，每類一個數量門檻，購買按鈕顯示距獎勵還差幾次。

「接近不同门槛时，玩家是否改变购买对象？」
出處：`sources/text/incremental-quantity-milestones.json` 字元 3674-3693 `prototype.test.zh`
顯示：接近不同門檻時，玩家是否改變購買對象？

「阈值奖励不能藏在长列表里，否则只剩盲目点购买。」
出處：`sources/text/incremental-quantity-milestones.json` 字元 3520-3543 `prototype.pitfall.zh`
顯示：閾值獎勵不能藏在長列表裏，否則只剩盲目點購買。

## 相關模式

- [複本愈多愈貴](incremental-escalating-copy-price.md)
- [經營推進](incremental-farm-or-push.md)
- [手動被動](incremental-manual-to-passive.md)
- [離線窗口](incremental-offline-window.md)

## 參考來源

- [Reach a quantity threshold for a production jump — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/incremental-quantity-milestones/) — 查閱：2026-11-02；取得方式：page-text。
