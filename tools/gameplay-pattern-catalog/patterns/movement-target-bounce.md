---
{
  "schema_version": 2,
  "id": "movement-target-bounce",
  "title": "目標彈跳",
  "title_en": "Bounce from a target into the next jump",
  "category": "movement",
  "source_category": "movement",
  "tags": [
    "timing",
    "precision",
    "spatial"
  ],
  "summary": "危险目标也能变成踏脚石，但必须从正确方向命中。",
  "note_status": "draft",
  "related": [
    "exploration-grapple-swing",
    "exploration-wall-jump",
    "movement-auto-forward",
    "movement-carry-object"
  ],
  "sources": [
    {
      "title": "Bounce from a target into the next jump — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/movement-target-bounce/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「危险目标也能变成踏脚石，但必须从正确方向命中。」
出處：`sources/text/movement-target-bounce.json` 字元 198-221 `summary.zh`
顯示：危險目標也能變成踏腳石，但必須從正確方向命中。

## 規則

「角色从上方向下命中允许借力的目标，就会获得新的向上运动。玩家要对准接触位置，并在弹起后马上规划下一落点；碰到目标的侧面或落空，通常无法获得同样的借力。」
出處：`sources/text/movement-target-bounce.json` 字元 352-427 `rules.zh`
顯示：角色從上方向下命中允許借力的目標，就會獲得新的向上運動。玩家要對準接觸位置，並在彈起後馬上規劃下一落點；碰到目標的側面或落空，通常無法獲得同樣的借力。

## 核心循環

「寻找可借力目标」
出處：`sources/text/movement-target-bounce.json` 字元 683-690 `loop[0].zh`
顯示：尋找可借力目標

「从上方对准接触」
出處：`sources/text/movement-target-bounce.json` 字元 758-765 `loop[1].zh`
顯示：從上方對準接觸

「借弹起改变高度」
出處：`sources/text/movement-target-bounce.json` 字元 829-836 `loop[2].zh`
顯示：借彈起改變高度

「接续落点或下一目标」
出處：`sources/text/movement-target-bounce.json` 字元 910-919 `loop[3].zh`
顯示：接續落點或下一目標

## 玩家取捨

「绕到安全地面，还是冒险借移动敌人跳上更高的平台？」
出處：`sources/text/movement-target-bounce.json` 字元 1023-1047 `decisions[0].zh`
顯示：繞到安全地面，還是冒險借移動敵人跳上更高的平臺？

「弹起后直达出口，还是再踩一次拿到旁边的奖励？」
出處：`sources/text/movement-target-bounce.json` 字元 1167-1189 `decisions[1].zh`
顯示：彈起後直達出口，還是再踩一次拿到旁邊的獎勵？

## 可調參數

「有效接触范围」
出處：`sources/text/movement-target-bounce.json` 字元 1353-1359 `parameters[0].name.zh`
顯示：有效接觸範圍

「范围越宽越容易读懂借力，越窄越强调对准和时机。」
出處：`sources/text/movement-target-bounce.json` 字元 1439-1462 `parameters[0].effect.zh`
顯示：範圍越寬越容易讀懂借力，越窄越強調對準和時機。

「弹起高度」
出處：`sources/text/movement-target-bounce.json` 字元 1631-1635 `parameters[1].name.zh`
顯示：彈起高度

「高度决定能连接哪些落点，也决定失败后是否仍有修正空间。」
出處：`sources/text/movement-target-bounce.json` 字元 1711-1738 `parameters[1].effect.zh`
顯示：高度決定能連接哪些落點，也決定失敗後是否仍有修正空間。

## 原型

「用一个匀速移动圆形目标、一个深坑和一个高台，只实现顶部接触反弹；先不加复杂战斗。」
出處：`sources/text/movement-target-bounce.json` 字元 3370-3410 `prototype.firstStep.zh`
顯示：用一個勻速移動圓形目標、一個深坑和一個高臺，只實現頂部接觸反彈；先不加複雜戰鬥。

「观察玩家是否能在第二次尝试前指出应该等目标移动到哪里，以及应该从哪侧接近。」
出處：`sources/text/movement-target-bounce.json` 字元 3758-3795 `prototype.test.zh`
顯示：觀察玩家是否能在第二次嘗試前指出應該等目標移動到哪裏，以及應該從哪側接近。

「如果侧面和顶部接触反馈不一致却没有清楚提示，玩家会觉得借力随机。」
出處：`sources/text/movement-target-bounce.json` 字元 3590-3622 `prototype.pitfall.zh`
顯示：如果側面和頂部接觸反饋不一致卻沒有清楚提示，玩家會覺得借力隨機。

## 相關模式

- [鉤索擺盪決策](exploration-grapple-swing.md)
- [牆面跳躍](exploration-wall-jump.md)
- [自動推進前進](movement-auto-forward.md)
- [搬運物件](movement-carry-object.md)

## 參考來源

- [Bounce from a target into the next jump — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/movement-target-bounce/) — 查閱：2026-11-02；取得方式：page-text。
