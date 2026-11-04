---
{
  "schema_version": 2,
  "id": "deckbuilding-dual-use-cards",
  "title": "同一張牌的兩種用途",
  "title_en": "Two competing uses for one card",
  "category": "deckbuilding",
  "source_category": "deckbuilding",
  "tags": [
    "spatial",
    "planning",
    "risk"
  ],
  "summary": "把攻击和移动放在同一张牌上，选一个用途就放弃另一个。",
  "note_status": "draft",
  "related": [
    "deckbuilding-discard-redraw",
    "deckbuilding-exhaust-for-burst",
    "deckbuilding-dice-allocation",
    "deckbuilding-duplicate-investment"
  ],
  "sources": [
    {
      "title": "Two competing uses for one card — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-dual-use-cards/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把攻击和移动放在同一张牌上，选一个用途就放弃另一个。」
出處：`sources/text/deckbuilding-dual-use-cards.json` 字元 195-221 `summary.zh`
顯示：把攻擊和移動放在同一張牌上，選一個用途就放棄另一個。

## 規則

「每张牌提供两种互相竞争的用途，例如射击或移动、攻击或防守。玩家决定用哪一面，并按规则消耗或暂时失去另一面的机会；场景要经常同时需要这两种功能。」
出處：`sources/text/deckbuilding-dual-use-cards.json` 字元 335-406 `rules.zh`
顯示：每張牌提供兩種互相競爭的用途，例如射擊或移動、攻擊或防守。玩家決定用哪一面，並按規則消耗或暫時失去另一面的機會；場景要經常同時需要這兩種功能。

## 核心循環

「观察行动与位置需求」
出處：`sources/text/deckbuilding-dual-use-cards.json` 字元 651-660 `loop[0].zh`
顯示：觀察行動與位置需求

「比较一张牌的两种用途」
出處：`sources/text/deckbuilding-dual-use-cards.json` 字元 737-747 `loop[1].zh`
顯示：比較一張牌的兩種用途

「执行其中一种」
出處：`sources/text/deckbuilding-dual-use-cards.json` 字元 808-814 `loop[2].zh`
顯示：執行其中一種

「用其他牌补剩余缺口」
出處：`sources/text/deckbuilding-dual-use-cards.json` 字元 871-880 `loop[3].zh`
顯示：用其他牌補剩餘缺口

## 玩家取捨

「用枪消灭敌人，还是丢掉枪换一次越过障碍的移动？」
出處：`sources/text/deckbuilding-dual-use-cards.json` 字元 985-1008 `decisions[0].zh`
顯示：用槍消滅敵人，還是丟掉槍換一次越過障礙的移動？

「把强攻击牌用于普通移动，能否换来更好的下一回合位置？」
出處：`sources/text/deckbuilding-dual-use-cards.json` 字元 1103-1129 `decisions[1].zh`
顯示：把強攻擊牌用於普通移動，能否換來更好的下一回合位置？

## 可調參數

「两用途强度差」
出處：`sources/text/deckbuilding-dual-use-cards.json` 字元 1288-1294 `parameters[0].name.zh`
顯示：兩用途強度差

「一面长期明显更强时，二选一会退化成假选择。」
出處：`sources/text/deckbuilding-dual-use-cards.json` 字元 1378-1399 `parameters[0].effect.zh`
顯示：一面長期明顯更強時，二選一會退化成假選擇。

「使用后的恢复规则」
出處：`sources/text/deckbuilding-dual-use-cards.json` 字元 1521-1529 `parameters[1].name.zh`
顯示：使用後的恢復規則

「永久失去、休息取回和下轮抽回，会改变玩家舍不得用的程度。」
出處：`sources/text/deckbuilding-dual-use-cards.json` 字元 1609-1637 `parameters[1].effect.zh`
顯示：永久失去、休息取回和下輪抽回，會改變玩家捨不得用的程度。

## 原型

「做一个网格小房间，两种卡各有攻击和移动用途；先用回合制验证取舍。」
出處：`sources/text/deckbuilding-dual-use-cards.json` 字元 3049-3081 `prototype.firstStep.zh`
顯示：做一個網格小房間，兩種卡各有攻擊和移動用途；先用回合制驗證取捨。

「同一张牌在不同布局中被用于不同用途，玩家能解释放弃了什么。」
出處：`sources/text/deckbuilding-dual-use-cards.json` 字元 3402-3431 `prototype.test.zh`
顯示：同一張牌在不同佈局中被用於不同用途，玩家能解釋放棄了什麼。

「同时制作高速跑酷、复杂敌人和大量卡牌会掩盖核心二选一。」
出處：`sources/text/deckbuilding-dual-use-cards.json` 字元 3235-3262 `prototype.pitfall.zh`
顯示：同時製作高速跑酷、複雜敵人和大量卡牌會掩蓋核心二選一。

## 相關模式

- [棄牌重抽](deckbuilding-discard-redraw.md)
- [耗盡爆發](deckbuilding-exhaust-for-burst.md)
- [骰子配給](deckbuilding-dice-allocation.md)
- [複製投入](deckbuilding-duplicate-investment.md)

## 參考來源

- [Two competing uses for one card — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-dual-use-cards/) — 查閱：2026-11-02；取得方式：page-text。
