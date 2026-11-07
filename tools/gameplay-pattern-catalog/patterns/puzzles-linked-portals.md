---
{
  "schema_version": 2,
  "id": "puzzles-linked-portals",
  "title": "聯動傳送門",
  "title_en": "Paired portal connections",
  "category": "puzzles",
  "source_category": "puzzles",
  "tags": [
    "spatial",
    "planning",
    "cooperation"
  ],
  "summary": "把两个表面变成相邻位置，重新组织路线。",
  "note_status": "draft",
  "related": [
    "puzzles-beam-routing",
    "puzzles-box-pushing",
    "puzzles-gravity",
    "puzzles-paper-folding"
  ],
  "sources": [
    {
      "title": "Paired portal connections — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/puzzles-linked-portals/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把两个表面变成相邻位置，重新组织路线。」
出處：`sources/text/puzzles-linked-portals.json` 字元 177-196 `summary.zh`
顯示：把兩個表面變成相鄰位置，重新組織路線。

## 規則

「玩家在允许的表面放置一对互通入口，让角色或物体从一个入口穿出另一个。入口位置、朝向与进出速度共同决定结果，玩家通过更换入口反复检验空间方案。」
出處：`sources/text/puzzles-linked-portals.json` 字元 291-361 `rules.zh`
顯示：玩家在允許的表面放置一對互通入口，讓角色或物體從一個入口穿出另一個。入口位置、朝向與進出速度共同決定結果，玩家通過更換入口反覆檢驗空間方案。

## 核心循環

「寻找可放置表面」
出處：`sources/text/puzzles-linked-portals.json` 字元 595-602 `loop[0].zh`
顯示：尋找可放置表面

「建立入口与出口」
出處：`sources/text/puzzles-linked-portals.json` 字元 668-675 `loop[1].zh`
顯示：建立入口與出口

「送入角色或物体」
出處：`sources/text/puzzles-linked-portals.json` 字元 742-749 `loop[2].zh`
顯示：送入角色或物體

「检验落点并调整」
出處：`sources/text/puzzles-linked-portals.json` 字元 827-834 `loop[3].zh`
顯示：檢驗落點並調整

## 玩家取捨

「入口靠近目标，还是先获得足够的进入速度？」
出處：`sources/text/puzzles-linked-portals.json` 字元 924-944 `decisions[0].zh`
顯示：入口靠近目標，還是先獲得足夠的進入速度？

「替换入口会不会切断仍需使用的通路？」
出處：`sources/text/puzzles-linked-portals.json` 字元 1047-1064 `decisions[1].zh`
顯示：替換入口會不會切斷仍需使用的通路？

## 可調參數

「有效表面密度」
出處：`sources/text/puzzles-linked-portals.json` 字元 1201-1207 `parameters[0].name.zh`

「限制表面强化解题方向；大量表面增加搜索空间。」
出處：`sources/text/puzzles-linked-portals.json` 字元 1286-1308 `parameters[0].effect.zh`
顯示：限制表面強化解題方向；大量表面增加搜索空間。

「同时连接数」
出處：`sources/text/puzzles-linked-portals.json` 字元 1448-1453 `parameters[1].name.zh`
顯示：同時連接數

「单对入口降低记忆负担；多对支持协作网络。」
出處：`sources/text/puzzles-linked-portals.json` 字元 1531-1551 `parameters[1].effect.zh`
顯示：單對入口降低記憶負擔；多對支持協作網絡。

## 原型

「先做二维成对传送、速度方向转换和一种可放置表面。」
出處：`sources/text/puzzles-linked-portals.json` 字元 2954-2978 `prototype.firstStep.zh`
顯示：先做二維成對傳送、速度方向轉換和一種可放置表面。

「观察玩家能否利用入口朝向预测出口方向，并稳定复现同一次穿越。」
出處：`sources/text/puzzles-linked-portals.json` 字元 3305-3335 `prototype.test.zh`
顯示：觀察玩家能否利用入口朝向預測出口方向，並穩定復現同一次穿越。

「完整三维需要处理相机、穿门碰撞和递归画面；不要把它当作普通传送按钮。」
出處：`sources/text/puzzles-linked-portals.json` 字元 3121-3155 `prototype.pitfall.zh`
顯示：完整三維需要處理相機、穿門碰撞和遞歸畫面；不要把它當作普通傳送按鈕。

## 相關模式

- [光束路由](puzzles-beam-routing.md)
- [不可逆推動與位置可達性](puzzles-box-pushing.md)
- [重力決策](puzzles-gravity.md)
- [摺疊地形以連接路線](puzzles-paper-folding.md)

## 參考來源

- [Paired portal connections — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/puzzles-linked-portals/) — 查閱：2026-11-02；取得方式：page-text。
