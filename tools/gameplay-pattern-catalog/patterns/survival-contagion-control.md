---
{
  "schema_version": 2,
  "id": "survival-contagion-control",
  "title": "傳染控制",
  "title_en": "Interrupt disease transmission",
  "category": "survival",
  "source_category": "survival",
  "tags": [
    "information",
    "planning"
  ],
  "summary": "处理病人之外，还要找出问题通过接触、食物或空气怎样传过去。",
  "note_status": "draft",
  "related": [
    "building-room-requirements",
    "survival-balanced-nutrition",
    "survival-bleeding-triage",
    "survival-body-inspection"
  ],
  "sources": [
    {
      "title": "Interrupt disease transmission — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/survival-contagion-control/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「处理病人之外，还要找出问题通过接触、食物或空气怎样传过去。」
出處：`sources/text/survival-contagion-control.json` 字元 188-217 `summary.zh`
顯示：處理病人之外，還要找出問題通過接觸、食物或空氣怎樣傳過去。

## 規則

「疾病按明确路径传播，隔离或清洁只对对应路径有效。玩家先定位传播链，再改变接触、物流或设施安排，并等待后续病例验证措施是否有效。」
出處：`sources/text/survival-contagion-control.json` 字元 344-407 `rules.zh`
顯示：疾病按明確路徑傳播，隔離或清潔只對對應路徑有效。玩家先定位傳播鏈，再改變接觸、物流或設施安排，並等待後續病例驗證措施是否有效。

## 核心循環

「发现病例并追踪共同接触」
出處：`sources/text/survival-contagion-control.json` 字元 650-661 `loop[0].zh`
顯示：發現病例並追蹤共同接觸

「判断实际传播路径」
出處：`sources/text/survival-contagion-control.json` 字元 735-743 `loop[1].zh`
顯示：判斷實際傳播路徑

「隔离接触或清洁污染链」
出處：`sources/text/survival-contagion-control.json` 字元 818-828 `loop[2].zh`
顯示：隔離接觸或清潔污染鏈

「监测新病例并调整」
出處：`sources/text/survival-contagion-control.json` 字元 908-916 `loop[3].zh`
顯示：監測新病例並調整

## 玩家取捨

「先暂停生产找源头，还是维持供给并保护关键人员？」
出處：`sources/text/survival-contagion-control.json` 字元 1009-1032 `decisions[0].zh`
顯示：先暫停生產找源頭，還是維持供給並保護關鍵人員？

「有限空间用来隔离个体，还是改造共用设施？」
出處：`sources/text/survival-contagion-control.json` 字元 1161-1181 `decisions[1].zh`
顯示：有限空間用來隔離個體，還是改造共用設施？

## 可調參數

「传播路径数量」
出處：`sources/text/survival-contagion-control.json` 字元 1325-1331 `parameters[0].name.zh`
顯示：傳播路徑數量

「一条可解释路径就能成立；增加路径必须提供可追踪证据。」
出處：`sources/text/survival-contagion-control.json` 字元 1404-1430 `parameters[0].effect.zh`
顯示：一條可解釋路徑就能成立；增加路徑必須提供可追蹤證據。

「症状延迟」
出處：`sources/text/survival-contagion-control.json` 字元 1578-1582 `parameters[1].name.zh`
顯示：症狀延遲

「延迟让追踪更有挑战，但过长且无日志会使玩家无法建立因果。」
出處：`sources/text/survival-contagion-control.json` 字元 1657-1685 `parameters[1].effect.zh`
顯示：延遲讓追蹤更有挑戰，但過長且無日誌會使玩家無法建立因果。

## 原型

「先做五个角色、一条经食物传播的路径和可查看的接触日志。」
出處：`sources/text/survival-contagion-control.json` 字元 3083-3110 `prototype.firstStep.zh`
顯示：先做五個角色、一條經食物傳播的路徑和可查看的接觸日誌。

「给一次污染事件，观察玩家能否找对源头，并用后续无新病例验证措施。」
出處：`sources/text/survival-contagion-control.json` 字元 3418-3450 `prototype.test.zh`
顯示：給一次污染事件，觀察玩家能否找對源頭，並用後續無新病例驗證措施。

「不要同时模拟空气、接触、潜伏与变异；先证明玩家能找出一条传播链。」
出處：`sources/text/survival-contagion-control.json` 字元 3233-3265 `prototype.pitfall.zh`
顯示：不要同時模擬空氣、接觸、潛伏與變異；先證明玩家能找出一條傳播鏈。

## 相關模式

- [房間需求條件](building-room-requirements.md)
- [均衡營養](survival-balanced-nutrition.md)
- [失血分診](survival-bleeding-triage.md)
- [檢查身體找出問題](survival-body-inspection.md)

## 參考來源

- [Interrupt disease transmission — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/survival-contagion-control/) — 查閱：2026-11-02；取得方式：page-text。
