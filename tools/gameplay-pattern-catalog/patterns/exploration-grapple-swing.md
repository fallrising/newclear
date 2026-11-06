---
{
  "schema_version": 2,
  "id": "exploration-grapple-swing",
  "title": "鉤索擺盪決策",
  "title_en": "Grapple swings and release timing",
  "category": "movement",
  "source_category": "movement",
  "tags": [
    "dexterity",
    "spatial",
    "timing"
  ],
  "summary": "选锚点、积累速度、适时放手，把空间变成运动路线。",
  "note_status": "draft",
  "related": [
    "exploration-wall-jump",
    "movement-low-slide",
    "combat-invulnerable-dodge",
    "exploration-air-action-refill"
  ],
  "sources": [
    {
      "title": "Grapple swings and release timing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/exploration-grapple-swing/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「选锚点、积累速度、适时放手，把空间变成运动路线。」
出處：`sources/text/exploration-grapple-swing.json` 字元 191-215 `summary.zh`
顯示：選錨點、積累速度、適時放手，把空間變成運動路線。

## 規則

「向可连接表面发射钩索，利用绳长和重力摆荡，再在合适时机脱离。目标不是只到达锚点，而是借由锚点获得位置和速度；落点与下个连接点共同决定最佳放手时机。」
出處：`sources/text/exploration-grapple-swing.json` 字元 319-392 `rules.zh`
顯示：向可連接表面發射鉤索，利用繩長和重力擺蕩，再在合適時機脫離。目標不是隻到達錨點，而是藉由錨點獲得位置和速度；落點與下個連接點共同決定最佳放手時機。

## 核心循環

「选取锚点」
出處：`sources/text/exploration-grapple-swing.json` 字元 662-666 `loop[0].zh`
顯示：選取錨點

「连接并形成摆弧」
出處：`sources/text/exploration-grapple-swing.json` 字元 726-733 `loop[1].zh`
顯示：連接並形成擺弧

「调整方向与速度」
出處：`sources/text/exploration-grapple-swing.json` 字元 801-808 `loop[2].zh`
顯示：調整方向與速度

「放手衔接下一动作」
出處：`sources/text/exploration-grapple-swing.json` 字元 873-881 `loop[3].zh`
顯示：放手銜接下一動作

## 玩家取捨

「近处锚点可靠，远处锚点可能带来更高速度。」
出處：`sources/text/exploration-grapple-swing.json` 字元 974-994 `decisions[0].zh`
顯示：近處錨點可靠，遠處錨點可能帶來更高速度。

「晚放手能获得高度，早放手可能保留更好的前进方向。」
出處：`sources/text/exploration-grapple-swing.json` 字元 1105-1129 `decisions[1].zh`
顯示：晚放手能獲得高度，早放手可能保留更好的前進方向。

## 可調參數

「可挂接范围」
出處：`sources/text/exploration-grapple-swing.json` 字元 1302-1307 `parameters[0].name.zh`
顯示：可掛接範圍

「任意表面更自由，指定挂点更容易控制关卡节奏。」
出處：`sources/text/exploration-grapple-swing.json` 字元 1387-1409 `parameters[0].effect.zh`
顯示：任意表面更自由，指定掛點更容易控制關卡節奏。

「动量保留」
出處：`sources/text/exploration-grapple-swing.json` 字元 1555-1559 `parameters[1].name.zh`
顯示：動量保留

「保留更多速度鼓励高手连续摆荡，强制减速则方便落点控制。」
出處：`sources/text/exploration-grapple-swing.json` 字元 1639-1666 `parameters[1].effect.zh`
顯示：保留更多速度鼓勵高手連續擺盪，強制減速則方便落點控制。

## 原型

「先做二维单绳、固定锚点和一个落点目标，屏幕显示预测轨迹辅助调试。」
出處：`sources/text/exploration-grapple-swing.json` 字元 3187-3219 `prototype.firstStep.zh`
顯示：先做二維單繩、固定錨點和一個落點目標，屏幕顯示預測軌跡輔助調試。

「观察玩家能否通过调整松手时机稳定落地，并能判断失误方向。」
出處：`sources/text/exploration-grapple-swing.json` 字元 3556-3584 `prototype.test.zh`
顯示：觀察玩家能否通過調整鬆手時機穩定落地，並能判斷失誤方向。

「绳长、碰撞、镜头与速度互相影响；动态锚点和绳索绕障会额外增加难度。」
出處：`sources/text/exploration-grapple-swing.json` 字元 3362-3395 `prototype.pitfall.zh`
顯示：繩長、碰撞、鏡頭與速度互相影響；動態錨點和繩索繞障會額外增加難度。

## 相關模式

- [牆面跳躍](exploration-wall-jump.md)
- [低處滑動](movement-low-slide.md)
- [無敵閃避](combat-invulnerable-dodge.md)
- [空中行動回補](exploration-air-action-refill.md)

## 參考來源

- [Grapple swings and release timing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/exploration-grapple-swing/) — 查閱：2026-11-02；取得方式：page-text。
