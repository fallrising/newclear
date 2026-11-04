---
{
  "schema_version": 2,
  "id": "cooperation-synchronized-triggers",
  "title": "同步觸發組",
  "title_en": "Reach separate controls and synchronize",
  "category": "cooperation",
  "source_category": "cooperation",
  "tags": [
    "cooperation",
    "timing",
    "spatial"
  ],
  "summary": "两处开关必须同时满足，走到位置之后还得对上行动时机。",
  "note_status": "draft",
  "related": [
    "cooperation-downed-revival",
    "cooperation-physical-tether",
    "cooperation-shared-vehicle",
    "cooperation-split-information"
  ],
  "sources": [
    {
      "title": "Reach separate controls and synchronize — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooperation-synchronized-triggers/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「两处开关必须同时满足，走到位置之后还得对上行动时机。」
出處：`sources/text/cooperation-synchronized-triggers.json` 字元 208-234 `summary.zh`
顯示：兩處開關必須同時滿足，走到位置之後還得對上行動時機。

## 規則

「目标由分散的多个条件共同开启，单人无法在同一时刻满足全部条件。玩家先分路到位，再确认准备状态，通过倒数、信号或持续按住来形成重叠的有效时间。」
出處：`sources/text/cooperation-synchronized-triggers.json` 字元 379-449 `rules.zh`
顯示：目標由分散的多個條件共同開啓，單人無法在同一時刻滿足全部條件。玩家先分路到位，再確認準備狀態，通過倒數、信號或持續按住來形成重疊的有效時間。

## 核心循環

「找到需要同时满足的条件」
出處：`sources/text/cooperation-synchronized-triggers.json` 字元 697-708 `loop[0].zh`
顯示：找到需要同時滿足的條件

「分头到达各自位置」
出處：`sources/text/cooperation-synchronized-triggers.json` 字元 784-792 `loop[1].zh`
顯示：分頭到達各自位置

「确认准备并同步执行」
出處：`sources/text/cooperation-synchronized-triggers.json` 字元 860-869 `loop[2].zh`
顯示：確認準備並同步執行

「检查结果再进入下一段」
出處：`sources/text/cooperation-synchronized-triggers.json` 字元 946-956 `loop[3].zh`
顯示：檢查結果再進入下一段

## 玩家取捨

「我先按住等伙伴，还是等双方准备好再倒数？」
出處：`sources/text/cooperation-synchronized-triggers.json` 字元 1047-1067 `decisions[0].zh`
顯示：我先按住等夥伴，還是等雙方準備好再倒數？

「谁去更难到达的位置，谁负责最后发出信号？」
出處：`sources/text/cooperation-synchronized-triggers.json` 字元 1183-1203 `decisions[1].zh`
顯示：誰去更難到達的位置，誰負責最後發出信號？

## 可調參數

「允许重叠时间」
出處：`sources/text/cooperation-synchronized-triggers.json` 字元 1345-1351 `parameters[0].name.zh`
顯示：允許重疊時間

「窗口宽适合交流解谜，窗口窄更考验默契与操作。」
出處：`sources/text/cooperation-synchronized-triggers.json` 字元 1429-1451 `parameters[0].effect.zh`
顯示：窗口寬適合交流解謎，窗口窄更考驗默契與操作。

「等待期间的压力」
出處：`sources/text/cooperation-synchronized-triggers.json` 字元 1603-1610 `parameters[1].name.zh`
顯示：等待期間的壓力

「安全等待便于商量，持续危险会要求更好的到达顺序。」
出處：`sources/text/cooperation-synchronized-triggers.json` 字元 1694-1718 `parameters[1].effect.zh`
顯示：安全等待便於商量，持續危險會要求更好的到達順序。

## 原型

「先做同屏两个可移动方块、两块踏板和一个显示重叠时间的门。」
出處：`sources/text/cooperation-synchronized-triggers.json` 字元 3283-3311 `prototype.firstStep.zh`
顯示：先做同屏兩個可移動方塊、兩塊踏板和一個顯示重疊時間的門。

「试玩者第一次失败后能指出缺少哪个条件，并用倒数或等待成功一次。」
出處：`sources/text/cooperation-synchronized-triggers.json` 字元 3659-3690 `prototype.test.zh`
顯示：試玩者第一次失敗後能指出缺少哪個條件，並用倒數或等待成功一次。

「先让失败原因可见；新增机关种类之前，要分清是没到位、没同时按，还是保持时间不够。」
出處：`sources/text/cooperation-synchronized-triggers.json` 字元 3447-3487 `prototype.pitfall.zh`
顯示：先讓失敗原因可見；新增機關種類之前，要分清是沒到位、沒同時按，還是保持時間不夠。

## 相關模式

- [倒地救起](cooperation-downed-revival.md)
- [身體拘束繫繩](cooperation-physical-tether.md)
- [共享載具](cooperation-shared-vehicle.md)
- [分工資訊](cooperation-split-information.md)

## 參考來源

- [Reach separate controls and synchronize — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooperation-synchronized-triggers/) — 查閱：2026-11-02；取得方式：page-text。
