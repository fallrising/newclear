---
{
  "schema_version": 2,
  "id": "incremental-farm-or-push",
  "title": "經營推進",
  "title_en": "Farm reliably or push ahead",
  "category": "incremental",
  "source_category": "incremental",
  "tags": [
    "economy",
    "risk",
    "progression"
  ],
  "summary": "下一关更诱人，但当前目标可能更适合积累下一次突破的资源。",
  "note_status": "draft",
  "related": [
    "allocation-savings-interest",
    "incremental-manual-to-passive",
    "incremental-quantity-milestones",
    "incremental-escalating-copy-price"
  ],
  "sources": [
    {
      "title": "Farm reliably or push ahead — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/incremental-farm-or-push/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「下一关更诱人，但当前目标可能更适合积累下一次突破的资源。」
出處：`sources/text/incremental-farm-or-push.json` 字元 189-217 `summary.zh`
顯示：下一關更誘人，但當前目標可能更適合積累下一次突破的資源。

## 規則

「玩家可以重复处理已经能稳定完成的目标来积累资源，也可以尝试更高门槛的新目标。推进可能解锁更好收益，但耗时、失败或补给消耗会拖慢积累。玩家根据实际表现退回刷取、升级，再次尝试突破。」
出處：`sources/text/incremental-farm-or-push.json` 字元 350-439 `rules.zh`
顯示：玩家可以重複處理已經能穩定完成的目標來積累資源，也可以嘗試更高門檻的新目標。推進可能解鎖更好收益，但耗時、失敗或補給消耗會拖慢積累。玩家根據實際表現退回刷取、升級，再次嘗試突破。

## 核心循環

「估计新目标的门槛」
出處：`sources/text/incremental-farm-or-push.json` 字元 740-748 `loop[0].zh`
顯示：估計新目標的門檻

「选择刷取或挑战」
出處：`sources/text/incremental-farm-or-push.json` 字元 830-837 `loop[1].zh`
顯示：選擇刷取或挑戰

「观察单位时间收益与损耗」
出處：`sources/text/incremental-farm-or-push.json` 字元 910-921 `loop[2].zh`
顯示：觀察單位時間收益與損耗

「升级后重新判断能否推进」
出處：`sources/text/incremental-farm-or-push.json` 字元 998-1009 `loop[3].zh`
顯示：升級後重新判斷能否推進

## 玩家取捨

「能勉强打赢的新敌人，收益是否真的高过快速重复旧敌人？」
出處：`sources/text/incremental-farm-or-push.json` 字元 1106-1132 `decisions[0].zh`
顯示：能勉強打贏的新敵人，收益是否真的高過快速重複舊敵人？

「为了新掉落接受低效率，还是先积累稳定提升再来？」
出處：`sources/text/incremental-farm-or-push.json` 字元 1261-1284 `decisions[1].zh`
顯示：爲了新掉落接受低效率，還是先積累穩定提升再來？

## 可調參數

「失败成本」
出處：`sources/text/incremental-farm-or-push.json` 字元 1440-1444 `parameters[0].name.zh`
顯示：失敗成本

「只损失时间便于试探；再损失补给或装备会让准备更重要。」
出處：`sources/text/incremental-farm-or-push.json` 字元 1518-1544 `parameters[0].effect.zh`
顯示：只損失時間便於試探；再損失補給或裝備會讓準備更重要。

「收益可读性」
出處：`sources/text/incremental-farm-or-push.json` 字元 1715-1720 `parameters[1].name.zh`
顯示：收益可讀性

「同时显示完成时间、掉落和消耗，帮助玩家理解“更难”不一定“更划算”。」
出處：`sources/text/incremental-farm-or-push.json` 字元 1798-1832 `parameters[1].effect.zh`
顯示：同時顯示完成時間、掉落和消耗，幫助玩家理解“更難”不一定“更划算”。

## 原型

「做两个目标、一个自动处理计时器和一项影响速度的升级。」
出處：`sources/text/incremental-farm-or-push.json` 字元 3399-3425 `prototype.firstStep.zh`
顯示：做兩個目標、一個自動處理計時器和一項影響速度的升級。

「玩家失败后是否知道该回哪里积累什么，再回来验证？」
出處：`sources/text/incremental-farm-or-push.json` 字元 3739-3763 `prototype.test.zh`
顯示：玩家失敗後是否知道該回哪裏積累什麼，再回來驗證？

「不要只显示敌人等级；让玩家看到用时与净收益，避免无法判断为什么停滞。」
出處：`sources/text/incremental-farm-or-push.json` 字元 3564-3598 `prototype.pitfall.zh`
顯示：不要只顯示敵人等級；讓玩家看到用時與淨收益，避免無法判斷爲什麼停滯。

## 相關模式

- [存款利息](allocation-savings-interest.md)
- [手動被動](incremental-manual-to-passive.md)
- [數量門檻獎](incremental-quantity-milestones.md)
- [複本愈多愈貴](incremental-escalating-copy-price.md)

## 參考來源

- [Farm reliably or push ahead — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/incremental-farm-or-push/) — 查閱：2026-11-02；取得方式：page-text。
