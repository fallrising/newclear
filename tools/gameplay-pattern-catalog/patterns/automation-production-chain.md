---
{
  "schema_version": 2,
  "id": "automation-production-chain",
  "title": "產線連鎖",
  "title_en": "Multi-stage production chains",
  "category": "automation",
  "source_category": "automation",
  "tags": [
    "planning",
    "progression",
    "optimization"
  ],
  "summary": "把上一道工序的产出变成下一道的输入，逐级制造复杂物品。",
  "note_status": "draft",
  "related": [
    "automation-aerial-logistics",
    "automation-belt-routing",
    "automation-blueprint-reuse",
    "automation-byproduct-loop"
  ],
  "sources": [
    {
      "title": "Multi-stage production chains — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/automation-production-chain/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把上一道工序的产出变成下一道的输入，逐级制造复杂物品。」
出處：`sources/text/automation-production-chain.json` 字元 187-214 `summary.zh`
顯示：把上一道工序的產出變成下一道的輸入，逐級製造複雜物品。

## 規則

「玩家从最终产品倒推中间材料，配置机器配方并连接供料。任何前置缺失都会让后段停机；产线完成后可持续输出目标产品。」
出處：`sources/text/automation-production-chain.json` 字元 334-389 `rules.zh`
顯示：玩家從最終產品倒推中間材料，配置機器配方並連接供料。任何前置缺失都會讓後段停機；產線完成後可持續輸出目標產品。

## 核心循環

「选定目标产品」
出處：`sources/text/automation-production-chain.json` 字元 623-629 `loop[0].zh`
顯示：選定目標產品

「拆解配方依赖」
出處：`sources/text/automation-production-chain.json` 字元 688-694 `loop[1].zh`
顯示：拆解配方依賴

「建设前后工序」
出處：`sources/text/automation-production-chain.json` 字元 763-769 `loop[2].zh`
顯示：建設前後工序

「试产并补齐短板」
出處：`sources/text/automation-production-chain.json` 字元 829-836 `loop[3].zh`
顯示：試產並補齊短板

## 玩家取捨

「集中生产通用零件便于复用，但会形成共享瓶颈。」
出處：`sources/text/automation-production-chain.json` 字元 929-951 `decisions[0].zh`
顯示：集中生產通用零件便於複用，但會形成共享瓶頸。

「提前扩建上游有余量，却占用眼前稀缺的材料。」
出處：`sources/text/automation-production-chain.json` 字元 1059-1080 `decisions[1].zh`
顯示：提前擴建上游有餘量，卻佔用眼前稀缺的材料。

## 可調參數

「依赖深度」
出處：`sources/text/automation-production-chain.json` 字元 1235-1239 `parameters[0].name.zh`
顯示：依賴深度

「层级增多会放大规划感，也增加定位停机原因的难度。」
出處：`sources/text/automation-production-chain.json` 字元 1317-1341 `parameters[0].effect.zh`
顯示：層級增多會放大規劃感，也增加定位停機原因的難度。

「中间品复用率」
出處：`sources/text/automation-production-chain.json` 字元 1479-1485 `parameters[1].name.zh`
顯示：中間品複用率

「复用越高，局部扩产越容易影响其他产品。」
出處：`sources/text/automation-production-chain.json` 字元 1565-1584 `parameters[1].effect.zh`
顯示：複用越高，局部擴產越容易影響其他產品。

## 原型

「先做矿石→铁板→齿轮三步，每步一种机器，显示输入缺口和每轮产量。」
出處：`sources/text/automation-production-chain.json` 字元 3036-3068 `prototype.firstStep.zh`
顯示：先做礦石→鐵板→齒輪三步，每步一種機器，顯示輸入缺口和每輪產量。

「当最终机器断料时，玩家是否沿依赖关系追到真正短缺的上游环节？」
出處：`sources/text/automation-production-chain.json` 字元 3405-3435 `prototype.test.zh`
顯示：當最終機器斷料時，玩家是否沿依賴關係追到真正短缺的上游環節？

「配方树、物流和机器速度会互相放大调试成本，先固定其中两项再改第三项。」
出處：`sources/text/automation-production-chain.json` 字元 3223-3257 `prototype.pitfall.zh`
顯示：配方樹、物流和機器速度會互相放大調試成本，先固定其中兩項再改第三項。

## 相關模式

- [空中搬運物流](automation-aerial-logistics.md)
- [受限空間中的物流路由](automation-belt-routing.md)
- [藍圖重用](automation-blueprint-reuse.md)
- [副產品循環](automation-byproduct-loop.md)

## 參考來源

- [Multi-stage production chains — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/automation-production-chain/) — 查閱：2026-11-02；取得方式：page-text。
