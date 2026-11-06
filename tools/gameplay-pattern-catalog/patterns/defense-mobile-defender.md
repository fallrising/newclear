---
{
  "schema_version": 2,
  "id": "defense-mobile-defender",
  "title": "移動中防守者",
  "title_en": "Move a defender to the breach",
  "category": "defense",
  "source_category": "defense",
  "tags": [
    "dexterity",
    "planning",
    "risk"
  ],
  "summary": "固定防线顾不过来时，玩家本人就是可以移动的最后一道补丁。",
  "note_status": "draft",
  "related": [
    "defense-day-night-investment",
    "defense-resistance-counters",
    "combat-cover-flanking",
    "combat-destructible-cover"
  ],
  "sources": [
    {
      "title": "Move a defender to the breach — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/defense-mobile-defender/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「固定防线顾不过来时，玩家本人就是可以移动的最后一道补丁。」
出處：`sources/text/defense-mobile-defender.json` 字元 183-211 `summary.zh`
顯示：固定防線顧不過來時，玩家本人就是可以移動的最後一道補丁。

## 規則

「自动防御持续工作，玩家同时控制一个能移动、攻击或拦截的角色。不同入口出现危险时，玩家要决定赶往哪边，承担移动时间与离开另一条线的代价；敌人突破、设施受损和角色状态给出反馈。」
出處：`sources/text/defense-mobile-defender.json` 字元 337-423 `rules.zh`
顯示：自動防禦持續工作，玩家同時控制一個能移動、攻擊或攔截的角色。不同入口出現危險時，玩家要決定趕往哪邊，承擔移動時間與離開另一條線的代價；敵人突破、設施受損和角色狀態給出反饋。

## 核心循環

「观察哪条线先失守」
出處：`sources/text/defense-mobile-defender.json` 字元 734-742 `loop[0].zh`
顯示：觀察哪條線先失守

「赶往缺口并介入」
出處：`sources/text/defense-mobile-defender.json` 字元 824-831 `loop[1].zh`
顯示：趕往缺口並介入

「暂时稳住局面」
出處：`sources/text/defense-mobile-defender.json` 字元 907-913 `loop[2].zh`
顯示：暫時穩住局面

「转移或退回安全位置」
出處：`sources/text/defense-mobile-defender.json` 字元 982-991 `loop[3].zh`
顯示：轉移或退回安全位置

## 玩家取捨

「救一座快倒的塔，还是拦住已经越过塔的敌人？」
出處：`sources/text/defense-mobile-defender.json` 字元 1093-1114 `decisions[0].zh`
顯示：救一座快倒的塔，還是攔住已經越過塔的敵人？

「亲自补防节省建设费用，却把安全建立在持续操作上。」
出處：`sources/text/defense-mobile-defender.json` 字元 1219-1243 `decisions[1].zh`
顯示：親自補防節省建設費用，卻把安全建立在持續操作上。

## 可調參數

「移动速度」
出處：`sources/text/defense-mobile-defender.json` 字元 1421-1425 `parameters[0].name.zh`
顯示：移動速度

「速度越慢，换线越像承诺；速度快则更强调连续救火。」
出處：`sources/text/defense-mobile-defender.json` 字元 1499-1523 `parameters[0].effect.zh`
顯示：速度越慢，換線越像承諾；速度快則更強調連續救火。

「角色与塔的伤害占比」
出處：`sources/text/defense-mobile-defender.json` 字元 1690-1699 `parameters[1].name.zh`
顯示：角色與塔的傷害佔比

「角色太强会削弱布局意义；太弱则补防缺乏可感知的作用。」
出處：`sources/text/defense-mobile-defender.json` 字元 1793-1819 `parameters[1].effect.zh`
顯示：角色太強會削弱佈局意義；太弱則補防缺乏可感知的作用。

## 原型

「做两条短路线、自动箭塔和一个可移动攻击的圆形角色。」
出處：`sources/text/defense-mobile-defender.json` 字元 3340-3365 `prototype.firstStep.zh`
顯示：做兩條短路線、自動箭塔和一個可移動攻擊的圓形角色。

「玩家是否能主动判断该去哪边，而不是随机奔跑碰巧救场？」
出處：`sources/text/defense-mobile-defender.json` 字元 3681-3707 `prototype.test.zh`
顯示：玩家是否能主動判斷該去哪邊，而不是隨機奔跑碰巧救場？

「先不加入复杂技能树；让缺口警告可读，避免玩家只能盯着两个角落。」
出處：`sources/text/defense-mobile-defender.json` 字元 3499-3530 `prototype.pitfall.zh`
顯示：先不加入複雜技能樹；讓缺口警告可讀，避免玩家只能盯着兩個角落。

## 相關模式

- [日間夜間投入](defense-day-night-investment.md)
- [抗性克制](defense-resistance-counters.md)
- [掩體側擊](combat-cover-flanking.md)
- [可破壞掩體](combat-destructible-cover.md)

## 參考來源

- [Move a defender to the breach — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/defense-mobile-defender/) — 查閱：2026-11-02；取得方式：page-text。
