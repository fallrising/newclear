---
{
  "schema_version": 2,
  "id": "gathering-resource-detection",
  "title": "資源偵測",
  "title_en": "Resource detection overlays",
  "category": "gathering",
  "source_category": "gathering",
  "tags": [
    "information",
    "discovery",
    "optimization"
  ],
  "summary": "花费道具或基础设施，把寻找资源从盲搜变成定位。",
  "note_status": "draft",
  "related": [
    "gathering-hidden-deposit-clues",
    "exploration-ability-gates",
    "exploration-earned-map",
    "gathering-depth-targeting"
  ],
  "sources": [
    {
      "title": "Resource detection overlays — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/gathering-resource-detection/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「花费道具或基础设施，把寻找资源从盲搜变成定位。」
出處：`sources/text/gathering-resource-detection.json` 字元 186-209 `summary.zh`
顯示：花費道具或基礎設施，把尋找資源從盲搜變成定位。

## 規則

「玩家启动探测效果，使范围内某类资源被标记。标记减少搜索时间，却不自动解决路程、地形或危险；玩家仍要规划到达路线并采集。」
出處：`sources/text/gathering-resource-detection.json` 字元 326-385 `rules.zh`
顯示：玩家啓動探測效果，使範圍內某類資源被標記。標記減少搜索時間，卻不自動解決路程、地形或危險；玩家仍要規劃到達路線並採集。

## 核心循環

「确定缺少的资源」
出處：`sources/text/gathering-resource-detection.json` 字元 607-614 `loop[0].zh`
顯示：確定缺少的資源

「启动探测」
出處：`sources/text/gathering-resource-detection.json` 字元 682-686 `loop[1].zh`
顯示：啓動探測

「规划到标记的路线」
出處：`sources/text/gathering-resource-detection.json` 字元 748-756 `loop[2].zh`
顯示：規劃到標記的路線

「采集并寻找下一点」
出處：`sources/text/gathering-resource-detection.json` 字元 817-825 `loop[3].zh`
顯示：採集並尋找下一點

## 玩家取捨

「先投入探测设施，还是凭地形经验直接找？」
出處：`sources/text/gathering-resource-detection.json` 字元 909-928 `decisions[0].zh`
顯示：先投入探測設施，還是憑地形經驗直接找？

「近处低产点和远处富集点，哪个更值得？」
出處：`sources/text/gathering-resource-detection.json` 字元 1026-1044 `decisions[1].zh`
顯示：近處低產點和遠處富集點，哪個更值得？

## 可調參數

「覆盖范围」
出處：`sources/text/gathering-resource-detection.json` 字元 1179-1183 `parameters[0].name.zh`
顯示：覆蓋範圍

「范围大节省盲搜，但过大时容易抹掉发现地形的乐趣。」
出處：`sources/text/gathering-resource-detection.json` 字元 1260-1284 `parameters[0].effect.zh`
顯示：範圍大節省盲搜，但過大時容易抹掉髮現地形的樂趣。

「使用成本」
出處：`sources/text/gathering-resource-detection.json` 字元 1424-1428 `parameters[1].name.zh`

「消耗品鼓励关键时刻使用；常驻设施促使建立采集据点。」
出處：`sources/text/gathering-resource-detection.json` 字元 1505-1530 `parameters[1].effect.zh`
顯示：消耗品鼓勵關鍵時刻使用；常駐設施促使建立採集據點。

## 原型

「用遮蔽网格、固定探测半径和少量障碍，比较探测前后的路径选择。」
出處：`sources/text/gathering-resource-detection.json` 字元 2996-3026 `prototype.firstStep.zh`
顯示：用遮蔽網格、固定探測半徑和少量障礙，比較探測前後的路徑選擇。

「探测给出多个点时，玩家是否比较路线成本，而非永远选画面上最近的一点？」
出處：`sources/text/gathering-resource-detection.json` 字元 3359-3393 `prototype.test.zh`
顯示：探測給出多個點時，玩家是否比較路線成本，而非永遠選畫面上最近的一點？

「探测若同时自动寻路和自动采集，会抹去定位之后的判断空间。」
出處：`sources/text/gathering-resource-detection.json` 字元 3189-3217 `prototype.pitfall.zh`
顯示：探測若同時自動尋路和自動採集，會抹去定位之後的判斷空間。

## 相關模式

- [隱藏礦床線索](gathering-hidden-deposit-clues.md)
- [能力解鎖與回訪](exploration-ability-gates.md)
- [掙得地圖](exploration-earned-map.md)
- [深度鎖定層](gathering-depth-targeting.md)

## 參考來源

- [Resource detection overlays — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/gathering-resource-detection/) — 查閱：2026-11-02；取得方式：page-text。
