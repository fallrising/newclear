---
{
  "schema_version": 2,
  "id": "ecology-population-limits",
  "title": "族群限制",
  "title_en": "Control breeding and population size",
  "category": "ecology",
  "source_category": "ecology",
  "tags": [
    "planning",
    "economy",
    "optimization"
  ],
  "summary": "出生是好消息，但下一批幼崽也会占用食物、空间和照料时间。",
  "note_status": "draft",
  "related": [
    "ecology-habitat-capacity",
    "ecology-species-compatibility",
    "automation-aerial-logistics",
    "automation-belt-routing"
  ],
  "sources": [
    {
      "title": "Control breeding and population size — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/ecology-population-limits/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「出生是好消息，但下一批幼崽也会占用食物、空间和照料时间。」
出處：`sources/text/ecology-population-limits.json` 字元 195-223 `summary.zh`
顯示：出生是好消息，但下一批幼崽也會佔用食物、空間和照料時間。

## 規則

「种群会繁殖增长，而承载资源有限。玩家设置保留数量、暂停部分繁殖或转移多余个体，在持续产出与维持可照料规模之间形成长期循环。」
出處：`sources/text/ecology-population-limits.json` 字元 347-408 `rules.zh`
顯示：種羣會繁殖增長，而承載資源有限。玩家設置保留數量、暫停部分繁殖或轉移多餘個體，在持續產出與維持可照料規模之間形成長期循環。

## 核心循環

「估计下一轮出生与消耗」
出處：`sources/text/ecology-population-limits.json` 字元 647-657 `loop[0].zh`
顯示：估計下一輪出生與消耗

「设置保留数量或繁殖开关」
出處：`sources/text/ecology-population-limits.json` 字元 732-743 `loop[1].zh`
顯示：設置保留數量或繁殖開關

「安置或移出新增个体」
出處：`sources/text/ecology-population-limits.json` 字元 829-838 `loop[2].zh`
顯示：安置或移出新增個體

「根据剩余容量再调整」
出處：`sources/text/ecology-population-limits.json` 字元 908-917 `loop[3].zh`
顯示：根據剩餘容量再調整

## 玩家取捨

「现在保留更多幼体准备扩张，还是先把种群控制在当前食物能支持的范围？」
出處：`sources/text/ecology-population-limits.json` 字元 1012-1045 `decisions[0].zh`
顯示：現在保留更多幼體準備擴張，還是先把種羣控制在當前食物能支持的範圍？

「暂停哪一对的繁殖，才不会丢掉之后需要的亲本组合？」
出處：`sources/text/ecology-population-limits.json` 字元 1156-1180 `decisions[1].zh`
顯示：暫停哪一對的繁殖，纔不會丟掉之後需要的親本組合？

## 可調參數

「繁殖速度」
出處：`sources/text/ecology-population-limits.json` 字元 1333-1337 `parameters[0].name.zh`

「出生快于玩家能调整的速度会变成清理负担；预告应留出处理窗口。」
出處：`sources/text/ecology-population-limits.json` 字元 1416-1446 `parameters[0].effect.zh`
顯示：出生快於玩家能調整的速度會變成清理負擔；預告應留出處理窗口。

「数量控制粒度」
出處：`sources/text/ecology-population-limits.json` 字元 1606-1612 `parameters[1].name.zh`
顯示：數量控制粒度

「按物种、年龄或性别管理能减少重复操作，但应保留关键个体的例外。」
出處：`sources/text/ecology-population-limits.json` 字元 1693-1724 `parameters[1].effect.zh`
顯示：按物種、年齡或性別管理能減少重複操作，但應保留關鍵個體的例外。

## 原型

「用一个物种、六个栏位、每轮出生和一个繁殖开关验证循环。」
出處：`sources/text/ecology-population-limits.json` 字元 3145-3172 `prototype.firstStep.zh`
顯示：用一個物種、六個欄位、每輪出生和一個繁殖開關驗證循環。

「连续推进五轮，观察玩家能否提前控制规模而非出生后反复清理。」
出處：`sources/text/ecology-population-limits.json` 字元 3460-3489 `prototype.test.zh`
顯示：連續推進五輪，觀察玩家能否提前控制規模而非出生後反覆清理。

「不要先加完整经济和自动化策略编辑器；先显示未来两轮的数量预告。」
出處：`sources/text/ecology-population-limits.json` 字元 3295-3326 `prototype.pitfall.zh`
顯示：不要先加完整經濟和自動化策略編輯器；先顯示未來兩輪的數量預告。

## 相關模式

- [棲地容量](ecology-habitat-capacity.md)
- [物種共容](ecology-species-compatibility.md)
- [空中搬運物流](automation-aerial-logistics.md)
- [受限空間中的物流路由](automation-belt-routing.md)

## 參考來源

- [Control breeding and population size — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/ecology-population-limits/) — 查閱：2026-11-02；取得方式：page-text。
