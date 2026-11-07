---
{
  "schema_version": 2,
  "id": "inventory-death-retrieval",
  "title": "死亡取回",
  "title_en": "Recovering resources after death",
  "category": "inventory",
  "source_category": "inventory",
  "tags": [
    "risk",
    "planning",
    "economy"
  ],
  "summary": "一次失败会生成一个必须重新规划的取回任务。",
  "note_status": "draft",
  "related": [
    "inventory-weight-budget",
    "commerce-regional-arbitrage",
    "inventory-durability",
    "inventory-light-reserve"
  ],
  "sources": [
    {
      "title": "Recovering resources after death — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/inventory-death-retrieval/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「一次失败会生成一个必须重新规划的取回任务。」
出處：`sources/text/inventory-death-retrieval.json` 字元 190-211 `summary.zh`
顯示：一次失敗會生成一個必須重新規劃的取回任務。

## 規則

「死亡把部分资源留在危险地点，玩家复活后可以重新准备再去取回。取回收益必须与路途危险比较；地图标记、遗物或敌对残影明确提示损失仍有恢复可能。」
出處：`sources/text/inventory-death-retrieval.json` 字元 305-374 `rules.zh`
顯示：死亡把部分資源留在危險地點，玩家復活後可以重新準備再去取回。取回收益必須與路途危險比較；地圖標記、遺物或敵對殘影明確提示損失仍有恢復可能。

## 核心循環

「死亡并留下资源」
出處：`sources/text/inventory-death-retrieval.json` 字元 625-632 `loop[0].zh`
顯示：死亡並留下資源

「准备回收路线」
出處：`sources/text/inventory-death-retrieval.json` 字元 699-705 `loop[1].zh`
顯示：準備回收路線

「穿越危险取回」
出處：`sources/text/inventory-death-retrieval.json` 字元 776-782 `loop[2].zh`
顯示：穿越危險取回

「撤离或继续原任务」
出處：`sources/text/inventory-death-retrieval.json` 字元 847-855 `loop[3].zh`
顯示：撤離或繼續原任務

## 玩家取捨

「裸身速跑取回，还是先花时间制造备用装备？」
出處：`sources/text/inventory-death-retrieval.json` 字元 950-970 `decisions[0].zh`
顯示：裸身速跑取回，還是先花時間製造備用裝備？

「损失很小时是否放弃回收，避免把小失误变成连锁失败？」
出處：`sources/text/inventory-death-retrieval.json` 字元 1077-1102 `decisions[1].zh`
顯示：損失很小時是否放棄回收，避免把小失誤變成連鎖失敗？

## 可調參數

「重复死亡规则」
出處：`sources/text/inventory-death-retrieval.json` 字元 1252-1258 `parameters[0].name.zh`
顯示：重複死亡規則

「旧资源保留减轻焦虑；覆盖旧资源强化单次回收压力。」
出處：`sources/text/inventory-death-retrieval.json` 字元 1339-1363 `parameters[0].effect.zh`
顯示：舊資源保留減輕焦慮；覆蓋舊資源強化單次回收壓力。

「回收地点安全性」
出處：`sources/text/inventory-death-retrieval.json` 字元 1514-1521 `parameters[1].name.zh`
顯示：回收地點安全性

「资源略偏离死点可避免必死循环；原地回收更残酷。」
出處：`sources/text/inventory-death-retrieval.json` 字元 1598-1621 `parameters[1].effect.zh`
顯示：資源略偏離死點可避免必死循環；原地回收更殘酷。

## 原型

「做一个可重复进入的小关卡、死亡掉落包与明确回收标记。」
出處：`sources/text/inventory-death-retrieval.json` 字元 3102-3128 `prototype.firstStep.zh`
顯示：做一個可重複進入的小關卡、死亡掉落包與明確回收標記。

「用高价值与低价值掉落各测试一次，观察玩家是否会合理选择放弃回收。」
出處：`sources/text/inventory-death-retrieval.json` 字元 3431-3463 `prototype.test.zh`
顯示：用高價值與低價值掉落各測試一次，觀察玩家是否會合理選擇放棄回收。

「别让连续失败无限堆叠惩罚；先定义再次死亡时旧掉落如何处理。」
出處：`sources/text/inventory-death-retrieval.json` 字元 3263-3292 `prototype.pitfall.zh`
顯示：別讓連續失敗無限堆疊懲罰；先定義再次死亡時舊掉落如何處理。

## 相關模式

- [重量預算](inventory-weight-budget.md)
- [區域價差](commerce-regional-arbitrage.md)
- [工具耐久與維護決策](inventory-durability.md)
- [消耗型光源的存量](inventory-light-reserve.md)

## 參考來源

- [Recovering resources after death — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/inventory-death-retrieval/) — 查閱：2026-11-02；取得方式：page-text。
