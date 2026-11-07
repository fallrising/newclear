---
{
  "schema_version": 2,
  "id": "movement-low-slide",
  "title": "低處滑動",
  "title_en": "Lower the body and slide through a gap",
  "category": "movement",
  "source_category": "movement",
  "tags": [
    "timing",
    "spatial",
    "dexterity"
  ],
  "summary": "利用已有速度穿过低处空间，出口还要留好落脚位置。",
  "note_status": "draft",
  "related": [
    "exploration-grapple-swing",
    "exploration-wall-jump",
    "combat-invulnerable-dodge",
    "exploration-air-action-refill"
  ],
  "sources": [
    {
      "title": "Lower the body and slide through a gap — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/movement-low-slide/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「利用已有速度穿过低处空间，出口还要留好落脚位置。」
出處：`sources/text/movement-low-slide.json` 字元 191-215 `summary.zh`
顯示：利用已有速度穿過低處空間，出口還要留好落腳位置。

## 規則

「角色在移动中进入更低的姿态，得以从站立时过不去的障碍下方通过。滑行距离受进入速度和阻力影响，玩家要选择开始的位置，并在空间足够时恢复站立；不是只换一个蹲姿动画。」
出處：`sources/text/movement-low-slide.json` 字元 339-419 `rules.zh`
顯示：角色在移動中進入更低的姿態，得以從站立時過不去的障礙下方通過。滑行距離受進入速度和阻力影響，玩家要選擇開始的位置，並在空間足夠時恢復站立；不是隻換一個蹲姿動畫。

## 核心循環

「判断低通道长度」
出處：`sources/text/movement-low-slide.json` 字元 736-743 `loop[0].zh`
顯示：判斷低通道長度

「取得合适速度」
出處：`sources/text/movement-low-slide.json` 字元 814-820 `loop[1].zh`
顯示：取得合適速度

「在入口前压低滑行」
出處：`sources/text/movement-low-slide.json` 字元 884-892 `loop[2].zh`
顯示：在入口前壓低滑行

「穿出后恢复或接动作」
出處：`sources/text/movement-low-slide.json` 字元 961-970 `loop[3].zh`
顯示：穿出後恢復或接動作

## 玩家取捨

「通道很长，先加速再滑，还是改走更高但更安全的路线？」
出處：`sources/text/movement-low-slide.json` 字元 1075-1100 `decisions[0].zh`
顯示：通道很長，先加速再滑，還是改走更高但更安全的路線？

「出口紧接深坑，应该晚一点开始滑，还是提前减速保留停步距离？」
出處：`sources/text/movement-low-slide.json` 字元 1222-1251 `decisions[1].zh`
顯示：出口緊接深坑，應該晚一點開始滑，還是提前減速保留停步距離？

## 可調參數

「滑行阻力」
出處：`sources/text/movement-low-slide.json` 字元 1416-1420 `parameters[0].name.zh`

「阻力越小越能保持速度，但出口附近更容易冲过安全区。」
出處：`sources/text/movement-low-slide.json` 字元 1494-1519 `parameters[0].effect.zh`
顯示：阻力越小越能保持速度，但出口附近更容易衝過安全區。

「低姿高度与恢复空间」
出處：`sources/text/movement-low-slide.json` 字元 1664-1673 `parameters[1].name.zh`
顯示：低姿高度與恢復空間

「尺寸差决定哪些通道可用，恢复空间检查决定是否会卡住或穿过顶棚。」
出處：`sources/text/movement-low-slide.json` 字元 1776-1807 `parameters[1].effect.zh`
顯示：尺寸差決定哪些通道可用，恢復空間檢查決定是否會卡住或穿過頂棚。

## 原型

「用一个矩形角色做站立与低姿两种碰撞高度，再加三种长度的低通道和可调滑行阻力。」
出處：`sources/text/movement-low-slide.json` 字元 3446-3484 `prototype.firstStep.zh`
顯示：用一個矩形角色做站立與低姿兩種碰撞高度，再加三種長度的低通道和可調滑行阻力。

「检查玩家是否能根据通道长度调整滑行起点，并在出口后可靠恢复站立。」
出處：`sources/text/movement-low-slide.json` 字元 3858-3890 `prototype.test.zh`
顯示：檢查玩家是否能根據通道長度調整滑行起點，並在出口後可靠恢復站立。

「低顶棚下强制站起容易卡住角色；先定义出口前保持低姿的规则。」
出處：`sources/text/movement-low-slide.json` 字元 3657-3686 `prototype.pitfall.zh`
顯示：低頂棚下強制站起容易卡住角色；先定義出口前保持低姿的規則。

## 相關模式

- [鉤索擺盪決策](exploration-grapple-swing.md)
- [牆面跳躍](exploration-wall-jump.md)
- [無敵閃避](combat-invulnerable-dodge.md)
- [空中行動回補](exploration-air-action-refill.md)

## 參考來源

- [Lower the body and slide through a gap — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/movement-low-slide/) — 查閱：2026-11-02；取得方式：page-text。
