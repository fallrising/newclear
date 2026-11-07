---
{
  "schema_version": 2,
  "id": "automation-conditional-control",
  "title": "條件控制",
  "title_en": "Sensor-driven control",
  "category": "automation",
  "source_category": "automation",
  "tags": [
    "information",
    "optimization",
    "creativity"
  ],
  "summary": "让机器根据温度、库存或其他信号自动启停。",
  "note_status": "draft",
  "related": [
    "automation-blueprint-reuse",
    "automation-fluid-routing",
    "automation-item-filtering",
    "cooking-judged-flavor"
  ],
  "sources": [
    {
      "title": "Sensor-driven control — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/automation-conditional-control/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「让机器根据温度、库存或其他信号自动启停。」
出處：`sources/text/automation-conditional-control.json` 字元 184-204 `summary.zh`
顯示：讓機器根據溫度、庫存或其他信號自動啓停。

## 規則

「玩家读取传感器数值，设定阈值或逻辑，再把输出连到设备。条件满足时机器改变状态；观察振荡、延迟或误触发，再调整规则。」
出處：`sources/text/automation-conditional-control.json` 字元 329-386 `rules.zh`
顯示：玩家讀取傳感器數值，設定閾值或邏輯，再把輸出連到設備。條件滿足時機器改變狀態；觀察振盪、延遲或誤觸發，再調整規則。

## 核心循環

「选择要监测的量」
出處：`sources/text/automation-conditional-control.json` 字元 622-629 `loop[0].zh`
顯示：選擇要監測的量

「设置条件」
出處：`sources/text/automation-conditional-control.json` 字元 696-700 `loop[1].zh`
顯示：設置條件

「接线到执行器」
出處：`sources/text/automation-conditional-control.json` 字元 759-765 `loop[2].zh`
顯示：接線到執行器

「制造边界情况并调试」
出處：`sources/text/automation-conditional-control.json` 字元 826-835 `loop[3].zh`
顯示：製造邊界情況並調試

## 玩家取捨

「把启停阈值设得很接近能紧贴目标，但是否会让设备在边界反复开关？」
出處：`sources/text/automation-conditional-control.json` 字元 924-955 `decisions[0].zh`
顯示：把啓停閾值設得很接近能緊貼目標，但是否會讓設備在邊界反覆開關？

「只按库存控制，还是再加一个电量条件？多一个条件值得增加多少调试工作？」
出處：`sources/text/automation-conditional-control.json` 字元 1114-1148 `decisions[1].zh`
顯示：只按庫存控制，還是再加一個電量條件？多一個條件值得增加多少調試工作？

## 可調參數

「信号延迟」
出處：`sources/text/automation-conditional-control.json` 字元 1334-1338 `parameters[0].name.zh`
顯示：信號延遲

「延迟增大会让提前量和安全余量变得必要。」
出處：`sources/text/automation-conditional-control.json` 字元 1412-1431 `parameters[0].effect.zh`
顯示：延遲增大會讓提前量和安全餘量變得必要。

「逻辑复杂度」
出處：`sources/text/automation-conditional-control.json` 字元 1554-1559 `parameters[1].name.zh`
顯示：邏輯複雜度

「简单条件适合入门；组合逻辑支持玩家自制控制器。」
出處：`sources/text/automation-conditional-control.json` 字元 1637-1660 `parameters[1].effect.zh`
顯示：簡單條件適合入門；組合邏輯支持玩家自制控制器。

## 原型

「做一个库存传感器、一个开关设备和可调阈值，持续展示读数与开关原因。」
出處：`sources/text/automation-conditional-control.json` 字元 3202-3235 `prototype.firstStep.zh`
顯示：做一個庫存傳感器、一個開關設備和可調閾值，持續展示讀數與開關原因。

「玩家能否通过改变阈值消除来回启停，并说明每次开关由什么触发？」
出處：`sources/text/automation-conditional-control.json` 字元 3585-3615 `prototype.test.zh`
顯示：玩家能否通過改變閾值消除來回啓停，並說明每次開關由什麼觸發？

「复杂逻辑门和大量传感器会让故障难定位，先保证一条控制链可以逐步追踪。」
出處：`sources/text/automation-conditional-control.json` 字元 3406-3440 `prototype.pitfall.zh`
顯示：複雜邏輯門和大量傳感器會讓故障難定位，先保證一條控制鏈可以逐步追蹤。

## 相關模式

- [藍圖重用](automation-blueprint-reuse.md)
- [流體路由](automation-fluid-routing.md)
- [物品篩選](automation-item-filtering.md)
- [評分風味](cooking-judged-flavor.md)

## 參考來源

- [Sensor-driven control — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/automation-conditional-control/) — 查閱：2026-11-02；取得方式：page-text。
