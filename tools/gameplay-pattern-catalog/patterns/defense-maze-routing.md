---
{
  "schema_version": 2,
  "id": "defense-maze-routing",
  "title": "路徑路由",
  "title_en": "Build a longer enemy route",
  "category": "defense",
  "source_category": "defense",
  "tags": [
    "spatial",
    "planning",
    "optimization"
  ],
  "summary": "花有限的建筑资源，让敌人多走几步、多挨几轮攻击。",
  "note_status": "draft",
  "related": [
    "building-access-network",
    "building-service-coverage",
    "defense-ammunition-supply",
    "defense-target-priority"
  ],
  "sources": [
    {
      "title": "Build a longer enemy route — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/defense-maze-routing/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「花有限的建筑资源，让敌人多走几步、多挨几轮攻击。」
出處：`sources/text/defense-maze-routing.json` 字元 178-202 `summary.zh`
顯示：花有限的建築資源，讓敵人多走幾步、多挨幾輪攻擊。

## 規則

「玩家在允许建造的地面放置障碍或防御塔，改变地面敌人前往目标的路线。既要留下可通行的道路，又要让敌人尽量多次经过火力覆盖区；路径预览和实际行军轨迹告诉玩家布局是否有效。」
出處：`sources/text/defense-maze-routing.json` 字元 320-403 `rules.zh`
顯示：玩家在允許建造的地面放置障礙或防禦塔，改變地面敵人前往目標的路線。既要留下可通行的道路，又要讓敵人儘量多次經過火力覆蓋區；路徑預覽和實際行軍軌跡告訴玩家佈局是否有效。

## 核心循環

「查看入口与出口」
出處：`sources/text/defense-maze-routing.json` 字元 694-701 `loop[0].zh`
顯示：查看入口與出口

「放障碍拉长路线」
出處：`sources/text/defense-maze-routing.json` 字元 771-778 `loop[1].zh`
顯示：放障礙拉長路線

「让敌人经过火力区」
出處：`sources/text/defense-maze-routing.json` 字元 857-865 `loop[2].zh`
顯示：讓敵人經過火力區

「根据漏怪位置改布局」
出處：`sources/text/defense-maze-routing.json` 字元 942-951 `loop[3].zh`
顯示：根據漏怪位置改佈局

## 玩家取捨

「用钱增加路程，还是直接买火力？路再长，伤害不足也守不住。」
出處：`sources/text/defense-maze-routing.json` 字元 1055-1083 `decisions[0].zh`
顯示：用錢增加路程，還是直接買火力？路再長，傷害不足也守不住。

「把所有敌人汇到一个窄口很省塔，但也更依赖这一个位置。」
出處：`sources/text/defense-maze-routing.json` 字元 1216-1242 `decisions[1].zh`
顯示：把所有敵人匯到一個窄口很省塔，但也更依賴這一個位置。

## 可調參數

「障碍成本」
出處：`sources/text/defense-maze-routing.json` 字元 1412-1416 `parameters[0].name.zh`
顯示：障礙成本

「成本低时鼓励反复改路；成本高时每个拐弯都要证明价值。」
出處：`sources/text/defense-maze-routing.json` 字元 1491-1517 `parameters[0].effect.zh`
顯示：成本低時鼓勵反覆改路；成本高時每個拐彎都要證明價值。

「允许的通路宽度」
出處：`sources/text/defense-maze-routing.json` 字元 1675-1682 `parameters[1].name.zh`
顯示：允許的通路寬度

「宽通路减少极端绕路，更强调火力覆盖；窄通路更强调迷宫布局。」
出處：`sources/text/defense-maze-routing.json` 字元 1766-1795 `parameters[1].effect.zh`
顯示：寬通路減少極端繞路，更強調火力覆蓋；窄通路更強調迷宮佈局。

## 原型

「用二维方格、一个入口、一个出口、两种建筑做出可预览的寻路。」
出處：`sources/text/defense-maze-routing.json` 字元 3308-3337 `prototype.firstStep.zh`
顯示：用二維方格、一個入口、一個出口、兩種建築做出可預覽的尋路。

「测试者能否说清一块墙为何值得放在这里，并根据漏怪主动改路？」
出處：`sources/text/defense-maze-routing.json` 字元 3651-3680 `prototype.test.zh`
顯示：測試者能否說清一塊牆爲何值得放在這裏，並根據漏怪主動改路？

「先不做多层地图和飞行敌人；必须先处理彻底堵路时的反馈。」
出處：`sources/text/defense-maze-routing.json` 字元 3484-3511 `prototype.pitfall.zh`
顯示：先不做多層地圖和飛行敵人；必須先處理徹底堵路時的反饋。

## 相關模式

- [進出網路](building-access-network.md)
- [服務覆蓋](building-service-coverage.md)
- [彈藥供給](defense-ammunition-supply.md)
- [目標優先](defense-target-priority.md)

## 參考來源

- [Build a longer enemy route — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/defense-maze-routing/) — 查閱：2026-11-02；取得方式：page-text。
