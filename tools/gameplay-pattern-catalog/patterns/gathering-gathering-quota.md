---
{
  "schema_version": 2,
  "id": "gathering-gathering-quota",
  "title": "採集配額決策",
  "title_en": "Gathering quotas and stopping decisions",
  "category": "gathering",
  "source_category": "gathering",
  "tags": [
    "risk",
    "planning",
    "optimization"
  ],
  "summary": "数量目标已经达成，接下来这一镐还值不值得？",
  "note_status": "draft",
  "related": [
    "gathering-depth-targeting",
    "gathering-oxygen-gathering",
    "gathering-salvage-dismantling",
    "gathering-supply-mining"
  ],
  "sources": [
    {
      "title": "Gathering quotas and stopping decisions — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/gathering-gathering-quota/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「数量目标已经达成，接下来这一镐还值不值得？」
出處：`sources/text/gathering-gathering-quota.json` 字元 198-219 `summary.zh`
顯示：數量目標已經達成，接下來這一鎬還值不值得？

## 規則

「采集目标以所需数量和进度计数器明确反馈。达标后玩家可以停止采集、返程交付或启动撤离，也可以继续获取额外材料；关键取舍是下一份收获是否值得剩余时间与补给。」
出處：`sources/text/gathering-gathering-quota.json` 字元 326-402 `rules.zh`
顯示：採集目標以所需數量和進度計數器明確反饋。達標後玩家可以停止採集、返程交付或啓動撤離，也可以繼續獲取額外材料；關鍵取捨是下一份收穫是否值得剩餘時間與補給。

## 核心循環

「确定目标数量」
出處：`sources/text/gathering-gathering-quota.json` 字元 721-727 `loop[0].zh`
顯示：確定目標數量

「采集并观察计数」
出處：`sources/text/gathering-gathering-quota.json` 字元 796-803 `loop[1].zh`
顯示：採集並觀察計數

「确认配额达成」
出處：`sources/text/gathering-gathering-quota.json` 字元 872-878 `loop[2].zh`
顯示：確認配額達成

「继续采集或收手返程」
出處：`sources/text/gathering-gathering-quota.json` 字元 946-955 `loop[3].zh`
顯示：繼續採集或收手返程

## 玩家取捨

「达标后，眼前额外资源的价值能抵偿绕路和消耗吗？」
出處：`sources/text/gathering-gathering-quota.json` 字元 1053-1076 `decisions[0].zh`
顯示：達標後，眼前額外資源的價值能抵償繞路和消耗嗎？

「剩余时间与补给够拿下一处资源再返回吗？」
出處：`sources/text/gathering-gathering-quota.json` 字元 1205-1224 `decisions[1].zh`
顯示：剩餘時間與補給夠拿下一處資源再返回嗎？

## 可調參數

「配额大小」
出處：`sources/text/gathering-gathering-quota.json` 字元 1377-1381 `parameters[0].name.zh`
顯示：配額大小

「小配额让玩家频繁决定是否收手；大配额强调连续采集路线与补给规划。」
出處：`sources/text/gathering-gathering-quota.json` 字元 1453-1485 `parameters[0].effect.zh`
顯示：小配額讓玩家頻繁決定是否收手；大配額強調連續採集路線與補給規劃。

「额外资源价值」
出處：`sources/text/gathering-gathering-quota.json` 字元 1666-1672 `parameters[1].name.zh`
顯示：額外資源價值

「超额收获仍有用会鼓励继续采集；价值低则促使达标后尽快返回。」
出處：`sources/text/gathering-gathering-quota.json` 字元 1760-1789 `parameters[1].effect.zh`
顯示：超額收穫仍有用會鼓勵繼續採集；價值低則促使達標後儘快返回。

## 原型

「做一个明确数量目标、两个额外资源点和不断缩减的行动预算。」
出處：`sources/text/gathering-gathering-quota.json` 字元 3483-3511 `prototype.firstStep.zh`
顯示：做一個明確數量目標、兩個額外資源點和不斷縮減的行動預算。

「用两种不同返程风险测试，看玩家是否会在同样达标时做出不同选择。」
出處：`sources/text/gathering-gathering-quota.json` 字元 3825-3856 `prototype.test.zh`
顯示：用兩種不同返程風險測試，看玩家是否會在同樣達標時做出不同選擇。

「若达标后继续采没有任何风险或成本，“是否收手”就只剩假选择。」
出處：`sources/text/gathering-gathering-quota.json` 字元 3649-3679 `prototype.pitfall.zh`
顯示：若達標後繼續採沒有任何風險或成本，“是否收手”就只剩假選擇。

## 相關模式

- [深度鎖定層](gathering-depth-targeting.md)
- [氧氣採集決策](gathering-oxygen-gathering.md)
- [拆件拆解](gathering-salvage-dismantling.md)
- [供給開採](gathering-supply-mining.md)

## 參考來源

- [Gathering quotas and stopping decisions — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/gathering-gathering-quota/) — 查閱：2026-11-02；取得方式：page-text。
