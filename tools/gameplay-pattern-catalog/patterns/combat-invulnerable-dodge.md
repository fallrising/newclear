---
{
  "schema_version": 2,
  "id": "combat-invulnerable-dodge",
  "title": "無敵閃避",
  "title_en": "Invulnerability-window dodging",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "timing",
    "dexterity",
    "spatial"
  ],
  "summary": "不只离开危险区，也能在正确瞬间穿过攻击。",
  "note_status": "draft",
  "related": [
    "combat-combo-variation",
    "combat-action-points",
    "combat-cover-flanking",
    "combat-destructible-cover"
  ],
  "sources": [
    {
      "title": "Invulnerability-window dodging — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-invulnerable-dodge/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「不只离开危险区，也能在正确瞬间穿过攻击。」
出處：`sources/text/combat-invulnerable-dodge.json` 字元 182-202 `summary.zh`
顯示：不只離開危險區，也能在正確瞬間穿過攻擊。

## 規則

「闪避动作在部分时间内不受特定伤害，动作结束后仍可能落在危险位置。玩家需要同时判断按键时机、移动方向和落点，反馈来自擦身而过与反击窗口。」
出處：`sources/text/combat-invulnerable-dodge.json` 字元 315-382 `rules.zh`
顯示：閃避動作在部分時間內不受特定傷害，動作結束後仍可能落在危險位置。玩家需要同時判斷按鍵時機、移動方向和落點，反饋來自擦身而過與反擊窗口。

## 核心循環

「读取攻击轨迹」
出處：`sources/text/combat-invulnerable-dodge.json` 字元 610-616 `loop[0].zh`
顯示：讀取攻擊軌跡

「选定安全落点」
出處：`sources/text/combat-invulnerable-dodge.json` 字元 680-686 `loop[1].zh`
顯示：選定安全落點

「对齐闪避窗口」
出處：`sources/text/combat-invulnerable-dodge.json` 字元 754-760 `loop[2].zh`
顯示：對齊閃避窗口

「回到可进攻距离」
出處：`sources/text/combat-invulnerable-dodge.json` 字元 826-833 `loop[3].zh`
顯示：回到可進攻距離

## 玩家取捨

「向外撤退更安全，穿过敌人可能更快进入背后反击位置。」
出處：`sources/text/combat-invulnerable-dodge.json` 字元 920-945 `decisions[0].zh`
顯示：向外撤退更安全，穿過敵人可能更快進入背後反擊位置。

「连续闪避能脱险，却可能把自己送进下一组危险。」
出處：`sources/text/combat-invulnerable-dodge.json` 字元 1081-1103 `decisions[1].zh`
顯示：連續閃避能脫險，卻可能把自己送進下一組危險。

## 可調參數

「无敌时段占比」
出處：`sources/text/combat-invulnerable-dodge.json` 字元 1254-1260 `parameters[0].name.zh`
顯示：無敵時段佔比

「占比增大会降低精确时机要求，但落点仍可保持挑战。」
出處：`sources/text/combat-invulnerable-dodge.json` 字元 1342-1366 `parameters[0].effect.zh`
顯示：佔比增大會降低精確時機要求，但落點仍可保持挑戰。

「冷却与连用次数」
出處：`sources/text/combat-invulnerable-dodge.json` 字元 1527-1534 `parameters[1].name.zh`
顯示：冷卻與連用次數

「更长冷却迫使玩家预判，短冷却适合密集弹幕。」
出處：`sources/text/combat-invulnerable-dodge.json` 字元 1615-1636 `parameters[1].effect.zh`
顯示：更長冷卻迫使玩家預判，短冷卻適合密集彈幕。

## 原型

「用一个圆形角色、一种横扫和可显示的闪避保护时段做测试场。」
出處：`sources/text/combat-invulnerable-dodge.json` 字元 3144-3172 `prototype.firstStep.zh`
顯示：用一個圓形角色、一種橫掃和可顯示的閃避保護時段做測試場。

「观察玩家是否同时改变翻滚时机和方向，而非只反复按闪避。」
出處：`sources/text/combat-invulnerable-dodge.json` 字元 3503-3530 `prototype.test.zh`
顯示：觀察玩家是否同時改變翻滾時機和方向，而非只反覆按閃避。

「先解决角色碰撞与落点，避免玩家明明躲过攻击却卡在敌人身体里。」
出處：`sources/text/combat-invulnerable-dodge.json` 字元 3312-3342 `prototype.pitfall.zh`
顯示：先解決角色碰撞與落點，避免玩家明明躲過攻擊卻卡在敵人身體裏。

## 相關模式

- [連段變化](combat-combo-variation.md)
- [行動點數](combat-action-points.md)
- [掩體側擊](combat-cover-flanking.md)
- [可破壞掩體](combat-destructible-cover.md)

## 參考來源

- [Invulnerability-window dodging — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-invulnerable-dodge/) — 查閱：2026-11-02；取得方式：page-text。
