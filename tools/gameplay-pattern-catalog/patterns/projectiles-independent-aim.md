---
{
  "schema_version": 2,
  "id": "projectiles-independent-aim",
  "title": "分離瞄準",
  "title_en": "Move one way, aim another",
  "category": "projectiles",
  "source_category": "projectiles",
  "tags": [
    "dexterity",
    "spatial",
    "precision"
  ],
  "summary": "移动决定自己在哪，瞄准决定攻击去哪，两件事同时做。",
  "note_status": "draft",
  "related": [
    "projectiles-ballistic-arc",
    "projectiles-graze-reward",
    "projectiles-wall-ricochet",
    "projectiles-active-reload"
  ],
  "sources": [
    {
      "title": "Move one way, aim another — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/projectiles-independent-aim/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「移动决定自己在哪，瞄准决定攻击去哪，两件事同时做。」
出處：`sources/text/projectiles-independent-aim.json` 字元 193-218 `summary.zh`
顯示：移動決定自己在哪，瞄準決定攻擊去哪，兩件事同時做。

## 規則

「玩家分别控制移动方向与攻击方向，可以边后退边攻击追兵，也能绕着目标移动。敌人逼近、弹道和场地边界持续改变安全位置；玩家既要保留射线，也要避免退进死角。」
出處：`sources/text/projectiles-independent-aim.json` 字元 346-421 `rules.zh`
顯示：玩家分別控制移動方向與攻擊方向，可以邊後退邊攻擊追兵，也能繞着目標移動。敵人逼近、彈道和場地邊界持續改變安全位置；玩家既要保留射線，也要避免退進死角。

## 核心循環

「看清威胁和可走空间」
出處：`sources/text/projectiles-independent-aim.json` 字元 706-715 `loop[0].zh`
顯示：看清威脅和可走空間

「移动到较安全的位置」
出處：`sources/text/projectiles-independent-aim.json` 字元 791-800 `loop[1].zh`
顯示：移動到較安全的位置

「把攻击保持在目标身上」
出處：`sources/text/projectiles-independent-aim.json` 字元 867-877 `loop[2].zh`
顯示：把攻擊保持在目標身上

「按新位置重新选路线」
出處：`sources/text/projectiles-independent-aim.json` 字元 943-952 `loop[3].zh`
顯示：按新位置重新選路線

## 玩家取捨

「直线后退容易持续命中，但身后是否还有路？」
出處：`sources/text/projectiles-independent-aim.json` 字元 1060-1080 `decisions[0].zh`
顯示：直線後退容易持續命中，但身後是否還有路？

「绕圈能保持距离，也可能把原本分散的敌人带到一起。」
出處：`sources/text/projectiles-independent-aim.json` 字元 1191-1215 `decisions[1].zh`
顯示：繞圈能保持距離，也可能把原本分散的敵人帶到一起。

## 可調參數

「移动时的攻击限制」
出處：`sources/text/projectiles-independent-aim.json` 字元 1367-1375 `parameters[0].name.zh`
顯示：移動時的攻擊限制

「完全独立便于持续绕行；减速或转向限制会制造短暂的停留风险。」
出處：`sources/text/projectiles-independent-aim.json` 字元 1459-1488 `parameters[0].effect.zh`
顯示：完全獨立便於持續繞行；減速或轉向限制會製造短暫的停留風險。

「场地边界与障碍」
出處：`sources/text/projectiles-independent-aim.json` 字元 1656-1663 `parameters[1].name.zh`
顯示：場地邊界與障礙

「宽阔场地重视跟瞄，小场地会增加选路和预留退路的分量。」
出處：`sources/text/projectiles-independent-aim.json` 字元 1749-1775 `parameters[1].effect.zh`
顯示：寬闊場地重視跟瞄，小場地會增加選路和預留退路的分量。

## 原型

「先做一个平面房间、鼠标瞄准、方向键移动和三名直线追赶的敌人。」
出處：`sources/text/projectiles-independent-aim.json` 字元 3232-3262 `prototype.firstStep.zh`
顯示：先做一個平面房間、鼠標瞄準、方向鍵移動和三名直線追趕的敵人。

「玩家能否边退边命中，并主动为下一次后退留空间？」
出處：`sources/text/projectiles-independent-aim.json` 字元 3556-3579 `prototype.test.zh`
顯示：玩家能否邊退邊命中，並主動爲下一次後退留空間？

「角色朝向、枪口与准星若不一致，玩家会误判发射方向。」
出處：`sources/text/projectiles-independent-aim.json` 字元 3402-3427 `prototype.pitfall.zh`
顯示：角色朝向、槍口與準星若不一致，玩家會誤判發射方向。

## 相關模式

- [拋物彈道](projectiles-ballistic-arc.md)
- [擦彈獎勵](projectiles-graze-reward.md)
- [牆面反彈](projectiles-wall-ricochet.md)
- [主動裝填](projectiles-active-reload.md)

## 參考來源

- [Move one way, aim another — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/projectiles-independent-aim/) — 查閱：2026-11-02；取得方式：page-text。
