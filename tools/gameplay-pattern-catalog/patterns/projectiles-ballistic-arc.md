---
{
  "schema_version": 2,
  "id": "projectiles-ballistic-arc",
  "title": "拋物彈道",
  "title_en": "Aim higher to correct a falling trajectory",
  "category": "projectiles",
  "source_category": "projectiles",
  "tags": [
    "precision",
    "spatial",
    "information"
  ],
  "summary": "瞄准的是未来落点，发射方向不一定正对目标。",
  "note_status": "draft",
  "related": [
    "projectiles-independent-aim",
    "projectiles-wall-ricochet",
    "projectiles-charged-release",
    "projectiles-graze-reward"
  ],
  "sources": [
    {
      "title": "Aim higher to correct a falling trajectory — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/projectiles-ballistic-arc/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「瞄准的是未来落点，发射方向不一定正对目标。」
出處：`sources/text/projectiles-ballistic-arc.json` 字元 206-227 `summary.zh`
顯示：瞄準的是未來落點，發射方向不一定正對目標。

## 規則

「投射物飞行需要时间，并会在途中下坠。玩家调整发射角度，先观察一次落点，再修正高低和提前量；目标移动或距离变化后，原来的瞄法需要重新估计。」
出處：`sources/text/projectiles-ballistic-arc.json` 字元 346-414 `rules.zh`
顯示：投射物飛行需要時間，並會在途中下墜。玩家調整發射角度，先觀察一次落點，再修正高低和提前量；目標移動或距離變化後，原來的瞄法需要重新估計。

## 核心循環

「估计距离和移动方向」
出處：`sources/text/projectiles-ballistic-arc.json` 字元 649-658 `loop[0].zh`
顯示：估計距離和移動方向

「抬高或提前瞄准」
出處：`sources/text/projectiles-ballistic-arc.json` 字元 737-744 `loop[1].zh`
顯示：抬高或提前瞄準

「观察飞行与落点」
出處：`sources/text/projectiles-ballistic-arc.json` 字元 806-813 `loop[2].zh`
顯示：觀察飛行與落點

「按偏差修正下一发」
出處：`sources/text/projectiles-ballistic-arc.json` 字元 884-892 `loop[3].zh`
顯示：按偏差修正下一發

## 玩家取捨

「直接低角度出手更快，高角度能越过障碍但飞得更久。」
出處：`sources/text/projectiles-ballistic-arc.json` 字元 992-1016 `decisions[0].zh`
顯示：直接低角度出手更快，高角度能越過障礙但飛得更久。

「先打一发校准，还是为节省弹药靠近后再射？」
出處：`sources/text/projectiles-ballistic-arc.json` 字元 1134-1154 `decisions[1].zh`
顯示：先打一發校準，還是爲節省彈藥靠近後再射？

## 可調參數

「飞行速度与下坠」
出處：`sources/text/projectiles-ballistic-arc.json` 字元 1297-1304 `parameters[0].name.zh`
顯示：飛行速度與下墜

「下坠明显会强化距离判断；速度过慢则会让移动目标难以预测。」
出處：`sources/text/projectiles-ballistic-arc.json` 字元 1380-1408 `parameters[0].effect.zh`
顯示：下墜明顯會強化距離判斷；速度過慢則會讓移動目標難以預測。

「轨迹预览长度」
出處：`sources/text/projectiles-ballistic-arc.json` 字元 1579-1585 `parameters[1].name.zh`
顯示：軌跡預覽長度

「完整预览降低计算负担；只显示前段会保留远处落点的试探。」
出處：`sources/text/projectiles-ballistic-arc.json` 字元 1672-1699 `parameters[1].effect.zh`
顯示：完整預覽降低計算負擔；只顯示前段會保留遠處落點的試探。

## 原型

「先做二维固定发射点、一道墙和三个距离不同的靶子，可重看上一条轨迹。」
出處：`sources/text/projectiles-ballistic-arc.json` 字元 3121-3154 `prototype.firstStep.zh`
顯示：先做二維固定發射點、一道牆和三個距離不同的靶子，可重看上一條軌跡。

「玩家是否能根据上一次落点，有方向地修正下一次投射？」
出處：`sources/text/projectiles-ballistic-arc.json` 字元 3476-3501 `prototype.test.zh`
顯示：玩家是否能根據上一次落點，有方向地修正下一次投射？

「镜头视角和发射点偏移容易造成准星与实际轨迹不一致。」
出處：`sources/text/projectiles-ballistic-arc.json` 字元 3310-3335 `prototype.pitfall.zh`
顯示：鏡頭視角和發射點偏移容易造成準星與實際軌跡不一致。

## 相關模式

- [分離瞄準](projectiles-independent-aim.md)
- [牆面反彈](projectiles-wall-ricochet.md)
- [蓄力後釋放](projectiles-charged-release.md)
- [擦彈獎勵](projectiles-graze-reward.md)

## 參考來源

- [Aim higher to correct a falling trajectory — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/projectiles-ballistic-arc/) — 查閱：2026-11-02；取得方式：page-text。
