---
{
  "schema_version": 2,
  "id": "movement-variable-jump",
  "title": "可變跳躍",
  "title_en": "Hold duration sets jump height",
  "category": "movement",
  "source_category": "movement",
  "tags": [
    "timing",
    "precision",
    "dexterity"
  ],
  "summary": "同一个跳跃键，轻点过矮坎，长按够高台。",
  "note_status": "draft",
  "related": [
    "movement-auto-forward",
    "exploration-grapple-swing",
    "exploration-wall-jump",
    "movement-low-slide"
  ],
  "sources": [
    {
      "title": "Hold duration sets jump height — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/movement-variable-jump/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「同一个跳跃键，轻点过矮坎，长按够高台。」
出處：`sources/text/movement-variable-jump.json` 字元 186-205 `summary.zh`
顯示：同一個跳躍鍵，輕點過矮坎，長按夠高臺。

## 規則

「起跳后的一小段时间内，继续按住跳跃键会延长上升，提前松手则更早下落。玩家要根据头顶障碍和目标高度决定松手时机；每次落地都重新获得调整下一跳的机会。」
出處：`sources/text/movement-variable-jump.json` 字元 325-398 `rules.zh`
顯示：起跳後的一小段時間內，繼續按住跳躍鍵會延長上升，提前鬆手則更早下落。玩家要根據頭頂障礙和目標高度決定鬆手時機；每次落地都重新獲得調整下一跳的機會。

## 核心循環

「观察顶棚与落点」
出處：`sources/text/movement-variable-jump.json` 字元 668-675 `loop[0].zh`
顯示：觀察頂棚與落點

「按下跳跃」
出處：`sources/text/movement-variable-jump.json` 字元 747-751 `loop[1].zh`
顯示：按下跳躍

「选择松手时机」
出處：`sources/text/movement-variable-jump.json` 字元 809-815 `loop[2].zh`
顯示：選擇鬆手時機

「落地后调整下一跳」
出處：`sources/text/movement-variable-jump.json` 字元 881-889 `loop[3].zh`
顯示：落地後調整下一跳

## 玩家取捨

「头顶很低，是提前松手小跳，还是等走出顶棚再高跳？」
出處：`sources/text/movement-variable-jump.json` 字元 983-1007 `decisions[0].zh`
顯示：頭頂很低，是提前鬆手小跳，還是等走出頂棚再高跳？

「高处奖励需要更长滞空，要不要放弃奖励，早点落回安全地面？」
出處：`sources/text/movement-variable-jump.json` 字元 1142-1170 `decisions[1].zh`
顯示：高處獎勵需要更長滯空，要不要放棄獎勵，早點落回安全地面？

## 可調參數

「长按生效窗口」
出處：`sources/text/movement-variable-jump.json` 字元 1322-1328 `parameters[0].name.zh`
顯示：長按生效窗口

「窗口越长，高低跳区别越大，但按键时长也更难预测。」
出處：`sources/text/movement-variable-jump.json` 字元 1401-1425 `parameters[0].effect.zh`
顯示：窗口越長，高低跳區別越大，但按鍵時長也更難預測。

「松手后的减速」
出處：`sources/text/movement-variable-jump.json` 字元 1583-1589 `parameters[1].name.zh`
顯示：鬆手後的減速

「减速越明显，低跳越干脆；过于突然会让动作显得生硬。」
出處：`sources/text/movement-variable-jump.json` 字元 1676-1701 `parameters[1].effect.zh`
顯示：減速越明顯，低跳越乾脆；過於突然會讓動作顯得生硬。

## 原型

「做一间房，放一处低顶棚和两种高度的平台；仅实现轻点与长按两种可明显区分的跳高。」
出處：`sources/text/movement-variable-jump.json` 字元 3255-3294 `prototype.firstStep.zh`
顯示：做一間房，放一處低頂棚和兩種高度的平臺；僅實現輕點與長按兩種可明顯區分的跳高。

「让 5 位新玩家各过两次房间，检查第二次是否主动短按过低顶棚、长按上高台。」
出處：`sources/text/movement-variable-jump.json` 字元 3659-3696 `prototype.test.zh`
顯示：讓 5 位新玩家各過兩次房間，檢查第二次是否主動短按過低頂棚、長按上高臺。

「如果最高点几乎相同，玩家会把差别误认成随机误差；先把两种弧线拉开。」
出處：`sources/text/movement-variable-jump.json` 字元 3468-3501 `prototype.pitfall.zh`
顯示：如果最高點幾乎相同，玩家會把差別誤認成隨機誤差；先把兩種弧線拉開。

## 相關模式

- [自動推進前進](movement-auto-forward.md)
- [鉤索擺盪決策](exploration-grapple-swing.md)
- [牆面跳躍](exploration-wall-jump.md)
- [低處滑動](movement-low-slide.md)

## 參考來源

- [Hold duration sets jump height — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/movement-variable-jump/) — 查閱：2026-11-02；取得方式：page-text。
