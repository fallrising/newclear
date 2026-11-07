---
{
  "schema_version": 2,
  "id": "farming-livestock-care",
  "title": "牲畜照料",
  "title_en": "Livestock care",
  "category": "farming",
  "source_category": "farming",
  "tags": [
    "planning",
    "progression",
    "economy"
  ],
  "summary": "喂养与照顾把动物变成持续产出、持续占用时间的伙伴。",
  "note_status": "draft",
  "related": [
    "farming-seed-reinvestment",
    "farming-orchard-investment",
    "farming-regrowth-crops",
    "farming-season-window"
  ],
  "sources": [
    {
      "title": "Livestock care — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/farming-livestock-care/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「喂养与照顾把动物变成持续产出、持续占用时间的伙伴。」
出處：`sources/text/farming-livestock-care.json` 字元 165-190 `summary.zh`
顯示：餵養與照顧把動物變成持續產出、持續佔用時間的夥伴。

## 規則

「玩家为家畜准备住处、食物并定期互动，成熟后收集蛋、奶等产物。产出受成长或照料状态影响，扩大家畜数量也扩大饲料与每日工作量。」
出處：`sources/text/farming-livestock-care.json` 字元 306-367 `rules.zh`
顯示：玩家爲家畜準備住處、食物並定期互動，成熟後收集蛋、奶等產物。產出受成長或照料狀態影響，擴大家畜數量也擴大飼料與每日工作量。

## 核心循環

「建住处并引入家畜」
出處：`sources/text/farming-livestock-care.json` 字元 617-625 `loop[0].zh`
顯示：建住處並引入家畜

「补充饲料与互动」
出處：`sources/text/farming-livestock-care.json` 字元 702-709 `loop[1].zh`
顯示：補充飼料與互動

「检查状态并收集产物」
出處：`sources/text/farming-livestock-care.json` 字元 778-787 `loop[2].zh`
顯示：檢查狀態並收集產物

「安排加工或扩群」
出處：`sources/text/farming-livestock-care.json` 字元 865-872 `loop[3].zh`
顯示：安排加工或擴羣

## 玩家取捨

「扩群前要保证饲料来源，不能只看购买动物的价格。」
出處：`sources/text/farming-livestock-care.json` 字元 972-995 `decisions[0].zh`
顯示：擴羣前要保證飼料來源，不能只看購買動物的價格。

「今天逐只互动，还是先花钱减轻喂食工作，把时间留给外出？」
出處：`sources/text/farming-livestock-care.json` 字元 1126-1153 `decisions[1].zh`
顯示：今天逐只互動，還是先花錢減輕餵食工作，把時間留給外出？

## 可調參數

「照料与产出关系」
出處：`sources/text/farming-livestock-care.json` 字元 1343-1350 `parameters[0].name.zh`
顯示：照料與產出關係

「仅影响品质比较宽容，完全停产会迫使每日打卡。」
出處：`sources/text/farming-livestock-care.json` 字元 1436-1458 `parameters[0].effect.zh`
顯示：僅影響品質比較寬容，完全停產會迫使每日打卡。

「自动化解锁时间」
出處：`sources/text/farming-livestock-care.json` 字元 1623-1630 `parameters[1].name.zh`
顯示：自動化解鎖時間

「过晚容易重复疲劳，过早则削弱认识动物的过程。」
出處：`sources/text/farming-livestock-care.json` 字元 1709-1731 `parameters[1].effect.zh`
顯示：過晚容易重複疲勞，過早則削弱認識動物的過程。

## 原型

「只做3个动物卡片、饲料库存和每日一次照料，用状态提示代替复杂行为AI。」
出處：`sources/text/farming-livestock-care.json` 字元 3221-3256 `prototype.firstStep.zh`
顯示：只做3個動物卡片、飼料庫存和每日一次照料，用狀態提示代替複雜行爲AI。

「当饲料与时间受限时，玩家是否会推迟扩群并调整照料顺序？」
出處：`sources/text/farming-livestock-care.json` 字元 3614-3641 `prototype.test.zh`
顯示：當飼料與時間受限時，玩家是否會推遲擴羣並調整照料順序？

「繁殖、疾病、自由寻路和品种差异都能扩大范围，先检查每日照料是否有取舍。」
出處：`sources/text/farming-livestock-care.json` 字元 3426-3461 `prototype.pitfall.zh`
顯示：繁殖、疾病、自由尋路和品種差異都能擴大範圍，先檢查每日照料是否有取捨。

## 相關模式

- [種子再投入](farming-seed-reinvestment.md)
- [果樹投入](farming-orchard-investment.md)
- [再生作物群](farming-regrowth-crops.md)
- [季節窗口](farming-season-window.md)

## 參考來源

- [Livestock care — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/farming-livestock-care/) — 查閱：2026-11-02；取得方式：page-text。
