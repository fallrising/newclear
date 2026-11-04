---
{
  "schema_version": 2,
  "id": "matching-gravity-cascade",
  "title": "重力連鎖",
  "title_en": "Set up gravity-driven cascades",
  "category": "matching",
  "source_category": "matching",
  "tags": [
    "planning",
    "spatial",
    "randomness"
  ],
  "summary": "先消掉支撑物，让上面的物件落下来完成下一组。",
  "note_status": "draft",
  "related": [
    "matching-clear-under-cargo",
    "matching-complete-lines",
    "matching-merge-three-upgrade",
    "matching-pattern-creates-power"
  ],
  "sources": [
    {
      "title": "Set up gravity-driven cascades — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/matching-gravity-cascade/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先消掉支撑物，让上面的物件落下来完成下一组。」
出處：`sources/text/matching-gravity-cascade.json` 字元 190-212 `summary.zh`
顯示：先消掉支撐物，讓上面的物件落下來完成下一組。

## 規則

「一次消除后，物件落进空位；如果新的位置又满足消除条件，就自动继续结算。玩家可以利用已经看得见的排列准备连锁，也要区分可预测的掉落与随机补入带来的意外结果。」
出處：`sources/text/matching-gravity-cascade.json` 字元 324-401 `rules.zh`
顯示：一次消除後，物件落進空位；如果新的位置又滿足消除條件，就自動繼續結算。玩家可以利用已經看得見的排列準備連鎖，也要區分可預測的掉落與隨機補入帶來的意外結果。

## 核心循環

「看上层物件会落到哪里」
出處：`sources/text/matching-gravity-cascade.json` 字元 700-710 `loop[0].zh`
顯示：看上層物件會落到哪裏

「选择先消除的支撑组」
出處：`sources/text/matching-gravity-cascade.json` 字元 790-799 `loop[1].zh`
顯示：選擇先消除的支撐組

「按顺序结算掉落连锁」
出處：`sources/text/matching-gravity-cascade.json` 字元 877-886 `loop[2].zh`
顯示：按順序結算掉落連鎖

「观察连锁后的剩余结构」
出處：`sources/text/matching-gravity-cascade.json` 字元 969-979 `loop[3].zh`
顯示：觀察連鎖後的剩餘結構

## 玩家取捨

「直接清目标附近的块，还是先清下方一组让上层自动落到目标？」
出處：`sources/text/matching-gravity-cascade.json` 字元 1082-1110 `decisions[0].zh`
顯示：直接清目標附近的塊，還是先清下方一組讓上層自動落到目標？

「确定能触发的两段连锁，是否比依赖随机新块的大连锁更值得选？」
出處：`sources/text/matching-gravity-cascade.json` 字元 1246-1275 `decisions[1].zh`
顯示：確定能觸發的兩段連鎖，是否比依賴隨機新塊的大連鎖更值得選？

## 可調參數

「补入信息」
出處：`sources/text/matching-gravity-cascade.json` 字元 1445-1449 `parameters[0].name.zh`
顯示：補入信息

「固定或可见补入让连锁可规划；隐藏随机补入增加惊喜和不可控性。」
出處：`sources/text/matching-gravity-cascade.json` 字元 1529-1559 `parameters[0].effect.zh`
顯示：固定或可見補入讓連鎖可規劃；隱藏隨機補入增加驚喜和不可控性。

「连锁奖励增长」
出處：`sources/text/matching-gravity-cascade.json` 字元 1732-1738 `parameters[1].name.zh`
顯示：連鎖獎勵增長

「奖励增长越快，越鼓励先做准备；过高会使普通消除显得无价值。」
出處：`sources/text/matching-gravity-cascade.json` 字元 1821-1850 `parameters[1].effect.zh`
顯示：獎勵增長越快，越鼓勵先做準備；過高會使普通消除顯得無價值。

## 原型

「用一个固定棋盘设计三种可预测的两段连锁，逐段慢放结算。」
出處：`sources/text/matching-gravity-cascade.json` 字元 3384-3411 `prototype.firstStep.zh`
顯示：用一個固定棋盤設計三種可預測的兩段連鎖，逐段慢放結算。

「玩家能否在点击前指出第二次消除发生在哪里？」
出處：`sources/text/matching-gravity-cascade.json` 字元 3718-3739 `prototype.test.zh`
顯示：玩家能否在點擊前指出第二次消除發生在哪裏？

「动画可以增强反馈，但不能掩盖是哪一步造成了下一次匹配。」
出處：`sources/text/matching-gravity-cascade.json` 字元 3554-3581 `prototype.pitfall.zh`
顯示：動畫可以增強反饋，但不能掩蓋是哪一步造成了下一次匹配。

## 相關模式

- [清除下方貨物](matching-clear-under-cargo.md)
- [完成整行](matching-complete-lines.md)
- [合成三消升級](matching-merge-three-upgrade.md)
- [圖形生成電力](matching-pattern-creates-power.md)

## 參考來源

- [Set up gravity-driven cascades — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/matching-gravity-cascade/) — 查閱：2026-11-02；取得方式：page-text。
