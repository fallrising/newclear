---
{
  "schema_version": 2,
  "id": "combat-overwatch",
  "title": "警戒射擊",
  "title_en": "Overwatch and reaction fire",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "planning",
    "spatial",
    "risk"
  ],
  "summary": "把当前机会留到敌人行动时，用一片危险区域限制它。",
  "note_status": "draft",
  "related": [
    "combat-cover-flanking",
    "combat-destructible-cover",
    "combat-forced-movement",
    "combat-friendly-fire"
  ],
  "sources": [
    {
      "title": "Overwatch and reaction fire — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-overwatch/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把当前机会留到敌人行动时，用一片危险区域限制它。」
出處：`sources/text/combat-overwatch.json` 字元 174-198 `summary.zh`
顯示：把當前機會留到敵人行動時，用一片危險區域限制它。

## 規則

「角色放弃立即攻击，进入警戒状态。敌人满足移动、进入射程等触发条件时自动遭到反应攻击；没有敌人触发就可能白等一轮。玩家要选择守哪里、留多少资源，以及是否值得诱使敌人进入。」
出處：`sources/text/combat-overwatch.json` 字元 306-390 `rules.zh`
顯示：角色放棄立即攻擊，進入警戒狀態。敵人滿足移動、進入射程等觸發條件時自動遭到反應攻擊；沒有敵人觸發就可能白等一輪。玩家要選擇守哪裏、留多少資源，以及是否值得誘使敵人進入。

## 核心循環

「预测敌人路线」
出處：`sources/text/combat-overwatch.json` 字元 662-668 `loop[0].zh`
顯示：預測敵人路線

「设置警戒区域」
出處：`sources/text/combat-overwatch.json` 字元 735-741 `loop[1].zh`
顯示：設置警戒區域

「等待条件触发」
出處：`sources/text/combat-overwatch.json` 字元 805-811 `loop[2].zh`
顯示：等待條件觸發

「射击后重新部署」
出處：`sources/text/combat-overwatch.json` 字元 875-882 `loop[3].zh`
顯示：射擊後重新部署

## 玩家取捨

「现在有一次低命中攻击，要不要换成守住必经路线？」
出處：`sources/text/combat-overwatch.json` 字元 967-990 `decisions[0].zh`
顯示：現在有一次低命中攻擊，要不要換成守住必經路線？

「守窄入口提高效果，还是扩大范围覆盖更多可能？」
出處：`sources/text/combat-overwatch.json` 字元 1090-1112 `decisions[1].zh`
顯示：守窄入口提高效果，還是擴大範圍覆蓋更多可能？

## 可調參數

「触发条件」
出處：`sources/text/combat-overwatch.json` 字元 1253-1257 `parameters[0].name.zh`
顯示：觸發條件

「按移动、入区或开火触发，会鼓励完全不同的诱敌方式。」
出處：`sources/text/combat-overwatch.json` 字元 1337-1362 `parameters[0].effect.zh`
顯示：按移動、入區或開火觸發，會鼓勵完全不同的誘敵方式。

「警戒次数与精度」
出處：`sources/text/combat-overwatch.json` 字元 1510-1517 `parameters[1].name.zh`
顯示：警戒次數與精度

「次数和精度决定封锁力度；过强会让主动进攻总是吃亏。」
出處：`sources/text/combat-overwatch.json` 字元 1606-1631 `parameters[1].effect.zh`
顯示：次數和精度決定封鎖力度；過強會讓主動進攻總是喫虧。

## 原型

「用小网格实现一条入口和一次移动触发射击，再加入第二名单位。」
出處：`sources/text/combat-overwatch.json` 字元 3040-3069 `prototype.firstStep.zh`
顯示：用小網格實現一條入口和一次移動觸發射擊，再加入第二名單位。

「观察进攻方是否能看懂危险区域并找到至少一种绕行或诱发办法。」
出處：`sources/text/combat-overwatch.json` 字元 3375-3404 `prototype.test.zh`
顯示：觀察進攻方是否能看懂危險區域並找到至少一種繞行或誘發辦法。

「多个警戒同时触发时，射击顺序和目标死亡后的处理容易混乱。」
出處：`sources/text/combat-overwatch.json` 字元 3207-3235 `prototype.pitfall.zh`
顯示：多個警戒同時觸發時，射擊順序和目標死亡後的處理容易混亂。

## 相關模式

- [掩體側擊](combat-cover-flanking.md)
- [可破壞掩體](combat-destructible-cover.md)
- [強制移動](combat-forced-movement.md)
- [範圍攻擊的友方誤傷](combat-friendly-fire.md)

## 參考來源

- [Overwatch and reaction fire — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-overwatch/) — 查閱：2026-11-02；取得方式：page-text。
