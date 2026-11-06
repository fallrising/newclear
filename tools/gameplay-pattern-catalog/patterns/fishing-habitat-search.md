---
{
  "schema_version": 2,
  "id": "fishing-habitat-search",
  "title": "棲地搜尋",
  "title_en": "Finding fish habitats",
  "category": "fishing",
  "source_category": "fishing",
  "tags": [
    "discovery",
    "information",
    "planning"
  ],
  "summary": "把“去哪钓”做成有证据可推断的探索问题。",
  "note_status": "draft",
  "related": [
    "exploration-earned-map",
    "building-room-requirements",
    "exploration-ability-gates",
    "exploration-fast-travel-network"
  ],
  "sources": [
    {
      "title": "Finding fish habitats — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/fishing-habitat-search/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把“去哪钓”做成有证据可推断的探索问题。」
出處：`sources/text/fishing-habitat-search.json` 字元 173-193 `summary.zh`
顯示：把“去哪釣”做成有證據可推斷的探索問題。

## 規則

「玩家根据鱼种的地点、时间和环境条件寻找合适钓点，再用捕获结果更新认知。只提高操作熟练度无法弥补错误环境；图鉴和线索把反复试探变成知识积累。」
出處：`sources/text/fishing-habitat-search.json` 字元 309-378 `rules.zh`
顯示：玩家根據魚種的地點、時間和環境條件尋找合適釣點，再用捕獲結果更新認知。只提高操作熟練度無法彌補錯誤環境；圖鑑和線索把反覆試探變成知識積累。

## 核心循環

「选择目标鱼种」
出處：`sources/text/fishing-habitat-search.json` 字元 636-642 `loop[0].zh`
顯示：選擇目標魚種

「整理环境线索」
出處：`sources/text/fishing-habitat-search.json` 字元 709-715 `loop[1].zh`
顯示：整理環境線索

「前往匹配地点试钓」
出處：`sources/text/fishing-habitat-search.json` 字元 780-788 `loop[2].zh`
顯示：前往匹配地點試釣

「记录结果并缩小范围」
出處：`sources/text/fishing-habitat-search.json` 字元 856-865 `loop[3].zh`
顯示：記錄結果並縮小範圍

## 玩家取捨

「等待已知的正确时间，还是先探查未知水域，形成确定性与发现的取舍。」
出處：`sources/text/fishing-habitat-search.json` 字元 966-998 `decisions[0].zh`
顯示：等待已知的正確時間，還是先探查未知水域，形成確定性與發現的取捨。

「连续没钓到目标时，是继续投入时间，还是根据地点、天气或时段换一个条件试试？」
出處：`sources/text/fishing-habitat-search.json` 字元 1116-1153 `decisions[1].zh`
顯示：連續沒釣到目標時，是繼續投入時間，還是根據地點、天氣或時段換一個條件試試？

## 可調參數

「条件组合数」
出處：`sources/text/fishing-habitat-search.json` 字元 1330-1335 `parameters[0].name.zh`
顯示：條件組合數

「地点、天气、时段叠加越多，规划越复杂，也越需要清晰记录。」
出處：`sources/text/fishing-habitat-search.json` 字元 1417-1445 `parameters[0].effect.zh`
顯示：地點、天氣、時段疊加越多，規劃越複雜，也越需要清晰記錄。

「失败信息量」
出處：`sources/text/fishing-habitat-search.json` 字元 1603-1608 `parameters[1].name.zh`
顯示：失敗信息量

「明确反馈不符条件可减少盲试，完全随机则更难学习。」
出處：`sources/text/fishing-habitat-search.json` 字元 1694-1718 `parameters[1].effect.zh`
顯示：明確反饋不符條件可減少盲試，完全隨機則更難學習。

## 原型

「先做3个钓点、2种天气和少量鱼种条件，用地点选择页即可测试。」
出處：`sources/text/fishing-habitat-search.json` 字元 3222-3252 `prototype.firstStep.zh`
顯示：先做3個釣點、2種天氣和少量魚種條件，用地點選擇頁即可測試。

「给两次失败记录后，玩家能否提出明确的新钓点或新时段，而非继续原地重复？」
出處：`sources/text/fishing-habitat-search.json` 字元 3605-3640 `prototype.test.zh`
顯示：給兩次失敗記錄後，玩家能否提出明確的新釣點或新時段，而非繼續原地重複？

「不要同时隐藏太多条件；玩家需要能把捕获结果归因到某个可观察变化。」
出處：`sources/text/fishing-habitat-search.json` 字元 3423-3455 `prototype.pitfall.zh`
顯示：不要同時隱藏太多條件；玩家需要能把捕獲結果歸因到某個可觀察變化。

## 相關模式

- [掙得地圖](exploration-earned-map.md)
- [房間需求條件](building-room-requirements.md)
- [能力解鎖與回訪](exploration-ability-gates.md)
- [快速旅行網路](exploration-fast-travel-network.md)

## 參考來源

- [Finding fish habitats — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/fishing-habitat-search/) — 查閱：2026-11-02；取得方式：page-text。
