---
{
  "schema_version": 2,
  "id": "cooking-food-preservation",
  "title": "食物保存",
  "title_en": "Preservation through processing",
  "category": "cooking",
  "source_category": "cooking",
  "tags": [
    "time",
    "economy",
    "planning"
  ],
  "summary": "花时间和设施容量，把即将过期的食物变成远征储备。",
  "note_status": "draft",
  "related": [
    "cooking-ingredient-substitution",
    "cooking-order-triage",
    "cooking-heat-window",
    "cooking-meal-loadout"
  ],
  "sources": [
    {
      "title": "Preservation through processing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooking-food-preservation/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「花时间和设施容量，把即将过期的食物变成远征储备。」
出處：`sources/text/cooking-food-preservation.json` 字元 183-207 `summary.zh`
顯示：花時間和設施容量，把即將過期的食物變成遠征儲備。

## 規則

「食物会随时间失去价值，玩家可投入盐、燃料或加工设施延长可用期。加工需要等待和空间，通常不能无限恢复材料；决定哪批先处理比无脑全部加工更关键。」
出處：`sources/text/cooking-food-preservation.json` 字元 328-398 `rules.zh`
顯示：食物會隨時間失去價值，玩家可投入鹽、燃料或加工設施延長可用期。加工需要等待和空間，通常不能無限恢復材料；決定哪批先處理比無腦全部加工更關鍵。

## 核心循環

「检查剩余保质期」
出處：`sources/text/cooking-food-preservation.json` 字元 650-657 `loop[0].zh`
顯示：檢查剩餘保質期

「分配加工资源」
出處：`sources/text/cooking-food-preservation.json` 字元 726-732 `loop[1].zh`
顯示：分配加工資源

「等待保鲜完成」
出處：`sources/text/cooking-food-preservation.json` 字元 805-811 `loop[2].zh`
顯示：等待保鮮完成

「按旅程长度分配口粮」
出處：`sources/text/cooking-food-preservation.json` 字元 876-885 `loop[3].zh`
顯示：按旅程長度分配口糧

## 玩家取捨

「先处理快坏的食物，还是更适合长期保存的高价值肉？」
出處：`sources/text/cooking-food-preservation.json` 字元 974-998 `decisions[0].zh`
顯示：先處理快壞的食物，還是更適合長期保存的高價值肉？

「现在吃掉，还是承受加工等待换取未来保障？」
出處：`sources/text/cooking-food-preservation.json` 字元 1097-1117 `decisions[1].zh`
顯示：現在喫掉，還是承受加工等待換取未來保障？

## 可調參數

「加工耗时」
出處：`sources/text/cooking-food-preservation.json` 字元 1243-1247 `parameters[0].name.zh`
顯示：加工耗時

「耗时越长越需要提前计划，也让突发收获更难处理。」
出處：`sources/text/cooking-food-preservation.json` 字元 1324-1347 `parameters[0].effect.zh`
顯示：耗時越長越需要提前計劃，也讓突發收穫更難處理。

「保鲜增益」
出處：`sources/text/cooking-food-preservation.json` 字元 1494-1498 `parameters[1].name.zh`
顯示：保鮮增益

「提升太小不值得加工；提升很大则改变玩家的远征半径。」
出處：`sources/text/cooking-food-preservation.json` 字元 1575-1600 `parameters[1].effect.zh`
顯示：提升太小不值得加工；提升很大則改變玩家的遠征半徑。

## 原型

「用每份食物的剩余天数、2个加工槽和固定加工时间做库存小原型。」
出處：`sources/text/cooking-food-preservation.json` 字元 3043-3073 `prototype.firstStep.zh`
顯示：用每份食物的剩餘天數、2個加工槽和固定加工時間做庫存小原型。

「当远行日期提前时，玩家是否重新安排先加工哪批，以及今天直接吃什么？」
出處：`sources/text/cooking-food-preservation.json` 字元 3410-3443 `prototype.test.zh`
顯示：當遠行日期提前時，玩家是否重新安排先加工哪批，以及今天直接喫什麼？

「不要把加工设计成无成本无限刷新保质期；投入与等待要影响安排。」
出處：`sources/text/cooking-food-preservation.json` 字元 3233-3263 `prototype.pitfall.zh`
顯示：不要把加工設計成無成本無限刷新保質期；投入與等待要影響安排。

## 相關模式

- [食材替換](cooking-ingredient-substitution.md)
- [限時訂單的取捨順序](cooking-order-triage.md)
- [熱度窗口](cooking-heat-window.md)
- [餐點配置組](cooking-meal-loadout.md)

## 參考來源

- [Preservation through processing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooking-food-preservation/) — 查閱：2026-11-02；取得方式：page-text。
