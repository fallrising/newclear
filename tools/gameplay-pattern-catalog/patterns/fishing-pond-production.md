---
{
  "schema_version": 2,
  "id": "fishing-pond-production",
  "title": "魚池產線",
  "title_en": "Fish-pond production",
  "category": "fishing",
  "source_category": "fishing",
  "tags": [
    "economy",
    "progression",
    "planning"
  ],
  "summary": "把一次成功捕获，转化为持续繁育的生产起点。",
  "note_status": "draft",
  "related": [
    "farming-livestock-care",
    "farming-seed-reinvestment",
    "fishing-bait-loadout",
    "fishing-equipment-access"
  ],
  "sources": [
    {
      "title": "Fish-pond production — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/fishing-pond-production/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把一次成功捕获，转化为持续繁育的生产起点。」
出處：`sources/text/fishing-pond-production.json` 字元 170-191 `summary.zh`
顯示：把一次成功捕獲，轉化爲持續繁育的生產起點。

## 規則

「玩家把捕获的鱼放入鱼塘，等待繁殖或收集鱼卵，再决定提取多少存量。鱼塘空间有限，保留繁殖基础与立即出售之间存在取舍；不同鱼种改变产出价值。」
出處：`sources/text/fishing-pond-production.json` 字元 315-383 `rules.zh`
顯示：玩家把捕獲的魚放入魚塘，等待繁殖或收集魚卵，再決定提取多少存量。魚塘空間有限，保留繁殖基礎與立即出售之間存在取捨；不同魚種改變產出價值。

## 核心循環

「捕获并选择种鱼」
出處：`sources/text/fishing-pond-production.json` 字元 661-668 `loop[0].zh`
顯示：捕獲並選擇種魚

「建塘并放入鱼」
出處：`sources/text/fishing-pond-production.json` 字元 734-740 `loop[1].zh`
顯示：建塘並放入魚

「等待繁殖或产卵」
出處：`sources/text/fishing-pond-production.json` 字元 806-813 `loop[2].zh`
顯示：等待繁殖或產卵

「收获并保留生产基础」
出處：`sources/text/fishing-pond-production.json` 字元 885-894 `loop[3].zh`
顯示：收穫並保留生產基礎

## 玩家取捨

「稀有鱼直接出售能回笼资金，留下繁殖则可能带来长期收益。」
出處：`sources/text/fishing-pond-production.json` 字元 999-1026 `decisions[0].zh`
顯示：稀有魚直接出售能回籠資金，留下繁殖則可能帶來長期收益。

「每个鱼塘投入哪种鱼，会锁定土地和后续维护方向。」
出處：`sources/text/fishing-pond-production.json` 字元 1150-1173 `decisions[1].zh`
顯示：每個魚塘投入哪種魚，會鎖定土地和後續維護方向。

## 可調參數

「繁殖速度」
出處：`sources/text/fishing-pond-production.json` 字元 1329-1333 `parameters[0].name.zh`

「慢繁殖强调保护种群，快繁殖容易转成大规模流水线。」
出處：`sources/text/fishing-pond-production.json` 字元 1412-1436 `parameters[0].effect.zh`
顯示：慢繁殖強調保護種羣，快繁殖容易轉成大規模流水線。

「容量扩张条件」
出處：`sources/text/fishing-pond-production.json` 字元 1600-1606 `parameters[1].name.zh`
顯示：容量擴張條件

「材料任务增加阶段目标，纯付费升级则更侧重资本积累。」
出處：`sources/text/fishing-pond-production.json` 字元 1688-1713 `parameters[1].effect.zh`
顯示：材料任務增加階段目標，純付費升級則更側重資本積累。

## 原型

「做一个有容量上限的鱼塘、繁育计时和“取出几条”的选择，先只用一种鱼。」
出處：`sources/text/fishing-pond-production.json` 字元 3150-3184 `prototype.firstStep.zh`
顯示：做一個有容量上限的魚塘、繁育計時和“取出幾條”的選擇，先只用一種魚。

「遇到紧急订单时，玩家是否理解抽空鱼塘会损失后续收益？」
出處：`sources/text/fishing-pond-production.json` 字元 3523-3549 `prototype.test.zh`
顯示：遇到緊急訂單時，玩家是否理解抽空魚塘會損失後續收益？

「别把完整遗传、疾病与多鱼种生态一起塞入第一版；先测试提取与保留的平衡。」
出處：`sources/text/fishing-pond-production.json` 字元 3334-3369 `prototype.pitfall.zh`
顯示：別把完整遺傳、疾病與多魚種生態一起塞入第一版；先測試提取與保留的平衡。

## 相關模式

- [牲畜照料](farming-livestock-care.md)
- [種子再投入](farming-seed-reinvestment.md)
- [餌配置組](fishing-bait-loadout.md)
- [裝備進出](fishing-equipment-access.md)

## 參考來源

- [Fish-pond production — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/fishing-pond-production/) — 查閱：2026-11-02；取得方式：page-text。
