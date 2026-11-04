---
{
  "schema_version": 2,
  "id": "inventory-identification",
  "title": "未知物品辨識",
  "title_en": "Unknown-item identification",
  "category": "inventory",
  "source_category": "inventory",
  "tags": [
    "information",
    "risk",
    "discovery"
  ],
  "summary": "先承担试用风险，还是花资源换取确定性？",
  "note_status": "draft",
  "related": [
    "commerce-auction-bidding",
    "commerce-price-discovery",
    "cooking-recipe-learning",
    "inventory-death-retrieval"
  ],
  "sources": [
    {
      "title": "Unknown-item identification — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/inventory-identification/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先承担试用风险，还是花资源换取确定性？」
出處：`sources/text/inventory-identification.json` 字元 182-201 `summary.zh`
顯示：先承擔試用風險，還是花資源換取確定性？

## 規則

「拾取的道具先隐藏名称或效果，玩家通过鉴定、观察或使用来确认。尝试可能消耗道具或触发负面效果，而已获得的知识让以后同类物品更容易判断。」
出處：`sources/text/inventory-identification.json` 字元 292-358 `rules.zh`
顯示：拾取的道具先隱藏名稱或效果，玩家通過鑑定、觀察或使用來確認。嘗試可能消耗道具或觸發負面效果，而已獲得的知識讓以後同類物品更容易判斷。

## 核心循環

「拾取未知物品」
出處：`sources/text/inventory-identification.json` 字元 583-589 `loop[0].zh`

「选择安全鉴定或试用」
出處：`sources/text/inventory-identification.json` 字元 653-662 `loop[1].zh`
顯示：選擇安全鑑定或試用

「观察结果并记录」
出處：`sources/text/inventory-identification.json` 字元 736-743 `loop[2].zh`
顯示：觀察結果並記錄

「据此决定保留用途」
出處：`sources/text/inventory-identification.json` 字元 816-824 `loop[3].zh`
顯示：據此決定保留用途

## 玩家取捨

「紧急时喝未知药水可能获救，也可能雪上加霜。」
出處：`sources/text/inventory-identification.json` 字元 919-940 `decisions[0].zh`
顯示：緊急時喝未知藥水可能獲救，也可能雪上加霜。

「有限鉴定资源优先给高价值装备，还是先排除危险消耗品？」
出處：`sources/text/inventory-identification.json` 字元 1041-1067 `decisions[1].zh`
顯示：有限鑑定資源優先給高價值裝備，還是先排除危險消耗品？

## 可調參數

「知识保留范围」
出處：`sources/text/inventory-identification.json` 字元 1224-1230 `parameters[0].name.zh`
顯示：知識保留範圍

「单局保留促使每轮重新学习；跨局保留形成长期图鉴。」
出處：`sources/text/inventory-identification.json` 字元 1313-1337 `parameters[0].effect.zh`
顯示：單局保留促使每輪重新學習；跨局保留形成長期圖鑑。

「试错代价」
出處：`sources/text/inventory-identification.json` 字元 1497-1501 `parameters[1].name.zh`
顯示：試錯代價

「低代价鼓励实验；高代价使线索和鉴定工具更重要。」
出處：`sources/text/inventory-identification.json` 字元 1573-1596 `parameters[1].effect.zh`
顯示：低代價鼓勵實驗；高代價使線索和鑑定工具更重要。

## 原型

「做四种随机外观药水、一项鉴定资源，以及本局共享的已知效果记录。」
出處：`sources/text/inventory-identification.json` 字元 3109-3140 `prototype.firstStep.zh`
顯示：做四種隨機外觀藥水、一項鑑定資源，以及本局共享的已知效果記錄。

「观察玩家在安全与危急状态下是否采用不同鉴定顺序。」
出處：`sources/text/inventory-identification.json` 字元 3475-3499 `prototype.test.zh`
顯示：觀察玩家在安全與危急狀態下是否採用不同鑑定順序。

「先限制负面效果强度；没有线索的即死结果很难产生可学习的判断。」
出處：`sources/text/inventory-identification.json` 字元 3307-3337 `prototype.pitfall.zh`
顯示：先限制負面效果強度；沒有線索的即死結果很難產生可學習的判斷。

## 相關模式

- [拍賣出價](commerce-auction-bidding.md)
- [以回饋進行價格探索](commerce-price-discovery.md)
- [知識與材料雙重解鎖](cooking-recipe-learning.md)
- [死亡取回](inventory-death-retrieval.md)

## 參考來源

- [Unknown-item identification — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/inventory-identification/) — 查閱：2026-11-02；取得方式：page-text。
