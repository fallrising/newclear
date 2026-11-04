---
{
  "schema_version": 2,
  "id": "cooperation-shared-vehicle",
  "title": "共享載具",
  "title_en": "Crew a shared vehicle",
  "category": "cooperation",
  "source_category": "cooperation",
  "tags": [
    "cooperation",
    "planning",
    "timing"
  ],
  "summary": "同一艘船的转向、防守与维修都要人做，队员必须不断商量谁先忙什么。",
  "note_status": "draft",
  "related": [
    "cooperation-complementary-abilities",
    "cooperation-downed-revival",
    "cooperation-split-information",
    "cooperation-synchronized-triggers"
  ],
  "sources": [
    {
      "title": "Crew a shared vehicle — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooperation-shared-vehicle/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「同一艘船的转向、防守与维修都要人做，队员必须不断商量谁先忙什么。」
出處：`sources/text/cooperation-shared-vehicle.json` 字元 182-214 `summary.zh`
顯示：同一艘船的轉向、防守與維修都要人做，隊員必須不斷商量誰先忙什麼。

## 規則

「多名玩家共享载具的移动与损伤状态，但不同功能需要分别操作。岗位数量或突发任务超过人手时，玩家必须换岗；一个岗位的决定会改变其他岗位面对的局面。」
出處：`sources/text/cooperation-shared-vehicle.json` 字元 352-423 `rules.zh`
顯示：多名玩家共享載具的移動與損傷狀態，但不同功能需要分別操作。崗位數量或突發任務超過人手時，玩家必須換崗；一個崗位的決定會改變其他崗位面對的局面。

## 核心循環

「观察航路与危险」
出處：`sources/text/cooperation-shared-vehicle.json` 字元 691-698 `loop[0].zh`
顯示：觀察航路與危險

「分配眼下的岗位」
出處：`sources/text/cooperation-shared-vehicle.json` 字元 768-775 `loop[1].zh`
顯示：分配眼下的崗位

「操作并报告变化」
出處：`sources/text/cooperation-shared-vehicle.json` 字元 838-845 `loop[2].zh`
顯示：操作並報告變化

「遇到新情况换岗」
出處：`sources/text/cooperation-shared-vehicle.json` 字元 915-922 `loop[3].zh`
顯示：遇到新情況換崗

## 玩家取捨

「继续驾驶绕开危险，还是离开驾驶位先修漏水？」
出處：`sources/text/cooperation-shared-vehicle.json` 字元 1016-1037 `decisions[0].zh`
顯示：繼續駕駛繞開危險，還是離開駕駛位先修漏水？

「让熟练的人固定岗位，还是交换岗位应对离谁更近的急事？」
出處：`sources/text/cooperation-shared-vehicle.json` 字元 1144-1170 `decisions[1].zh`
顯示：讓熟練的人固定崗位，還是交換崗位應對離誰更近的急事？

## 可調參數

「岗位与人数之比」
出處：`sources/text/cooperation-shared-vehicle.json` 字元 1333-1340 `parameters[0].name.zh`
顯示：崗位與人數之比

「岗位多于玩家才能产生换岗取舍，太多则容易顾不过来。」
出處：`sources/text/cooperation-shared-vehicle.json` 字元 1421-1446 `parameters[0].effect.zh`
顯示：崗位多於玩家才能產生換崗取捨，太多則容易顧不過來。

「换岗距离」
出處：`sources/text/cooperation-shared-vehicle.json` 字元 1580-1584 `parameters[1].name.zh`
顯示：換崗距離

「距离越远，提前沟通和安排顺路任务越重要。」
出處：`sources/text/cooperation-shared-vehicle.json` 字元 1669-1689 `parameters[1].effect.zh`
顯示：距離越遠，提前溝通和安排順路任務越重要。

## 原型

「先做同屏二维小船、两个角色和三个按钮岗位：移动、防守、维修。」
出處：`sources/text/cooperation-shared-vehicle.json` 字元 3245-3275 `prototype.firstStep.zh`
顯示：先做同屏二維小船、兩個角色和三個按鈕崗位：移動、防守、維修。

「两个试玩者会主动喊换岗，并能说清一次没人操作某岗位造成的后果。」
出處：`sources/text/cooperation-shared-vehicle.json` 字元 3621-3652 `prototype.test.zh`
顯示：兩個試玩者會主動喊換崗，並能說清一次沒人操作某崗位造成的後果。

「真实海洋、复杂船体和联网同步都先放后；第一版只验证岗位之间是否互相需要。」
出處：`sources/text/cooperation-shared-vehicle.json` 字元 3429-3465 `prototype.pitfall.zh`
顯示：真實海洋、複雜船體和聯網同步都先放後；第一版只驗證崗位之間是否互相需要。

## 相關模式

- [互補能力組](cooperation-complementary-abilities.md)
- [倒地救起](cooperation-downed-revival.md)
- [分工資訊](cooperation-split-information.md)
- [同步觸發組](cooperation-synchronized-triggers.md)

## 參考來源

- [Crew a shared vehicle — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooperation-shared-vehicle/) — 查閱：2026-11-02；取得方式：page-text。
