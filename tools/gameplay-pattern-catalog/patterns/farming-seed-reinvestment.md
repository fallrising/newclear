---
{
  "schema_version": 2,
  "id": "farming-seed-reinvestment",
  "title": "種子再投入",
  "title_en": "Seed reinvestment",
  "category": "farming",
  "source_category": "farming",
  "tags": [
    "economy",
    "progression",
    "planning"
  ],
  "summary": "把一部分收成留给下一轮，而不是全部变现。",
  "note_status": "draft",
  "related": [
    "farming-livestock-care",
    "farming-orchard-investment",
    "farming-regrowth-crops",
    "farming-season-window"
  ],
  "sources": [
    {
      "title": "Seed reinvestment — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/farming-seed-reinvestment/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把一部分收成留给下一轮，而不是全部变现。」
出處：`sources/text/farming-seed-reinvestment.json` 字元 171-191 `summary.zh`
顯示：把一部分收成留給下一輪，而不是全部變現。

## 規則

「玩家从收成或收获过程获得下一轮种子，建立种植循环。种子回收可能需要加工、牺牲产物或依赖概率；保留不足会迫使玩家重新购买或探索寻找种源。」
出處：`sources/text/farming-seed-reinvestment.json` 字元 311-378 `rules.zh`
顯示：玩家從收成或收穫過程獲得下一輪種子，建立種植循環。種子回收可能需要加工、犧牲產物或依賴概率；保留不足會迫使玩家重新購買或探索尋找種源。

## 核心循環

「收获产物」
出處：`sources/text/farming-seed-reinvestment.json` 字元 628-632 `loop[0].zh`
顯示：收穫產物

「分配出售与留种份额」
出處：`sources/text/farming-seed-reinvestment.json` 字元 691-700 `loop[1].zh`
顯示：分配出售與留種份額

「回收或加工种子」
出處：`sources/text/farming-seed-reinvestment.json` 字元 772-779 `loop[2].zh`
顯示：回收或加工種子

「补齐缺口并再播种」
出處：`sources/text/farming-seed-reinvestment.json` 字元 847-855 `loop[3].zh`
顯示：補齊缺口並再播種

## 玩家取捨

「现在卖掉还是扩大下轮产能，是现金与未来产出的交换。」
出處：`sources/text/farming-seed-reinvestment.json` 字元 946-971 `decisions[0].zh`
顯示：現在賣掉還是擴大下輪產能，是現金與未來產出的交換。

「随机回收要求安全库存，不能只按平均收益安排。」
出處：`sources/text/farming-seed-reinvestment.json` 字元 1087-1109 `decisions[1].zh`
顯示：隨機回收要求安全庫存，不能只按平均收益安排。

## 可調參數

「种子回收率」
出處：`sources/text/farming-seed-reinvestment.json` 字元 1271-1276 `parameters[0].name.zh`
顯示：種子回收率

「低于持续补种需求时，必须接入商店或探索补给。」
出處：`sources/text/farming-seed-reinvestment.json` 字元 1354-1376 `parameters[0].effect.zh`
顯示：低於持續補種需求時，必須接入商店或探索補給。

「产物机会成本」
出處：`sources/text/farming-seed-reinvestment.json` 字元 1532-1538 `parameters[1].name.zh`
顯示：產物機會成本

「加工越多可售产物，扩张越会挤压当前收入。」
出處：`sources/text/farming-seed-reinvestment.json` 字元 1616-1636 `parameters[1].effect.zh`
顯示：加工越多可售產物，擴張越會擠壓當前收入。

## 原型

「用“出售／留种”两个分配按钮和三轮固定账单，先不用农场移动或种植动画。」
出處：`sources/text/farming-seed-reinvestment.json` 字元 3073-3108 `prototype.firstStep.zh`
顯示：用“出售／留種”兩個分配按鈕和三輪固定賬單，先不用農場移動或種植動畫。

「观察玩家是否因下一轮账单改变留种数量，而非每轮使用同一比例。」
出處：`sources/text/farming-seed-reinvestment.json` 字元 3425-3455 `prototype.test.zh`
顯示：觀察玩家是否因下一輪賬單改變留種數量，而非每輪使用同一比例。

「若留种永远回报更高又没有近期支出，玩家会机械地把一切再投入。」
出處：`sources/text/farming-seed-reinvestment.json` 字元 3272-3302 `prototype.pitfall.zh`
顯示：若留種永遠回報更高又沒有近期支出，玩家會機械地把一切再投入。

## 相關模式

- [牲畜照料](farming-livestock-care.md)
- [果樹投入](farming-orchard-investment.md)
- [再生作物群](farming-regrowth-crops.md)
- [季節窗口](farming-season-window.md)

## 參考來源

- [Seed reinvestment — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/farming-seed-reinvestment/) — 查閱：2026-11-02；取得方式：page-text。
