---
{
  "schema_version": 2,
  "id": "building-modular-snapping",
  "title": "模組吸附決策",
  "title_en": "Modular snap construction",
  "category": "building",
  "source_category": "building",
  "tags": [
    "spatial",
    "creativity",
    "precision"
  ],
  "summary": "把墙、地板等部件对齐接口，快速拼出可编辑结构。",
  "note_status": "draft",
  "related": [
    "building-terrain-shaping",
    "building-vertical-stacking",
    "building-access-network",
    "building-room-requirements"
  ],
  "sources": [
    {
      "title": "Modular snap construction — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/building-modular-snapping/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把墙、地板等部件对齐接口，快速拼出可编辑结构。」
出處：`sources/text/building-modular-snapping.json` 字元 180-203 `summary.zh`
顯示：把牆、地板等部件對齊接口，快速拼出可編輯結構。

## 規則

「玩家选择、旋转并吸附部件，用有限模块组合建筑。尺寸与接口方向限制拼接；预览和碰撞反馈帮助修正位置。」
出處：`sources/text/building-modular-snapping.json` 字元 318-367 `rules.zh`
顯示：玩家選擇、旋轉並吸附部件，用有限模塊組合建築。尺寸與接口方向限制拼接；預覽和碰撞反饋幫助修正位置。

## 核心循環

「选择模块」
出處：`sources/text/building-modular-snapping.json` 字元 579-583 `loop[0].zh`
顯示：選擇模塊

「预览接口」
出處：`sources/text/building-modular-snapping.json` 字元 642-646 `loop[1].zh`
顯示：預覽接口

「旋转放置」
出處：`sources/text/building-modular-snapping.json` 字元 709-713 `loop[2].zh`
顯示：旋轉放置

「检查连接外形」
出處：`sources/text/building-modular-snapping.json` 字元 773-779 `loop[3].zh`
顯示：檢查連接外形

## 玩家取捨

「用现成模块快速拼好，还是多转几次方向，为门洞和通路留出更合适的位置？」
出處：`sources/text/building-modular-snapping.json` 字元 868-902 `decisions[0].zh`
顯示：用現成模塊快速拼好，還是多轉幾次方向，爲門洞和通路留出更合適的位置？

「沿用手头部件会占更多空间，是否值得换另一种模块来减少接缝和绕路？」
出處：`sources/text/building-modular-snapping.json` 字元 1038-1070 `decisions[1].zh`
顯示：沿用手頭部件會佔更多空間，是否值得換另一種模塊來減少接縫和繞路？

## 可調參數

「吸附强度」
出處：`sources/text/building-modular-snapping.json` 字元 1253-1257 `parameters[0].name.zh`
顯示：吸附強度

「强吸附更快，弱吸附适合细调但容易错位。」
出處：`sources/text/building-modular-snapping.json` 字元 1334-1353 `parameters[0].effect.zh`
顯示：強吸附更快，弱吸附適合細調但容易錯位。

「模块尺寸」
出處：`sources/text/building-modular-snapping.json` 字元 1504-1508 `parameters[1].name.zh`
顯示：模塊尺寸

「小部件支持细节，大部件减少重复操作。」
出處：`sources/text/building-modular-snapping.json` 字元 1582-1600 `parameters[1].effect.zh`
顯示：小部件支持細節，大部件減少重複操作。

## 原型

「做墙、地板和门3种模块，固定几个吸附点，并让预览与实际落位完全一致。」
出處：`sources/text/building-modular-snapping.json` 字元 3020-3054 `prototype.firstStep.zh`
顯示：做牆、地板和門3種模塊，固定幾個吸附點，並讓預覽與實際落位完全一致。

「玩家能否不靠反复撤销就把门接到预期位置，并知道某次放置为何无效？」
出處：`sources/text/building-modular-snapping.json` 字元 3405-3437 `prototype.test.zh`
顯示：玩家能否不靠反覆撤銷就把門接到預期位置，並知道某次放置爲何無效？

「任意角度、自由缩放和大量接口会增加组合测试，先限制尺寸与旋转档位。」
出處：`sources/text/building-modular-snapping.json` 字元 3212-3245 `prototype.pitfall.zh`
顯示：任意角度、自由縮放和大量接口會增加組合測試，先限制尺寸與旋轉檔位。

## 相關模式

- [地形塑形](building-terrain-shaping.md)
- [垂直疊高](building-vertical-stacking.md)
- [進出網路](building-access-network.md)
- [房間需求條件](building-room-requirements.md)

## 參考來源

- [Modular snap construction — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/building-modular-snapping/) — 查閱：2026-11-02；取得方式：page-text。
