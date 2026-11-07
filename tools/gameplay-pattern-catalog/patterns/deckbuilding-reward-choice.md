---
{
  "schema_version": 2,
  "id": "deckbuilding-reward-choice",
  "title": "獎勵選擇",
  "title_en": "Drafting rewards and skipping",
  "category": "deckbuilding",
  "source_category": "deckbuilding",
  "tags": [
    "planning",
    "randomness",
    "optimization"
  ],
  "summary": "赢了以后选一张牌，也可以为了稳定抽牌什么都不拿。",
  "note_status": "draft",
  "related": [
    "deckbuilding-dice-allocation",
    "combat-combat-deck-cycle",
    "deckbuilding-discard-redraw",
    "deckbuilding-duplicate-investment"
  ],
  "sources": [
    {
      "title": "Drafting rewards and skipping — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-reward-choice/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「赢了以后选一张牌，也可以为了稳定抽牌什么都不拿。」
出處：`sources/text/deckbuilding-reward-choice.json` 字元 190-214 `summary.zh`
顯示：贏了以後選一張牌，也可以爲了穩定抽牌什麼都不拿。

## 規則

「每次过关给出少量候选牌，玩家选一张加入现有牌库，也可以跳过。新牌能补足短板，但会占用以后抽牌的位置；反馈来自下一战是否更容易抽到需要的牌。」
出處：`sources/text/deckbuilding-reward-choice.json` 字元 336-405 `rules.zh`
顯示：每次過關給出少量候選牌，玩家選一張加入現有牌庫，也可以跳過。新牌能補足短板，但會佔用以後抽牌的位置；反饋來自下一戰是否更容易抽到需要的牌。

## 核心循環

「发现牌组缺口」
出處：`sources/text/deckbuilding-reward-choice.json` 字元 623-629 `loop[0].zh`
顯示：發現牌組缺口

「比较本次奖励」
出處：`sources/text/deckbuilding-reward-choice.json` 字元 696-702 `loop[1].zh`
顯示：比較本次獎勵

「选一张或跳过」
出處：`sources/text/deckbuilding-reward-choice.json` 字元 771-777 `loop[2].zh`
顯示：選一張或跳過

「在下一战验证」
出處：`sources/text/deckbuilding-reward-choice.json` 字元 837-843 `loop[3].zh`
顯示：在下一戰驗證

## 玩家取捨

「现在缺防守，还是只想追求一张更强的攻击？奖励必须解决真实问题。」
出處：`sources/text/deckbuilding-reward-choice.json` 字元 937-968 `decisions[0].zh`
顯示：現在缺防守，還是隻想追求一張更強的攻擊？獎勵必須解決真實問題。

「选一张以后可能有用的牌，还是保留当前抽牌的稳定性？」
出處：`sources/text/deckbuilding-reward-choice.json` 字元 1081-1106 `decisions[1].zh`
顯示：選一張以後可能有用的牌，還是保留當前抽牌的穩定性？

## 可調參數

「候选数量」
出處：`sources/text/deckbuilding-reward-choice.json` 字元 1242-1246 `parameters[0].name.zh`
顯示：候選數量

「越多越容易补齐需求，也越容易每局重复同一种组合。」
出處：`sources/text/deckbuilding-reward-choice.json` 字元 1318-1342 `parameters[0].effect.zh`
顯示：越多越容易補齊需求，也越容易每局重複同一種組合。

「初始牌库大小」
出處：`sources/text/deckbuilding-reward-choice.json` 字元 1471-1477 `parameters[1].name.zh`
顯示：初始牌庫大小

「牌越少，新加入的一张越容易改变抽牌节奏。」
出處：`sources/text/deckbuilding-reward-choice.json` 字元 1557-1577 `parameters[1].effect.zh`
顯示：牌越少，新加入的一張越容易改變抽牌節奏。

## 原型

「先做六张起始牌、六种奖励和三场固定战斗，奖励界面保留跳过按钮。」
出處：`sources/text/deckbuilding-reward-choice.json` 字元 2964-2995 `prototype.firstStep.zh`
顯示：先做六張起始牌、六種獎勵和三場固定戰鬥，獎勵界面保留跳過按鈕。

「试玩者能说出至少一次拿牌理由与一次跳过理由，而不是永远点稀有牌。」
出處：`sources/text/deckbuilding-reward-choice.json` 字元 3305-3337 `prototype.test.zh`
顯示：試玩者能說出至少一次拿牌理由與一次跳過理由，而不是永遠點稀有牌。

「不要先扩成上百张牌；先验证奖励中是否经常存在有理由的取舍。」
出處：`sources/text/deckbuilding-reward-choice.json` 字元 3150-3179 `prototype.pitfall.zh`
顯示：不要先擴成上百張牌；先驗證獎勵中是否經常存在有理由的取捨。

## 相關模式

- [骰子配給](deckbuilding-dice-allocation.md)
- [戰鬥牌組循環](combat-combat-deck-cycle.md)
- [棄牌重抽](deckbuilding-discard-redraw.md)
- [複製投入](deckbuilding-duplicate-investment.md)

## 參考來源

- [Drafting rewards and skipping — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-reward-choice/) — 查閱：2026-11-02；取得方式：page-text。
