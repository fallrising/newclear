---
{
  "schema_version": 2,
  "id": "survival-safe-water",
  "title": "取水與淨水決策",
  "title_en": "Collecting and purifying water",
  "category": "survival",
  "source_category": "survival",
  "tags": [
    "planning",
    "risk"
  ],
  "summary": "有水可喝，不代表现在喝最划算。",
  "note_status": "draft",
  "related": [
    "survival-bleeding-triage",
    "survival-competing-needs",
    "survival-fatigue-rest",
    "survival-limb-impairment"
  ],
  "sources": [
    {
      "title": "Collecting and purifying water — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/survival-safe-water/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「有水可喝，不代表现在喝最划算。」
出處：`sources/text/survival-safe-water.json` 字元 180-195 `summary.zh`
顯示：有水可喝，不代表現在喝最划算。

## 規則

「玩家找到水源后，选择直接饮用或先花燃料、容器和时间处理。安全水能补充行程，但携带量有限；水质标签和口渴状态让准备程度可见。」
出處：`sources/text/survival-safe-water.json` 字元 297-358 `rules.zh`
顯示：玩家找到水源後，選擇直接飲用或先花燃料、容器和時間處理。安全水能補充行程，但攜帶量有限；水質標籤和口渴狀態讓準備程度可見。

## 核心循環

「找到水源并判断水质」
出處：`sources/text/survival-safe-water.json` 字元 603-612 `loop[0].zh`
顯示：找到水源並判斷水質

「准备容器与处理材料」
出處：`sources/text/survival-safe-water.json` 字元 688-697 `loop[1].zh`
顯示：準備容器與處理材料

「处理并装入随身储备」
出處：`sources/text/survival-safe-water.json` 字元 771-780 `loop[2].zh`
顯示：處理並裝入隨身儲備

「按行程消耗并补充」
出處：`sources/text/survival-safe-water.json` 字元 849-857 `loop[3].zh`
顯示：按行程消耗並補充

## 玩家取捨

「现在很渴时，冒水质风险还是再等一次处理？」
出處：`sources/text/survival-safe-water.json` 字元 959-979 `decisions[0].zh`
顯示：現在很渴時，冒水質風險還是再等一次處理？

「多带水更安全，却挤掉战利品或燃料容量。」
出處：`sources/text/survival-safe-water.json` 字元 1087-1106 `decisions[1].zh`
顯示：多帶水更安全，卻擠掉戰利品或燃料容量。

## 可調參數

「处理耗时」
出處：`sources/text/survival-safe-water.json` 字元 1245-1249 `parameters[0].name.zh`
顯示：處理耗時

「长耗时让净水成为出发前计划；短耗时适合沿途快速补给。」
出處：`sources/text/survival-safe-water.json` 字元 1325-1351 `parameters[0].effect.zh`
顯示：長耗時讓淨水成爲出發前計劃；短耗時適合沿途快速補給。

「水质信息」
出處：`sources/text/survival-safe-water.json` 字元 1495-1499 `parameters[1].name.zh`
顯示：水質信息

「明确标注让风险可计算；模糊信息需要额外线索支持判断。」
出處：`sources/text/survival-safe-water.json` 字元 1580-1606 `parameters[1].effect.zh`
顯示：明確標註讓風險可計算；模糊信息需要額外線索支持判斷。

## 原型

「用三种物品、一个净水按钮和两种水质做一段往返路线。」
出處：`sources/text/survival-safe-water.json` 字元 2914-2939 `prototype.firstStep.zh`
顯示：用三種物品、一個淨水按鈕和兩種水質做一段往返路線。

「给玩家轻量长路与重载短路两种方案，观察是否按供水条件选路。」
出處：`sources/text/survival-safe-water.json` 字元 3229-3258 `prototype.test.zh`
顯示：給玩家輕量長路與重載短路兩種方案，觀察是否按供水條件選路。

「别一开始模拟完整液体系统；先验证准备成本是否改变路线。」
出處：`sources/text/survival-safe-water.json` 字元 3073-3100 `prototype.pitfall.zh`
顯示：別一開始模擬完整液體系統；先驗證準備成本是否改變路線。

## 相關模式

- [失血分診](survival-bleeding-triage.md)
- [競爭需求](survival-competing-needs.md)
- [疲勞休息點](survival-fatigue-rest.md)
- [肢體機能受損](survival-limb-impairment.md)

## 參考來源

- [Collecting and purifying water — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/survival-safe-water/) — 查閱：2026-11-02；取得方式：page-text。
