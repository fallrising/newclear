---
{
  "schema_version": 2,
  "id": "incremental-escalating-copy-price",
  "title": "複本愈多愈貴",
  "title_en": "Each additional copy costs more",
  "category": "incremental",
  "source_category": "incremental",
  "tags": [
    "economy",
    "optimization",
    "planning"
  ],
  "summary": "旧选择的价格会改变，逼着玩家反复比较下一笔投资。",
  "note_status": "draft",
  "related": [
    "incremental-spend-held-bonus",
    "commerce-trade-route-programming",
    "incremental-allocate-progress-capacity",
    "incremental-offline-window"
  ],
  "sources": [
    {
      "title": "Each additional copy costs more — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/incremental-escalating-copy-price/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「旧选择的价格会改变，逼着玩家反复比较下一笔投资。」
出處：`sources/text/incremental-escalating-copy-price.json` 字元 204-228 `summary.zh`
顯示：舊選擇的價格會改變，逼着玩家反覆比較下一筆投資。

## 規則

「同一种产出单位每买一份，下一份价格就提高，而单份基础收益可以保持不变。玩家比较“增加多少收益、要等多久回本”，在多种单位间切换。这里的取舍来自连续涨价，不依赖跨门槛奖励。」
出處：`sources/text/incremental-escalating-copy-price.json` 字元 361-446 `rules.zh`
顯示：同一種產出單位每買一份，下一份價格就提高，而單份基礎收益可以保持不變。玩家比較“增加多少收益、要等多久回本”，在多種單位間切換。這裏的取捨來自連續漲價，不依賴跨門檻獎勵。

## 核心循環

「查看下一份的实际价格」
出處：`sources/text/incremental-escalating-copy-price.json` 字元 752-762 `loop[0].zh`
顯示：查看下一份的實際價格

「比较新增收益与回本时间」
出處：`sources/text/incremental-escalating-copy-price.json` 字元 833-844 `loop[1].zh`
顯示：比較新增收益與回本時間

「购买或攒钱换一种」
出處：`sources/text/incremental-escalating-copy-price.json` 字元 920-928 `loop[2].zh`
顯示：購買或攢錢換一種

「价格上涨后重新比较」
出處：`sources/text/incremental-escalating-copy-price.json` 字元 1000-1009 `loop[3].zh`
顯示：價格上漲後重新比較

## 玩家取捨

「继续买熟悉的低价单位，还是等到能买更贵但回报更高的新单位？」
出處：`sources/text/incremental-escalating-copy-price.json` 字元 1105-1134 `decisions[0].zh`
顯示：繼續買熟悉的低價單位，還是等到能買更貴但回報更高的新單位？

「一次买很多是否省事，但也错过了中途应该换投资对象的时点？」
出處：`sources/text/incremental-escalating-copy-price.json` 字元 1263-1291 `decisions[1].zh`
顯示：一次買很多是否省事，但也錯過了中途應該換投資對象的時點？

## 可調參數

「每次涨价幅度」
出處：`sources/text/incremental-escalating-copy-price.json` 字元 1464-1470 `parameters[0].name.zh`
顯示：每次漲價幅度

「涨价快会更早推动换线；涨价慢让同一选择维持更久。」
出處：`sources/text/incremental-escalating-copy-price.json` 字元 1553-1577 `parameters[0].effect.zh`
顯示：漲價快會更早推動換線；漲價慢讓同一選擇維持更久。

「收益展示方式」
出處：`sources/text/incremental-escalating-copy-price.json` 字元 1738-1744 `parameters[1].name.zh`

「同时显示新增产量和下一份价格，比只显示总产量更能支持比较。」
出處：`sources/text/incremental-escalating-copy-price.json` 字元 1820-1849 `parameters[1].effect.zh`
顯示：同時顯示新增產量和下一份價格，比只顯示總產量更能支持比較。

## 原型

「用两种单位、一种货币和可见的递增价格，展示下一份而非历史均价。」
出處：`sources/text/incremental-escalating-copy-price.json` 字元 3386-3417 `prototype.firstStep.zh`
顯示：用兩種單位、一種貨幣和可見的遞增價格，展示下一份而非歷史均價。

「玩家能否发现最优的下一笔购买会随已有数量改变？」
出處：`sources/text/incremental-escalating-copy-price.json` 字元 3720-3743 `prototype.test.zh`
顯示：玩家能否發現最優的下一筆購買會隨已有數量改變？

「避免大数直接溢出或四舍五入后显示相同价格，令决策失真。」
出處：`sources/text/incremental-escalating-copy-price.json` 字元 3568-3595 `prototype.pitfall.zh`
顯示：避免大數直接溢出或四捨五入後顯示相同價格，令決策失真。

## 相關模式

- [花費持有加成](incremental-spend-held-bonus.md)
- [貿易路線編排](commerce-trade-route-programming.md)
- [分配進度容量](incremental-allocate-progress-capacity.md)
- [離線窗口](incremental-offline-window.md)

## 參考來源

- [Each additional copy costs more — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/incremental-escalating-copy-price/) — 查閱：2026-11-02；取得方式：page-text。
