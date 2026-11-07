---
{
  "schema_version": 2,
  "id": "movement-moving-platform",
  "title": "移動平台時機",
  "title_en": "Time boarding and leaving a moving platform",
  "category": "movement",
  "source_category": "movement",
  "tags": [
    "timing",
    "spatial",
    "planning"
  ],
  "summary": "落脚处会移动，什么时候上去和离开都要判断。",
  "note_status": "draft",
  "related": [
    "exploration-air-action-refill",
    "exploration-climbing-rest-route",
    "exploration-gliding-descent",
    "exploration-grapple-swing"
  ],
  "sources": [
    {
      "title": "Time boarding and leaving a moving platform — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/movement-moving-platform/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「落脚处会移动，什么时候上去和离开都要判断。」
出處：`sources/text/movement-moving-platform.json` 字元 203-224 `summary.zh`
顯示：落腳處會移動，什麼時候上去和離開都要判斷。

## 規則

「平台按可观察的路线移动，或在玩家登上后启动。玩家需要先选上台时机，再利用平台接近目的地；跳出时平台与目标的相对位置决定能否落稳，等待也可能暴露于危险。」
出處：`sources/text/movement-moving-platform.json` 字元 336-411 `rules.zh`
顯示：平臺按可觀察的路線移動，或在玩家登上後啓動。玩家需要先選上臺時機，再利用平臺接近目的地；跳出時平臺與目標的相對位置決定能否落穩，等待也可能暴露於危險。

## 核心循環

「观察平台路线」
出處：`sources/text/movement-moving-platform.json` 字元 689-695 `loop[0].zh`
顯示：觀察平臺路線

「抓住上台时机」
出處：`sources/text/movement-moving-platform.json` 字元 765-771 `loop[1].zh`
顯示：抓住上臺時機

「随平台接近落点」
出處：`sources/text/movement-moving-platform.json` 字元 839-846 `loop[2].zh`
顯示：隨平臺接近落點

「跳出并衔接下一段」
出處：`sources/text/movement-moving-platform.json` 字元 917-925 `loop[3].zh`
顯示：跳出並銜接下一段

## 玩家取捨

「现在勉强够得到平台，还是等它靠近再上去？」
出處：`sources/text/movement-moving-platform.json` 字元 1008-1028 `decisions[0].zh`
顯示：現在勉強夠得到平臺，還是等它靠近再上去？

「在平台到顶前提早跳走，还是等距离最短但危险更近的时候？」
出處：`sources/text/movement-moving-platform.json` 字元 1142-1169 `decisions[1].zh`
顯示：在平臺到頂前提早跳走，還是等距離最短但危險更近的時候？

## 可調參數

「移动周期与停留」
出處：`sources/text/movement-moving-platform.json` 字元 1349-1356 `parameters[0].name.zh`
顯示：移動週期與停留

「停留时间越长越容易上台；不停移动更强调提前判断。」
出處：`sources/text/movement-moving-platform.json` 字元 1441-1465 `parameters[0].effect.zh`
顯示：停留時間越長越容易上臺；不停移動更強調提前判斷。

「平台与目标的间距」
出處：`sources/text/movement-moving-platform.json` 字元 1607-1615 `parameters[1].name.zh`
顯示：平臺與目標的間距

「最近距离决定基本可达性，沿途间距变化决定提前跳走是否值得。」
出處：`sources/text/movement-moving-platform.json` 字元 1704-1733 `parameters[1].effect.zh`
顯示：最近距離決定基本可達性，沿途間距變化決定提前跳走是否值得。

## 原型

「只做一块两点往返的平台、两个固定落点和一处危险，显示清楚的行进轨迹。」
出處：`sources/text/movement-moving-platform.json` 字元 3408-3442 `prototype.firstStep.zh`
顯示：只做一塊兩點往返的平臺、兩個固定落點和一處危險，顯示清楚的行進軌跡。

「检查玩家能否在不试跳的情况下指出下一个上台窗口，以及哪一段最适合离开。」
出處：`sources/text/movement-moving-platform.json` 字元 3798-3833 `prototype.test.zh`
顯示：檢查玩家能否在不試跳的情況下指出下一個上臺窗口，以及哪一段最適合離開。

「角色站在平台上抖动或被错误甩走会掩盖选择本身，先保证承载与离开规则稳定。」
出處：`sources/text/movement-moving-platform.json` 字元 3605-3641 `prototype.pitfall.zh`
顯示：角色站在平臺上抖動或被錯誤甩走會掩蓋選擇本身，先保證承載與離開規則穩定。

## 相關模式

- [空中行動回補](exploration-air-action-refill.md)
- [攀爬休息點路線](exploration-climbing-rest-route.md)
- [滑翔下降](exploration-gliding-descent.md)
- [鉤索擺盪決策](exploration-grapple-swing.md)

## 參考來源

- [Time boarding and leaving a moving platform — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/movement-moving-platform/) — 查閱：2026-11-02；取得方式：page-text。
