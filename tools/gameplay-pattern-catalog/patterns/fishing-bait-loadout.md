---
{
  "schema_version": 2,
  "id": "fishing-bait-loadout",
  "title": "餌配置組",
  "title_en": "Bait loadouts",
  "category": "fishing",
  "source_category": "fishing",
  "tags": [
    "economy",
    "planning",
    "randomness"
  ],
  "summary": "钓鱼前的消耗品选择，改变等待、命中与目标分布。",
  "note_status": "draft",
  "related": [
    "fishing-pond-production",
    "fishing-cast-placement",
    "fishing-equipment-access",
    "fishing-habitat-search"
  ],
  "sources": [
    {
      "title": "Bait loadouts — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/fishing-bait-loadout/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「钓鱼前的消耗品选择，改变等待、命中与目标分布。」
出處：`sources/text/fishing-bait-loadout.json` 字元 160-183 `summary.zh`
顯示：釣魚前的消耗品選擇，改變等待、命中與目標分佈。

## 規則

「玩家准备并装上鱼饵，用持续消耗换取更快或更定向的渔获。不同鱼饵作用不同，成本需要按整次出行计算；玩家通过等待时间与捕获构成判断是否值得继续使用。」
出處：`sources/text/fishing-bait-loadout.json` 字元 297-369 `rules.zh`
顯示：玩家準備並裝上魚餌，用持續消耗換取更快或更定向的漁獲。不同魚餌作用不同，成本需要按整次出行計算；玩家通過等待時間與捕獲構成判斷是否值得繼續使用。

## 核心循環

「确定本次钓鱼目标」
出處：`sources/text/fishing-bait-loadout.json` 字元 620-628 `loop[0].zh`
顯示：確定本次釣魚目標

「挑选并携带鱼饵」
出處：`sources/text/fishing-bait-loadout.json` 字元 693-700 `loop[1].zh`
顯示：挑選並攜帶魚餌

「试钓并观察效果」
出處：`sources/text/fishing-bait-loadout.json` 字元 764-771 `loop[2].zh`
顯示：試釣並觀察效果

「更换鱼饵或补充库存」
出處：`sources/text/fishing-bait-loadout.json` 字元 839-848 `loop[3].zh`
顯示：更換魚餌或補充庫存

## 玩家取捨

「贵鱼饵能省时间，但普通目标未必值得消耗稀缺材料。」
出處：`sources/text/fishing-bait-loadout.json` 字元 935-959 `decisions[0].zh`
顯示：貴魚餌能省時間，但普通目標未必值得消耗稀缺材料。

「这次更需要缩短等待，还是提高目标鱼种的机会？该为哪一种效果付费？」
出處：`sources/text/fishing-bait-loadout.json` 字元 1086-1118 `decisions[1].zh`
顯示：這次更需要縮短等待，還是提高目標魚種的機會？該爲哪一種效果付費？

## 可調參數

「消耗概率」
出處：`sources/text/fishing-bait-loadout.json` 字元 1321-1325 `parameters[0].name.zh`

「必定消耗便于算成本，概率消耗增加库存不确定性。」
出處：`sources/text/fishing-bait-loadout.json` 字元 1410-1433 `parameters[0].effect.zh`
顯示：必定消耗便於算成本，概率消耗增加庫存不確定性。

「目标选择强度」
出處：`sources/text/fishing-bait-loadout.json` 字元 1588-1594 `parameters[1].name.zh`
顯示：目標選擇強度

「强定向减少无用渔获，弱定向保留意外发现。」
出處：`sources/text/fishing-bait-loadout.json` 字元 1674-1694 `parameters[1].effect.zh`
顯示：強定向減少無用漁獲，弱定向保留意外發現。

## 原型

「做两种效果清楚的鱼饵、可见库存和一组钓鱼结果记录，先不用操作小游戏。」
出處：`sources/text/fishing-bait-loadout.json` 字元 3178-3212 `prototype.firstStep.zh`
顯示：做兩種效果清楚的魚餌、可見庫存和一組釣魚結果記錄，先不用操作小遊戲。

「切换“随便赚钱”和“找特定鱼”两个目标，玩家是否会换鱼饵？」
出處：`sources/text/fishing-bait-loadout.json` 字元 3562-3591 `prototype.test.zh`
顯示：切換“隨便賺錢”和“找特定魚”兩個目標，玩家是否會換魚餌？

「只增加成功率容易变成单线升级；不同鱼饵应服务不同目标并有可见成本。」
出處：`sources/text/fishing-bait-loadout.json` 字元 3371-3404 `prototype.pitfall.zh`
顯示：只增加成功率容易變成單線升級；不同魚餌應服務不同目標並有可見成本。

## 相關模式

- [魚池產線](fishing-pond-production.md)
- [拋投放置](fishing-cast-placement.md)
- [裝備進出](fishing-equipment-access.md)
- [棲地搜尋](fishing-habitat-search.md)

## 參考來源

- [Bait loadouts — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/fishing-bait-loadout/) — 查閱：2026-11-02；取得方式：page-text。
