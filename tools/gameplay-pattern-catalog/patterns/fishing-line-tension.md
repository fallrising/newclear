---
{
  "schema_version": 2,
  "id": "fishing-line-tension",
  "title": "收線張力的持續控制",
  "title_en": "Line tension control",
  "category": "fishing",
  "source_category": "fishing",
  "tags": [
    "risk",
    "timing",
    "precision"
  ],
  "summary": "在鱼挣扎时松手，在停顿时回收距离。",
  "note_status": "draft",
  "related": [
    "combat-timed-parry",
    "fishing-bite-window",
    "fishing-target-tracking",
    "combat-posture-break"
  ],
  "sources": [
    {
      "title": "Line tension control — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/fishing-line-tension/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「在鱼挣扎时松手，在停顿时回收距离。」
出處：`sources/text/fishing-line-tension.json` 字元 170-187 `summary.zh`
顯示：在魚掙扎時鬆手，在停頓時回收距離。

## 規則

「玩家交替收线和放松，以缩短鱼与岸边的距离，同时避免鱼线张力超过上限。持续猛拉可能断线，放手过久则丢失进度；距离与张力反馈让风险始终可读。」
出處：`sources/text/fishing-line-tension.json` 字元 281-349 `rules.zh`
顯示：玩家交替收線和放鬆，以縮短魚與岸邊的距離，同時避免魚線張力超過上限。持續猛拉可能斷線，放手過久則丟失進度；距離與張力反饋讓風險始終可讀。

## 核心循環

「观察鱼是否挣扎」
出處：`sources/text/fishing-line-tension.json` 字元 610-617 `loop[0].zh`
顯示：觀察魚是否掙扎

「平静时收线」
出處：`sources/text/fishing-line-tension.json` 字元 676-681 `loop[1].zh`
顯示：平靜時收線

「张力升高时松开」
出處：`sources/text/fishing-line-tension.json` 字元 744-751 `loop[2].zh`
顯示：張力升高時鬆開

「重复直到拉近鱼」
出處：`sources/text/fishing-line-tension.json` 字元 819-826 `loop[3].zh`
顯示：重複直到拉近魚

## 玩家取捨

「再多收一点能更快拉近鱼，但是否还有余量承受下一次突然挣扎？」
出處：`sources/text/fishing-line-tension.json` 字元 924-953 `decisions[0].zh`
顯示：再多收一點能更快拉近魚，但是否還有餘量承受下一次突然掙扎？

「鱼刚平静下来，是立刻收线追进度，还是继续松手把张力降得更低？」
出處：`sources/text/fishing-line-tension.json` 字元 1085-1115 `decisions[1].zh`
顯示：魚剛平靜下來，是立刻收線追進度，還是繼續鬆手把張力降得更低？

## 可調參數

「张力恢复速度」
出處：`sources/text/fishing-line-tension.json` 字元 1290-1296 `parameters[0].name.zh`
顯示：張力恢復速度

「恢复快允许短促冲刺，恢复慢要求更保守节奏。」
出處：`sources/text/fishing-line-tension.json` 字元 1374-1395 `parameters[0].effect.zh`
顯示：恢復快允許短促衝刺，恢復慢要求更保守節奏。

「挣扎规律」
出處：`sources/text/fishing-line-tension.json` 字元 1530-1534 `parameters[1].name.zh`
顯示：掙扎規律

「固定节奏可学习，随机变化则强调读反馈。」
出處：`sources/text/fishing-line-tension.json` 字元 1614-1633 `parameters[1].effect.zh`
顯示：固定節奏可學習，隨機變化則強調讀反饋。

## 原型

「用距离与张力两条数值、鱼的平静／挣扎两态和收线按钮即可验证。」
出處：`sources/text/fishing-line-tension.json` 字元 3096-3126 `prototype.firstStep.zh`
顯示：用距離與張力兩條數值、魚的平靜／掙扎兩態和收線按鈕即可驗證。

「检查玩家是否主动在危险前松手，以及更熟悉鱼后能否更快完成捕获。」
出處：`sources/text/fishing-line-tension.json` 字元 3456-3487 `prototype.test.zh`
顯示：檢查玩家是否主動在危險前鬆手，以及更熟悉魚後能否更快完成捕獲。

「若张力变化全靠随机且没有预兆，松手会变成猜测；先做清楚的行为反馈。」
出處：`sources/text/fishing-line-tension.json` 字元 3262-3295 `prototype.pitfall.zh`
顯示：若張力變化全靠隨機且沒有預兆，鬆手會變成猜測；先做清楚的行爲反饋。

## 相關模式

- [限時招架](combat-timed-parry.md)
- [訊號辨識與反應窗口](fishing-bite-window.md)
- [目標追蹤](fishing-target-tracking.md)
- [架勢崩解](combat-posture-break.md)

## 參考來源

- [Line tension control — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/fishing-line-tension/) — 查閱：2026-11-02；取得方式：page-text。
