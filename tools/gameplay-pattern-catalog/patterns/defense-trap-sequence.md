---
{
  "schema_version": 2,
  "id": "defense-trap-sequence",
  "title": "陷阱序列",
  "title_en": "Chain traps into a sequence",
  "category": "defense",
  "source_category": "defense",
  "tags": [
    "spatial",
    "planning",
    "timing"
  ],
  "summary": "先减速、再集中、再造成伤害，让几个普通陷阱一起发挥作用。",
  "note_status": "draft",
  "related": [
    "defense-maze-routing",
    "automation-aerial-logistics",
    "automation-belt-routing",
    "automation-flow-splitting"
  ],
  "sources": [
    {
      "title": "Chain traps into a sequence — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/defense-trap-sequence/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先减速、再集中、再造成伤害，让几个普通陷阱一起发挥作用。」
出處：`sources/text/defense-trap-sequence.json` 字元 180-208 `summary.zh`
顯示：先減速、再集中、再造成傷害，讓幾個普通陷阱一起發揮作用。

## 規則

「玩家利用道路和陷阱位置安排敌人受到效果的先后顺序。减速让敌人多留一会，推动改变位置，伤害陷阱完成击杀；预算、装填间隔和触发范围限制摆法，实际触发顺序揭示组合是否成立。」
出處：`sources/text/defense-trap-sequence.json` 字元 328-411 `rules.zh`
顯示：玩家利用道路和陷阱位置安排敵人受到效果的先後順序。減速讓敵人多留一會，推動改變位置，傷害陷阱完成擊殺；預算、裝填間隔和觸發範圍限制擺法，實際觸發順序揭示組合是否成立。

## 核心循環

「找出敌人必经的狭窄位置」
出處：`sources/text/defense-trap-sequence.json` 字元 748-759 `loop[0].zh`
顯示：找出敵人必經的狹窄位置

「安排控制与伤害的顺序」
出處：`sources/text/defense-trap-sequence.json` 字元 841-851 `loop[1].zh`
顯示：安排控制與傷害的順序

「观察陷阱触发与恢复」
出處：`sources/text/defense-trap-sequence.json` 字元 927-936 `loop[2].zh`
顯示：觀察陷阱觸發與恢復

「调整间距或补足缺环」
出處：`sources/text/defense-trap-sequence.json` 字元 1009-1018 `loop[3].zh`
顯示：調整間距或補足缺環

## 玩家取捨

「把两个陷阱靠近方便接力，却可能同时进入冷却，放过后面的敌人。」
出處：`sources/text/defense-trap-sequence.json` 字元 1122-1152 `decisions[0].zh`
顯示：把兩個陷阱靠近方便接力，卻可能同時進入冷卻，放過後面的敵人。

「先推动还是先减速？同样两个效果，顺序变化可能让敌人离开伤害区。」
出處：`sources/text/defense-trap-sequence.json` 字元 1279-1310 `decisions[1].zh`
顯示：先推動還是先減速？同樣兩個效果，順序變化可能讓敵人離開傷害區。

## 可調參數

「触发间隔」
出處：`sources/text/defense-trap-sequence.json` 字元 1480-1484 `parameters[0].name.zh`
顯示：觸發間隔

「间隔长时必须管理敌人队列；短间隔更依赖整体输出与资源预算。」
出處：`sources/text/defense-trap-sequence.json` 字元 1562-1591 `parameters[0].effect.zh`
顯示：間隔長時必須管理敵人隊列；短間隔更依賴整體輸出與資源預算。

「位移强度」
出處：`sources/text/defense-trap-sequence.json` 字元 1752-1756 `parameters[1].name.zh`
顯示：位移強度

「推得远能利用环境，但也可能把目标推出下一道陷阱。」
出處：`sources/text/defense-trap-sequence.json` 字元 1839-1863 `parameters[1].effect.zh`
顯示：推得遠能利用環境，但也可能把目標推出下一道陷阱。

## 原型

「用一条路线和减速、推力、范围伤害三种陷阱做可重复的短波次。」
出處：`sources/text/defense-trap-sequence.json` 字元 3374-3403 `prototype.firstStep.zh`
顯示：用一條路線和減速、推力、範圍傷害三種陷阱做可重複的短波次。

「测试者能否通过调换顺序或间距，稳定改变同一波的结果？」
出處：`sources/text/defense-trap-sequence.json` 字元 3733-3759 `prototype.test.zh`
顯示：測試者能否通過調換順序或間距，穩定改變同一波的結果？

「先用简单二维碰撞；大量刚体和联机同步会显著增加调试成本。」
出處：`sources/text/defense-trap-sequence.json` 字元 3542-3570 `prototype.pitfall.zh`
顯示：先用簡單二維碰撞；大量剛體和聯機同步會顯著增加調試成本。

## 相關模式

- [路徑路由](defense-maze-routing.md)
- [空中搬運物流](automation-aerial-logistics.md)
- [受限空間中的物流路由](automation-belt-routing.md)
- [流量分流](automation-flow-splitting.md)

## 參考來源

- [Chain traps into a sequence — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/defense-trap-sequence/) — 查閱：2026-11-02；取得方式：page-text。
