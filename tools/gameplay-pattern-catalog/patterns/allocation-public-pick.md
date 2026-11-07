---
{
  "schema_version": 2,
  "id": "allocation-public-pick",
  "title": "公開選取",
  "title_en": "Take one option from a shared pool",
  "category": "allocation",
  "source_category": "allocation",
  "tags": [
    "planning",
    "information"
  ],
  "summary": "自己拿走的东西，也会从别人的选择里消失。",
  "note_status": "draft",
  "related": [
    "allocation-follow-phase",
    "allocation-area-majority",
    "allocation-public-goal-race",
    "allocation-shared-stock"
  ],
  "sources": [
    {
      "title": "Take one option from a shared pool — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/allocation-public-pick/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「自己拿走的东西，也会从别人的选择里消失。」
出處：`sources/text/allocation-public-pick.json` 字元 193-213 `summary.zh`
顯示：自己拿走的東西，也會從別人的選擇裏消失。

## 規則

「所有人面对同一批公开物品，轮到自己时选走一个，再从剩下的内容继续选择。玩家既考虑自身需要，也观察别人最缺什么；先选的优势、后选时的剩余物与补货时机共同改变价值。」
出處：`sources/text/allocation-public-pick.json` 字元 308-388 `rules.zh`
顯示：所有人面對同一批公開物品，輪到自己時選走一個，再從剩下的內容繼續選擇。玩家既考慮自身需要，也觀察別人最缺什麼；先選的優勢、後選時的剩餘物與補貨時機共同改變價值。

## 核心循環

「查看公共选项」
出處：`sources/text/allocation-public-pick.json` 字元 661-667 `loop[0].zh`
顯示：查看公共選項

「比较自己与他人的需要」
出處：`sources/text/allocation-public-pick.json` 字元 737-747 `loop[1].zh`
顯示：比較自己與他人的需要

「选走一个并更新余量」
出處：`sources/text/allocation-public-pick.json` 字元 814-823 `loop[2].zh`
顯示：選走一個並更新餘量

「根据剩余内容调整计划」
出處：`sources/text/allocation-public-pick.json` 字元 895-905 `loop[3].zh`
顯示：根據剩餘內容調整計劃

## 玩家取捨

「先拿最适合自己的，还是先拿对手只差的那一件？」
出處：`sources/text/allocation-public-pick.json` 字元 991-1013 `decisions[0].zh`
顯示：先拿最適合自己的，還是先拿對手只差的那一件？

「某个普通选项很多，是否可以留到下一次再拿？」
出處：`sources/text/allocation-public-pick.json` 字元 1116-1137 `decisions[1].zh`
顯示：某個普通選項很多，是否可以留到下一次再拿？

## 可調參數

「补货频率」
出處：`sources/text/allocation-public-pick.json` 字元 1274-1278 `parameters[0].name.zh`
顯示：補貨頻率

「每人选择后立即补货减弱抢夺，整轮结束才补货强化先后顺序。」
出處：`sources/text/allocation-public-pick.json` 字元 1363-1391 `parameters[0].effect.zh`
顯示：每人選擇後立即補貨減弱搶奪，整輪結束才補貨強化先後順序。

「选择约束」
出處：`sources/text/allocation-public-pick.json` 字元 1545-1549 `parameters[1].name.zh`
顯示：選擇約束

「放置或使用条件会让同一件物品对不同玩家价值不同。」
出處：`sources/text/allocation-public-pick.json` 字元 1627-1651 `parameters[1].effect.zh`
顯示：放置或使用條件會讓同一件物品對不同玩家價值不同。

## 原型

「用三名本地玩家、六张公开牌与两个不同收集目标做一轮轮选。」
出處：`sources/text/allocation-public-pick.json` 字元 3139-3167 `prototype.firstStep.zh`
顯示：用三名本地玩家、六張公開牌與兩個不同收集目標做一輪輪選。

「玩家是否会查看别人的需求，并因此改变自己的选择？」
出處：`sources/text/allocation-public-pick.json` 字元 3425-3449 `prototype.test.zh`
顯示：玩家是否會查看別人的需求，並因此改變自己的選擇？

「不要让所有玩家永远按同一张强度表拿牌。」
出處：`sources/text/allocation-public-pick.json` 字元 3303-3322 `prototype.pitfall.zh`
顯示：不要讓所有玩家永遠按同一張強度表拿牌。

## 相關模式

- [跟進階段](allocation-follow-phase.md)
- [區域多數](allocation-area-majority.md)
- [公開目標競速](allocation-public-goal-race.md)
- [共享人才池的招募](allocation-shared-stock.md)

## 參考來源

- [Take one option from a shared pool — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/allocation-public-pick/) — 查閱：2026-11-02；取得方式：page-text。
