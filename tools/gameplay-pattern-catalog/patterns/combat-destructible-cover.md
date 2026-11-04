---
{
  "schema_version": 2,
  "id": "combat-destructible-cover",
  "title": "可破壞掩體",
  "title_en": "Destroying cover to reshape a fight",
  "category": "combat",
  "source_category": "combat",
  "tags": [
    "spatial",
    "planning",
    "risk"
  ],
  "summary": "拆掉挡路或挡枪的东西，让原本安全的位置变危险。",
  "note_status": "draft",
  "related": [
    "combat-cover-flanking",
    "combat-forced-movement",
    "combat-friendly-fire",
    "combat-overwatch"
  ],
  "sources": [
    {
      "title": "Destroying cover to reshape a fight — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/combat-destructible-cover/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「拆掉挡路或挡枪的东西，让原本安全的位置变危险。」
出處：`sources/text/combat-destructible-cover.json` 字元 190-213 `summary.zh`
顯示：拆掉擋路或擋槍的東西，讓原本安全的位置變危險。

## 規則

「墙和掩体不是永久边界，特定攻击能把它们破坏。玩家可以先花稀缺资源开洞或清除保护，再让其他单位利用新的视线和路线；同一次破坏也可能暴露自己的队员，因此要按改变后的地图继续行动。」
出處：`sources/text/combat-destructible-cover.json` 字元 327-414 `rules.zh`
顯示：牆和掩體不是永久邊界，特定攻擊能把它們破壞。玩家可以先花稀缺資源開洞或清除保護，再讓其他單位利用新的視線和路線；同一次破壞也可能暴露自己的隊員，因此要按改變後的地圖繼續行動。

## 核心循環

「识别保护和阻挡」
出處：`sources/text/combat-destructible-cover.json` 字元 710-717 `loop[0].zh`
顯示：識別保護和阻擋

「选择破坏目标」
出處：`sources/text/combat-destructible-cover.json` 字元 791-797 `loop[1].zh`
顯示：選擇破壞目標

「结算新视线与路线」
出處：`sources/text/combat-destructible-cover.json` 字元 863-871 `loop[2].zh`
顯示：結算新視線與路線

「利用缺口重新部署」
出處：`sources/text/combat-destructible-cover.json` 字元 943-951 `loop[3].zh`

## 玩家取捨

「现在用掉爆炸物消除掩体，还是留给后面的敌人？」
出處：`sources/text/combat-destructible-cover.json` 字元 1035-1057 `decisions[0].zh`
顯示：現在用掉爆炸物消除掩體，還是留給後面的敵人？

「开出射线是否也会让自己的后排被敌人看见？」
出處：`sources/text/combat-destructible-cover.json` 字元 1161-1181 `decisions[1].zh`
顯示：開出射線是否也會讓自己的後排被敵人看見？

## 可調參數

「可破坏范围」
出處：`sources/text/combat-destructible-cover.json` 字元 1319-1324 `parameters[0].name.zh`
顯示：可破壞範圍

「只破坏指定格子容易预测；复杂建筑坍塌会扩大制作和理解成本。」
出處：`sources/text/combat-destructible-cover.json` 字元 1404-1433 `parameters[0].effect.zh`
顯示：只破壞指定格子容易預測；複雜建築坍塌會擴大製作和理解成本。

「破坏资源稀缺度」
出處：`sources/text/combat-destructible-cover.json` 字元 1609-1616 `parameters[1].name.zh`
顯示：破壞資源稀缺度

「次数越少，开哪一个口越重要；无限破坏可能让掩体失去价值。」
出處：`sources/text/combat-destructible-cover.json` 字元 1698-1726 `parameters[1].effect.zh`
顯示：次數越少，開哪一個口越重要；無限破壞可能讓掩體失去價值。

## 原型

「用格子地图中可切换“完整／摧毁”的矮墙，重算通路和视线；不做真实碎裂模拟。」
出處：`sources/text/combat-destructible-cover.json` 字元 3176-3213 `prototype.firstStep.zh`
顯示：用格子地圖中可切換“完整／摧毀”的矮牆，重算通路和視線；不做真實碎裂模擬。

「破坏同一堵墙前后，让试玩者指出新增路线、暴露目标和自己失去的保护。」
出處：`sources/text/combat-destructible-cover.json` 字元 3570-3603 `prototype.test.zh`
顯示：破壞同一堵牆前後，讓試玩者指出新增路線、暴露目標和自己失去的保護。

「画面已经炸开但寻路仍然绕墙，或看似完整却不再挡枪，会破坏理解。」
出處：`sources/text/combat-destructible-cover.json` 字元 3382-3413 `prototype.pitfall.zh`
顯示：畫面已經炸開但尋路仍然繞牆，或看似完整卻不再擋槍，會破壞理解。

## 相關模式

- [掩體側擊](combat-cover-flanking.md)
- [強制移動](combat-forced-movement.md)
- [範圍攻擊的友方誤傷](combat-friendly-fire.md)
- [警戒射擊](combat-overwatch.md)

## 參考來源

- [Destroying cover to reshape a fight — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/combat-destructible-cover/) — 查閱：2026-11-02；取得方式：page-text。
