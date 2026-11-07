---
{
  "schema_version": 2,
  "id": "incremental-manual-to-passive",
  "title": "手動被動",
  "title_en": "Earn by hand, then buy passive output",
  "category": "incremental",
  "source_category": "incremental",
  "tags": [
    "economy",
    "progression",
    "time"
  ],
  "summary": "把第一笔劳动换成持续收入，重新决定时间该花在哪里。",
  "note_status": "draft",
  "related": [
    "incremental-farm-or-push",
    "incremental-offline-window",
    "incremental-quantity-milestones",
    "incremental-spend-time-advance"
  ],
  "sources": [
    {
      "title": "Earn by hand, then buy passive output — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/incremental-manual-to-passive/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把第一笔劳动换成持续收入，重新决定时间该花在哪里。」
出處：`sources/text/incremental-manual-to-passive.json` 字元 204-229 `summary.zh`
顯示：把第一筆勞動換成持續收入，重新決定時間該花在哪裏。

## 規則

「玩家先用点击等直接动作取得资源，再花资源买持续产出的单位。自动收入开始后，手动操作仍可补充收益；玩家在继续操作、购买更多产出和攒钱买下一项之间循环取舍。这里关注手动与自动收入的交接，不涉及复杂生产线。」
出處：`sources/text/incremental-manual-to-passive.json` 字元 372-472 `rules.zh`
顯示：玩家先用點擊等直接動作取得資源，再花資源買持續產出的單位。自動收入開始後，手動操作仍可補充收益；玩家在繼續操作、購買更多產出和攢錢買下一項之間循環取捨。這裏關注手動與自動收入的交接，不涉及複雜生產線。

## 核心循環

「亲手取得启动资源」
出處：`sources/text/incremental-manual-to-passive.json` 字元 826-834 `loop[0].zh`
顯示：親手取得啓動資源

「买下第一份自动产出」
出處：`sources/text/incremental-manual-to-passive.json` 字元 904-913 `loop[1].zh`
顯示：買下第一份自動產出

「观察收入与等待时间」
出處：`sources/text/incremental-manual-to-passive.json` 字元 987-996 `loop[2].zh`
顯示：觀察收入與等待時間

「决定补点收入还是继续投资」
出處：`sources/text/incremental-manual-to-passive.json` 字元 1071-1083 `loop[3].zh`
顯示：決定補點收入還是繼續投資

## 玩家取捨

「现在买便宜的自动产出，还是再操作一会儿买更有效率的一项？」
出處：`sources/text/incremental-manual-to-passive.json` 字元 1175-1203 `decisions[0].zh`
顯示：現在買便宜的自動產出，還是再操作一會兒買更有效率的一項？

「自动收入足够后，继续操作带来的额外收益还值得注意力吗？」
出處：`sources/text/incremental-manual-to-passive.json` 字元 1328-1355 `decisions[1].zh`
顯示：自動收入足夠後，繼續操作帶來的額外收益還值得注意力嗎？

## 可調參數

「自动收入回本时间」
出處：`sources/text/incremental-manual-to-passive.json` 字元 1511-1519 `parameters[0].name.zh`
顯示：自動收入回本時間

「回本短会很快把重心移到投资；回本长让手动操作保留更久的作用。」
出處：`sources/text/incremental-manual-to-passive.json` 字元 1602-1632 `parameters[0].effect.zh`
顯示：回本短會很快把重心移到投資；回本長讓手動操作保留更久的作用。

「手动收益随成长变化」
出處：`sources/text/incremental-manual-to-passive.json` 字元 1802-1811 `parameters[1].name.zh`
顯示：手動收益隨成長變化

「手动收益完全不增长会迅速失去意义；同步增长则保留随时介入的理由。」
出處：`sources/text/incremental-manual-to-passive.json` 字元 1887-1919 `parameters[1].effect.zh`
顯示：手動收益完全不增長會迅速失去意義；同步增長則保留隨時介入的理由。

## 原型

「做一个手动按钮、一种货币和一个可购买的自动计时器。」
出處：`sources/text/incremental-manual-to-passive.json` 字元 3460-3485 `prototype.firstStep.zh`
顯示：做一個手動按鈕、一種貨幣和一個可購買的自動計時器。

「玩家买到自动产出后，是否会主动改变操作频率？」
出處：`sources/text/incremental-manual-to-passive.json` 字元 3786-3808 `prototype.test.zh`
顯示：玩家買到自動產出後，是否會主動改變操作頻率？

「不要先堆几十种升级，先让玩家看懂手动收益与每秒收益的区别。」
出處：`sources/text/incremental-manual-to-passive.json` 字元 3611-3640 `prototype.pitfall.zh`
顯示：不要先堆幾十種升級，先讓玩家看懂手動收益與每秒收益的區別。

## 相關模式

- [經營推進](incremental-farm-or-push.md)
- [離線窗口](incremental-offline-window.md)
- [數量門檻獎](incremental-quantity-milestones.md)
- [花費時間提前結算](incremental-spend-time-advance.md)

## 參考來源

- [Earn by hand, then buy passive output — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/incremental-manual-to-passive/) — 查閱：2026-11-02；取得方式：page-text。
