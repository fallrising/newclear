---
{
  "schema_version": 2,
  "id": "farming-substrate-match",
  "title": "基質對應",
  "title_en": "Crop–substrate matching",
  "category": "farming",
  "source_category": "farming",
  "tags": [
    "spatial",
    "discovery",
    "planning"
  ],
  "summary": "种子能否生长，取决于脚下是什么地面。",
  "note_status": "draft",
  "related": [
    "farming-crop-protection",
    "farming-irrigation-layout",
    "building-access-network",
    "building-room-requirements"
  ],
  "sources": [
    {
      "title": "Crop–substrate matching — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/farming-substrate-match/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「种子能否生长，取决于脚下是什么地面。」
出處：`sources/text/farming-substrate-match.json` 字元 176-194 `summary.zh`
顯示：種子能否生長，取決於腳下是什麼地面。

## 規則

「玩家识别种子的地面要求，寻找或搬运兼容基质，再种植目标作物。不合适的地块无法形成有效种植点；正确的环境配置把探索所得转成稳定生产。」
出處：`sources/text/farming-substrate-match.json` 字元 291-356 `rules.zh`
顯示：玩家識別種子的地面要求，尋找或搬運兼容基質，再種植目標作物。不合適的地塊無法形成有效種植點；正確的環境配置把探索所得轉成穩定生產。

## 核心循環

「发现新种子」
出處：`sources/text/farming-substrate-match.json` 字元 607-612 `loop[0].zh`
顯示：發現新種子

「确认基质要求」
出處：`sources/text/farming-substrate-match.json` 字元 671-677 `loop[1].zh`
顯示：確認基質要求

「寻找或铺设地面」
出處：`sources/text/farming-substrate-match.json` 字元 743-750 `loop[2].zh`
顯示：尋找或鋪設地面

「种植并扩建专用田」
出處：`sources/text/farming-substrate-match.json` 字元 823-831 `loop[3].zh`
顯示：種植並擴建專用田

## 玩家取捨

「就地建立分基地，还是把稀有土壤搬回家，取决于运输成本。」
出處：`sources/text/farming-substrate-match.json` 字元 931-958 `decisions[0].zh`
顯示：就地建立分基地，還是把稀有土壤搬回家，取決於運輸成本。

「专用田提升可靠性，但让种植空间更难临时改用途。」
出處：`sources/text/farming-substrate-match.json` 字元 1076-1099 `decisions[1].zh`
顯示：專用田提升可靠性，但讓種植空間更難臨時改用途。

## 可調參數

「基质稀缺度」
出處：`sources/text/farming-substrate-match.json` 字元 1256-1261 `parameters[0].name.zh`
顯示：基質稀缺度

「稀缺基质让作物成为探索奖励，而非商店里的一种皮肤。」
出處：`sources/text/farming-substrate-match.json` 字元 1339-1364 `parameters[0].effect.zh`
顯示：稀缺基質讓作物成爲探索獎勵，而非商店裏的一種皮膚。

「搬运成本」
出處：`sources/text/farming-substrate-match.json` 字元 1527-1531 `parameters[1].name.zh`
顯示：搬運成本

「低成本鼓励集中基地，高成本鼓励地区分工。」
出處：`sources/text/farming-substrate-match.json` 字元 1607-1627 `parameters[1].effect.zh`
顯示：低成本鼓勵集中基地，高成本鼓勵地區分工。

## 原型

「用两类地面和两类种子做兼容表，放置预览直接说明不兼容原因。」
出處：`sources/text/farming-substrate-match.json` 字元 3095-3124 `prototype.firstStep.zh`
顯示：用兩類地面和兩類種子做兼容表，放置預覽直接說明不兼容原因。

「第一次失败后，玩家能否根据提示自行换地面，而无需查看外部说明？」
出處：`sources/text/farming-substrate-match.json` 字元 3461-3492 `prototype.test.zh`
顯示：第一次失敗後，玩家能否根據提示自行換地面，而無需查看外部說明？

「若每个种子都有独立土壤，记忆负担会迅速增加；先用少量可归类的需求。」
出處：`sources/text/farming-substrate-match.json` 字元 3269-3302 `prototype.pitfall.zh`
顯示：若每個種子都有獨立土壤，記憶負擔會迅速增加；先用少量可歸類的需求。

## 相關模式

- [作物保護](farming-crop-protection.md)
- [灌溉配置](farming-irrigation-layout.md)
- [進出網路](building-access-network.md)
- [房間需求條件](building-room-requirements.md)

## 參考來源

- [Crop–substrate matching — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/farming-substrate-match/) — 查閱：2026-11-02；取得方式：page-text。
