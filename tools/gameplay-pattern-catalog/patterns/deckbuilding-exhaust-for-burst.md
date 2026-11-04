---
{
  "schema_version": 2,
  "id": "deckbuilding-exhaust-for-burst",
  "title": "耗盡爆發",
  "title_en": "Powerful cards spent for the fight",
  "category": "deckbuilding",
  "source_category": "deckbuilding",
  "tags": [
    "risk",
    "timing",
    "planning"
  ],
  "summary": "先打出强力效果，代价是这场战斗后面再也抽不到它。",
  "note_status": "draft",
  "related": [
    "combat-stamina-budget",
    "deckbuilding-discard-redraw",
    "deckbuilding-dual-use-cards",
    "combat-cover-flanking"
  ],
  "sources": [
    {
      "title": "Powerful cards spent for the fight — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-exhaust-for-burst/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先打出强力效果，代价是这场战斗后面再也抽不到它。」
出處：`sources/text/deckbuilding-exhaust-for-burst.json` 字元 202-226 `summary.zh`
顯示：先打出強力效果，代價是這場戰鬥後面再也抽不到它。

## 規則

「带有消耗标记的牌打出后进入本场战斗的移除区，不跟弃牌一起洗回。玩家必须判断当前危机是否值得花掉它；战斗结束后恢复到原牌库，和永久删牌分开处理。」
出處：`sources/text/deckbuilding-exhaust-for-burst.json` 字元 352-423 `rules.zh`
顯示：帶有消耗標記的牌打出後進入本場戰鬥的移除區，不跟棄牌一起洗回。玩家必須判斷當前危機是否值得花掉它；戰鬥結束後恢復到原牌庫，和永久刪牌分開處理。

## 核心循環

「识别最危险回合」
出處：`sources/text/deckbuilding-exhaust-for-burst.json` 字元 679-686 `loop[0].zh`
顯示：識別最危險回合

「决定是否消耗强牌」
出處：`sources/text/deckbuilding-exhaust-for-burst.json` 字元 757-765 `loop[1].zh`
顯示：決定是否消耗強牌

「结算一次性效果」
出處：`sources/text/deckbuilding-exhaust-for-burst.json` 字元 841-848 `loop[2].zh`
顯示：結算一次性效果

「用剩余牌撑到结束」
出處：`sources/text/deckbuilding-exhaust-for-burst.json` 字元 918-926 `loop[3].zh`
顯示：用剩餘牌撐到結束

## 玩家取捨

「现在保命，还是留给已经预告的首领大招？」
出處：`sources/text/deckbuilding-exhaust-for-burst.json` 字元 1021-1040 `decisions[0].zh`
顯示：現在保命，還是留給已經預告的首領大招？

「消耗一张辅助牌后牌库更精简，但还能应付后续变化吗？」
出處：`sources/text/deckbuilding-exhaust-for-burst.json` 字元 1138-1163 `decisions[1].zh`
顯示：消耗一張輔助牌後牌庫更精簡，但還能應付後續變化嗎？

## 可調參數

「单次效果强度」
出處：`sources/text/deckbuilding-exhaust-for-burst.json` 字元 1312-1318 `parameters[0].name.zh`
顯示：單次效果強度

「越强越有救场感，也越容易让普通牌失去作用。」
出處：`sources/text/deckbuilding-exhaust-for-burst.json` 字元 1396-1417 `parameters[0].effect.zh`
顯示：越強越有救場感，也越容易讓普通牌失去作用。

「预计战斗长度」
出處：`sources/text/deckbuilding-exhaust-for-burst.json` 字元 1557-1563 `parameters[1].name.zh`
顯示：預計戰鬥長度

「战斗越长，失去重复使用机会的代价越明显。」
出處：`sources/text/deckbuilding-exhaust-for-burst.json` 字元 1646-1666 `parameters[1].effect.zh`
顯示：戰鬥越長，失去重複使用機會的代價越明顯。

## 原型

「只做抽牌、弃牌和消耗三个区，再加一张明显值得保留的救命牌。」
出處：`sources/text/deckbuilding-exhaust-for-burst.json` 字元 2991-3020 `prototype.firstStep.zh`
顯示：只做抽牌、棄牌和消耗三個區，再加一張明顯值得保留的救命牌。

「玩家首次使用后能准确说出它何时回来，并会为了未来威胁保留它。」
出處：`sources/text/deckbuilding-exhaust-for-burst.json` 字元 3309-3339 `prototype.test.zh`
顯示：玩家首次使用後能準確說出它何時回來，並會爲了未來威脅保留它。

「不要把永久删牌和本战消耗放在同一个按钮或同一种提示中。」
出處：`sources/text/deckbuilding-exhaust-for-burst.json` 字元 3154-3181 `prototype.pitfall.zh`
顯示：不要把永久刪牌和本戰消耗放在同一個按鈕或同一種提示中。

## 相關模式

- [攻守共用資源預算](combat-stamina-budget.md)
- [棄牌重抽](deckbuilding-discard-redraw.md)
- [同一張牌的兩種用途](deckbuilding-dual-use-cards.md)
- [掩體側擊](combat-cover-flanking.md)

## 參考來源

- [Powerful cards spent for the fight — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-exhaust-for-burst/) — 查閱：2026-11-02；取得方式：page-text。
