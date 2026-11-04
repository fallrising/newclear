---
{
  "schema_version": 2,
  "id": "automation-item-filtering",
  "title": "物品篩選",
  "title_en": "Item-filtered transport",
  "category": "automation",
  "source_category": "automation",
  "tags": [
    "information",
    "optimization",
    "planning"
  ],
  "summary": "为混合物流设定规则，让不同物品自动走向正确出口。",
  "note_status": "draft",
  "related": [
    "automation-aerial-logistics",
    "automation-belt-routing",
    "automation-blueprint-reuse",
    "automation-byproduct-loop"
  ],
  "sources": [
    {
      "title": "Item-filtered transport — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/automation-item-filtering/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「为混合物流设定规则，让不同物品自动走向正确出口。」
出處：`sources/text/automation-item-filtering.json` 字元 181-205 `summary.zh`
顯示：爲混合物流設定規則，讓不同物品自動走向正確出口。

## 規則

「玩家设定允许通过的物品类型，把混合输入拆成专线。未匹配物品必须有去处，否则可能阻塞；正确分类、误投与溢出构成反馈。」
出處：`sources/text/automation-item-filtering.json` 字元 317-374 `rules.zh`
顯示：玩家設定允許通過的物品類型，把混合輸入拆成專線。未匹配物品必須有去處，否則可能阻塞；正確分類、誤投與溢出構成反饋。

## 核心循環

「查看混入的物品」
出處：`sources/text/automation-item-filtering.json` 字元 599-606 `loop[0].zh`

「配置过滤条件」
出處：`sources/text/automation-item-filtering.json` 字元 672-678 `loop[1].zh`
顯示：配置過濾條件

「设置未匹配出口」
出處：`sources/text/automation-item-filtering.json` 字元 739-746 `loop[2].zh`
顯示：設置未匹配出口

「测试异常输入」
出處：`sources/text/automation-item-filtering.json` 字元 815-821 `loop[3].zh`
顯示：測試異常輸入

## 玩家取捨

「精细白名单更可靠，但新增产品时需要维护。」
出處：`sources/text/automation-item-filtering.json` 字元 907-927 `decisions[0].zh`
顯示：精細白名單更可靠，但新增產品時需要維護。

「保留回收通道占空间，却避免一个异物停掉全线。」
出處：`sources/text/automation-item-filtering.json` 字元 1040-1062 `decisions[1].zh`
顯示：保留回收通道佔空間，卻避免一個異物停掉全線。

## 可調參數

「物品种类」
出處：`sources/text/automation-item-filtering.json` 字元 1219-1223 `parameters[0].name.zh`
顯示：物品種類

「种类越多，记忆过滤规则越困难，分类界面越重要。」
出處：`sources/text/automation-item-filtering.json` 字元 1297-1320 `parameters[0].effect.zh`
顯示：種類越多，記憶過濾規則越困難，分類界面越重要。

「错误后果」
出處：`sources/text/automation-item-filtering.json` 字元 1441-1445 `parameters[1].name.zh`
顯示：錯誤後果

「允许自动退回会鼓励实验；不可逆污染会迫使先做测试。」
出處：`sources/text/automation-item-filtering.json` 字元 1529-1554 `parameters[1].effect.zh`
顯示：允許自動退回會鼓勵實驗；不可逆污染會迫使先做測試。

## 原型

「只用三类物品、一个过滤节点和默认出口，显示每种物品最终走到哪里。」
出處：`sources/text/automation-item-filtering.json` 字元 3066-3098 `prototype.firstStep.zh`
顯示：只用三類物品、一個過濾節點和默認出口，顯示每種物品最終走到哪裏。

「故意混入一种新物品，观察玩家是否能给它安排去处并保持原线路运行。」
出處：`sources/text/automation-item-filtering.json` 字元 3422-3454 `prototype.test.zh`
顯示：故意混入一種新物品，觀察玩家是否能給它安排去處並保持原線路運行。

「规则优先级与“没有匹配”必须可见，避免玩家只能靠反复拆线调试。」
出處：`sources/text/automation-item-filtering.json` 字元 3240-3271 `prototype.pitfall.zh`
顯示：規則優先級與“沒有匹配”必須可見，避免玩家只能靠反覆拆線調試。

## 相關模式

- [空中搬運物流](automation-aerial-logistics.md)
- [受限空間中的物流路由](automation-belt-routing.md)
- [藍圖重用](automation-blueprint-reuse.md)
- [副產品循環](automation-byproduct-loop.md)

## 參考來源

- [Item-filtered transport — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/automation-item-filtering/) — 查閱：2026-11-02；取得方式：page-text。
