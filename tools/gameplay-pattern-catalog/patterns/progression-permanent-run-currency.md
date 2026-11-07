---
{
  "schema_version": 2,
  "id": "progression-permanent-run-currency",
  "title": "跨局保留的永久貨幣",
  "title_en": "Persistent currency between attempts",
  "category": "progression",
  "source_category": "progression",
  "tags": [
    "progression",
    "economy",
    "risk"
  ],
  "summary": "这一趟没通关，也能为下一趟留下可用的提升。",
  "note_status": "draft",
  "related": [
    "progression-challenge-tiers",
    "progression-death-loses-training",
    "progression-prestige-reset",
    "progression-research-prerequisites"
  ],
  "sources": [
    {
      "title": "Persistent currency between attempts — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/progression-permanent-run-currency/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「这一趟没通关，也能为下一趟留下可用的提升。」
出處：`sources/text/progression-permanent-run-currency.json` 字元 207-228 `summary.zh`
顯示：這一趟沒通關，也能爲下一趟留下可用的提升。

## 規則

「每次尝试中获得一种能跨局保留的资源，结束后用它购买长期提升。玩家在单次成功之外还有一个较小目标：把资源转成下一次更好的起点；局内临时收益要与永久资源清楚区分。」
出處：`sources/text/progression-permanent-run-currency.json` 字元 325-404 `rules.zh`
顯示：每次嘗試中獲得一種能跨局保留的資源，結束後用它購買長期提升。玩家在單次成功之外還有一個較小目標：把資源轉成下一次更好的起點；局內臨時收益要與永久資源清楚區分。

## 核心循環

「进入一次挑战」
出處：`sources/text/progression-permanent-run-currency.json` 字元 686-692 `loop[0].zh`
顯示：進入一次挑戰

「积累可保留资源」
出處：`sources/text/progression-permanent-run-currency.json` 字元 752-759 `loop[1].zh`
顯示：積累可保留資源

「结束后购买长期提升」
出處：`sources/text/progression-permanent-run-currency.json` 字元 828-837 `loop[2].zh`
顯示：結束後購買長期提升

「带着新起点再试」
出處：`sources/text/progression-permanent-run-currency.json` 字元 905-912 `loop[3].zh`
顯示：帶着新起點再試

## 玩家取捨

「这次争取过关，还是走更容易拿成长资源的路线？」
出處：`sources/text/progression-permanent-run-currency.json` 字元 1002-1024 `decisions[0].zh`
顯示：這次爭取過關，還是走更容易拿成長資源的路線？

「买便宜的即时提升，还是攒钱等待能改变打法的大升级？」
出處：`sources/text/progression-permanent-run-currency.json` 字元 1126-1151 `decisions[1].zh`
顯示：買便宜的即時提升，還是攢錢等待能改變打法的大升級？

## 可調參數

「失败时保留比例」
出處：`sources/text/progression-permanent-run-currency.json` 字元 1301-1308 `parameters[0].name.zh`
顯示：失敗時保留比例

「保留越多，失败越少白费；太高也可能让快速送死变得划算。」
出處：`sources/text/progression-permanent-run-currency.json` 字元 1390-1417 `parameters[0].effect.zh`
顯示：保留越多，失敗越少白費；太高也可能讓快速送死變得划算。

「升级对起点的影响」
出處：`sources/text/progression-permanent-run-currency.json` 字元 1569-1577 `parameters[1].name.zh`
顯示：升級對起點的影響

「提升过大，会让前期挑战变成重复劳动；提升过小又难感到进步。」
出處：`sources/text/progression-permanent-run-currency.json` 字元 1657-1686 `parameters[1].effect.zh`
顯示：提升過大，會讓前期挑戰變成重複勞動；提升過小又難感到進步。

## 原型

「做一个短关卡、一种跨局资源和两个永久升级；失败后直接进入购买页。」
出處：`sources/text/progression-permanent-run-currency.json` 字元 3205-3237 `prototype.firstStep.zh`
顯示：做一個短關卡、一種跨局資源和兩個永久升級；失敗後直接進入購買頁。

「失败后玩家是否能说出本次留下了什么，并主动选择下一次目标？」
出處：`sources/text/progression-permanent-run-currency.json` 字元 3570-3599 `prototype.test.zh`
顯示：失敗後玩家是否能說出本次留下了什麼，並主動選擇下一次目標？

「先别做无限升级；避免玩家必须刷很多次才能体验基础操作。」
出處：`sources/text/progression-permanent-run-currency.json` 字元 3398-3425 `prototype.pitfall.zh`
顯示：先別做無限升級；避免玩家必須刷很多次才能體驗基礎操作。

## 相關模式

- [挑戰層級](progression-challenge-tiers.md)
- [死亡失去訓練](progression-death-loses-training.md)
- [以重置換取加速](progression-prestige-reset.md)
- [研究前置](progression-research-prerequisites.md)

## 參考來源

- [Persistent currency between attempts — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/progression-permanent-run-currency/) — 查閱：2026-11-02；取得方式：page-text。
