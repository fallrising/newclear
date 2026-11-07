---
{
  "schema_version": 2,
  "id": "progression-specialization-branches",
  "title": "專精分支",
  "title_en": "Exclusive specialization branches",
  "category": "progression",
  "source_category": "progression",
  "tags": [
    "planning",
    "progression",
    "optimization"
  ],
  "summary": "成长到关键节点，只能选一条更擅长的路线。",
  "note_status": "draft",
  "related": [
    "progression-challenge-tiers",
    "progression-death-loses-training",
    "progression-evolution-recipes",
    "progression-practice-based-growth"
  ],
  "sources": [
    {
      "title": "Exclusive specialization branches — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/progression-specialization-branches/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「成长到关键节点，只能选一条更擅长的路线。」
出處：`sources/text/progression-specialization-branches.json` 字元 202-222 `summary.zh`
顯示：成長到關鍵節點，只能選一條更擅長的路線。

## 規則

「角色成长到指定阶段后，玩家从互斥的方向中选择一个，例如提高单件售价或增加产量。选择会改变之后哪些行动更划算；没选的路线暂时关闭，避免所有能力最终都一样。」
出處：`sources/text/progression-specialization-branches.json` 字元 317-393 `rules.zh`
顯示：角色成長到指定階段後，玩家從互斥的方向中選擇一個，例如提高單件售價或增加產量。選擇會改變之後哪些行動更划算；沒選的路線暫時關閉，避免所有能力最終都一樣。

## 核心循環

「达到分支节点」
出處：`sources/text/progression-specialization-branches.json` 字元 655-661 `loop[0].zh`
顯示：達到分支節點

「比较两种收益」
出處：`sources/text/progression-specialization-branches.json` 字元 719-725 `loop[1].zh`
顯示：比較兩種收益

「确定专长」
出處：`sources/text/progression-specialization-branches.json` 字元 785-789 `loop[2].zh`
顯示：確定專長

「围绕专长安排下一轮」
出處：`sources/text/progression-specialization-branches.json` 字元 854-863 `loop[3].zh`
顯示：圍繞專長安排下一輪

## 玩家取捨

「选眼下立刻有用的方向，还是为以后准备？未来收益可能要先投入配套资源。」
出處：`sources/text/progression-specialization-branches.json` 字元 942-976 `decisions[0].zh`
顯示：選眼下立刻有用的方向，還是爲以後準備？未來收益可能要先投入配套資源。

「继续加强已有长处，还是选能补短板的第二方向？」
出處：`sources/text/progression-specialization-branches.json` 字元 1106-1128 `decisions[1].zh`
顯示：繼續加強已有長處，還是選能補短板的第二方向？

## 可調參數

「分支互斥程度」
出處：`sources/text/progression-specialization-branches.json` 字元 1286-1292 `parameters[0].name.zh`

「可同时学习的方向越少，选择越有代价，也越需要提前说明效果。」
出處：`sources/text/progression-specialization-branches.json` 字元 1372-1401 `parameters[0].effect.zh`
顯示：可同時學習的方向越少，選擇越有代價，也越需要提前說明效果。

「分支出现时机」
出處：`sources/text/progression-specialization-branches.json` 字元 1558-1564 `parameters[1].name.zh`
顯示：分支出現時機

「太早选择时玩家不了解差异；太晚则很久体验不到角色区别。」
出處：`sources/text/progression-specialization-branches.json` 字元 1642-1669 `parameters[1].effect.zh`
顯示：太早選擇時玩家不瞭解差異；太晚則很久體驗不到角色區別。

## 原型

「做两个互斥加成、一个固定客流的售卖回合，选择前显示一轮预估收益。」
出處：`sources/text/progression-specialization-branches.json` 字元 3178-3210 `prototype.firstStep.zh`
顯示：做兩個互斥加成、一個固定客流的售賣回合，選擇前顯示一輪預估收益。

「改变客流后，观察玩家是否会改变选择，并能解释原因。」
出處：`sources/text/progression-specialization-branches.json` 字元 3520-3545 `prototype.test.zh`
顯示：改變客流後，觀察玩家是否會改變選擇，並能解釋原因。

「先别铺整棵技能树；两条路线若只是不同名称的加钱，就没有真正取舍。」
出處：`sources/text/progression-specialization-branches.json` 字元 3362-3394 `prototype.pitfall.zh`
顯示：先別鋪整棵技能樹；兩條路線若只是不同名稱的加錢，就沒有真正取捨。

## 相關模式

- [挑戰層級](progression-challenge-tiers.md)
- [死亡失去訓練](progression-death-loses-training.md)
- [進化配方鏈](progression-evolution-recipes.md)
- [練習成長](progression-practice-based-growth.md)

## 參考來源

- [Exclusive specialization branches — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/progression-specialization-branches/) — 查閱：2026-11-02；取得方式：page-text。
