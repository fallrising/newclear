---
{
  "schema_version": 2,
  "id": "gathering-renewable-forage-route",
  "title": "再生資源採食路線",
  "title_en": "Revisiting renewable forage",
  "category": "gathering",
  "source_category": "gathering",
  "tags": [
    "time",
    "planning",
    "discovery"
  ],
  "summary": "记住资源何时回来，把地图变成有节奏的采集路线。",
  "note_status": "draft",
  "related": [
    "gathering-depth-targeting",
    "gathering-oxygen-gathering",
    "gathering-tool-hardness",
    "commerce-timed-contracts"
  ],
  "sources": [
    {
      "title": "Revisiting renewable forage — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/gathering-renewable-forage-route/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「记住资源何时回来，把地图变成有节奏的采集路线。」
出處：`sources/text/gathering-renewable-forage-route.json` 字元 190-213 `summary.zh`
顯示：記住資源何時回來，把地圖變成有節奏的採集路線。

## 規則

「野外资源被采集后会在规则允许时再生，位置或刷新范围可被玩家记住。玩家根据再生周期和移动成本安排复访，避免过早空跑或错过季节性的高产期。」
出處：`sources/text/gathering-renewable-forage-route.json` 字元 336-403 `rules.zh`
顯示：野外資源被採集後會在規則允許時再生，位置或刷新範圍可被玩家記住。玩家根據再生週期和移動成本安排復訪，避免過早空跑或錯過季節性的高產期。

## 核心循環

「记录有效采集点」
出處：`sources/text/gathering-renewable-forage-route.json` 字元 681-688 `loop[0].zh`
顯示：記錄有效採集點

「收集当前产出」
出處：`sources/text/gathering-renewable-forage-route.json` 字元 755-761 `loop[1].zh`
顯示：收集當前產出

「等待或做其他事」
出處：`sources/text/gathering-renewable-forage-route.json` 字元 827-834 `loop[2].zh`

「按周期复访」
出處：`sources/text/gathering-renewable-forage-route.json` 字元 905-910 `loop[3].zh`
顯示：按週期復訪

## 玩家取捨

「固定巡回路线可靠，还是去未探索区域寻找更好点位？」
出處：`sources/text/gathering-renewable-forage-route.json` 字元 1005-1029 `decisions[0].zh`
顯示：固定巡迴路線可靠，還是去未探索區域尋找更好點位？

「现在去少拿一点，还是等多个点同时成熟再出发？」
出處：`sources/text/gathering-renewable-forage-route.json` 字元 1127-1149 `decisions[1].zh`
顯示：現在去少拿一點，還是等多個點同時成熟再出發？

## 可調參數

「再生周期」
出處：`sources/text/gathering-renewable-forage-route.json` 字元 1303-1307 `parameters[0].name.zh`
顯示：再生週期

「固定周期容易形成计划；波动周期增加路线冗余需求。」
出處：`sources/text/gathering-renewable-forage-route.json` 字元 1386-1410 `parameters[0].effect.zh`
顯示：固定週期容易形成計劃；波動週期增加路線冗餘需求。

「季节依赖」
出處：`sources/text/gathering-renewable-forage-route.json` 字元 1554-1558 `parameters[1].name.zh`
顯示：季節依賴

「强季节性迫使换路线和储备；常年刷新更适合稳定日常。」
出處：`sources/text/gathering-renewable-forage-route.json` 字元 1637-1662 `parameters[1].effect.zh`
顯示：強季節性迫使換路線和儲備；常年刷新更適合穩定日常。

## 原型

「用三个地图节点、不同恢复周期和行程成本，给玩家简单的上次采集记录。」
出處：`sources/text/gathering-renewable-forage-route.json` 字元 3149-3182 `prototype.firstStep.zh`
顯示：用三個地圖節點、不同恢復週期和行程成本，給玩家簡單的上次採集記錄。

「改变一个点的恢复周期后，玩家是否调整访问顺序并减少空跑？」
出處：`sources/text/gathering-renewable-forage-route.json` 字元 3523-3551 `prototype.test.zh`
顯示：改變一個點的恢復週期後，玩家是否調整訪問順序並減少空跑？

「所有节点同周期同产量时容易只剩每日打卡，先制造路线与周期的交叉。」
出處：`sources/text/gathering-renewable-forage-route.json` 字元 3340-3372 `prototype.pitfall.zh`
顯示：所有節點同週期同產量時容易只剩每日打卡，先製造路線與週期的交叉。

## 相關模式

- [深度鎖定層](gathering-depth-targeting.md)
- [氧氣採集決策](gathering-oxygen-gathering.md)
- [工具能力門檻](gathering-tool-hardness.md)
- [限時合約](commerce-timed-contracts.md)

## 參考來源

- [Revisiting renewable forage — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/gathering-renewable-forage-route/) — 查閱：2026-11-02；取得方式：page-text。
