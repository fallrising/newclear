---
{
  "schema_version": 2,
  "id": "exploration-wall-jump",
  "title": "牆面跳躍",
  "title_en": "Wall-jump traversal",
  "category": "movement",
  "source_category": "movement",
  "tags": [
    "dexterity",
    "spatial",
    "timing"
  ],
  "summary": "把墙从边界变成可连续借力的移动节点。",
  "note_status": "draft",
  "related": [
    "exploration-grapple-swing",
    "movement-low-slide",
    "combat-invulnerable-dodge",
    "exploration-air-action-refill"
  ],
  "sources": [
    {
      "title": "Wall-jump traversal — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/exploration-wall-jump/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把墙从边界变成可连续借力的移动节点。」
出處：`sources/text/exploration-wall-jump.json` 字元 172-190 `summary.zh`
顯示：把牆從邊界變成可連續借力的移動節點。

## 規則

「贴近墙面后跳离，借助另一面墙或空中调整继续上升。玩家要在墙距、危险物和落点之间规划节奏；失败通常来自方向或时机，而非缺少一把钥匙。」
出處：`sources/text/exploration-wall-jump.json` 字元 293-358 `rules.zh`
顯示：貼近牆面後跳離，藉助另一面牆或空中調整繼續上升。玩家要在牆距、危險物和落點之間規劃節奏；失敗通常來自方向或時機，而非缺少一把鑰匙。

## 核心循環

「判断墙距与出口」
出處：`sources/text/exploration-wall-jump.json` 字元 613-620 `loop[0].zh`
顯示：判斷牆距與出口

「贴墙建立起跳点」
出處：`sources/text/exploration-wall-jump.json` 字元 690-697 `loop[1].zh`
顯示：貼牆建立起跳點

「蹬离并调整方向」
出處：`sources/text/exploration-wall-jump.json` 字元 753-760 `loop[2].zh`
顯示：蹬離並調整方向

「接住下一面墙或平台」
出處：`sources/text/exploration-wall-jump.json` 字元 822-831 `loop[3].zh`
顯示：接住下一面牆或平臺

## 玩家取捨

「贴墙多停一会儿更容易看清路线，却可能滑向危险。」
出處：`sources/text/exploration-wall-jump.json` 字元 927-950 `decisions[0].zh`
顯示：貼牆多停一會兒更容易看清路線，卻可能滑向危險。

「连续高速蹬墙更快，停在安全平台则能重新校准。」
出處：`sources/text/exploration-wall-jump.json` 字元 1073-1095 `decisions[1].zh`
顯示：連續高速蹬牆更快，停在安全平臺則能重新校準。

## 可調參數

「横向推力」
出處：`sources/text/exploration-wall-jump.json` 字元 1246-1250 `parameters[0].name.zh`
顯示：橫向推力

「推力大强调两墙交替，推力小允许沿同一墙反复攀升。」
出處：`sources/text/exploration-wall-jump.json` 字元 1327-1351 `parameters[0].effect.zh`
顯示：推力大強調兩牆交替，推力小允許沿同一牆反覆攀升。

「空中转向能力」
出處：`sources/text/exploration-wall-jump.json` 字元 1507-1513 `parameters[1].name.zh`
顯示：空中轉向能力

「转向宽松降低失误代价，惯性强则需要提前规划。」
出處：`sources/text/exploration-wall-jump.json` 字元 1586-1608 `parameters[1].effect.zh`
顯示：轉向寬鬆降低失誤代價，慣性強則需要提前規劃。

## 原型

「先做一条双墙竖井、固定跳跃曲线和一个安全平台。」
出處：`sources/text/exploration-wall-jump.json` 字元 3099-3122 `prototype.firstStep.zh`
顯示：先做一條雙牆豎井、固定跳躍曲線和一個安全平臺。

「观察新玩家是否能连续蹬墙上升，并把失败归因到可理解的时机或方向。」
出處：`sources/text/exploration-wall-jump.json` 字元 3418-3450 `prototype.test.zh`
顯示：觀察新玩家是否能連續蹬牆上升，並把失敗歸因到可理解的時機或方向。

「贴墙判定、转向和按键宽容需要统一；先别用狭小关卡掩盖操作问题。」
出處：`sources/text/exploration-wall-jump.json` 字元 3251-3282 `prototype.pitfall.zh`
顯示：貼牆判定、轉向和按鍵寬容需要統一；先別用狹小關卡掩蓋操作問題。

## 相關模式

- [鉤索擺盪決策](exploration-grapple-swing.md)
- [低處滑動](movement-low-slide.md)
- [無敵閃避](combat-invulnerable-dodge.md)
- [空中行動回補](exploration-air-action-refill.md)

## 參考來源

- [Wall-jump traversal — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/exploration-wall-jump/) — 查閱：2026-11-02；取得方式：page-text。
