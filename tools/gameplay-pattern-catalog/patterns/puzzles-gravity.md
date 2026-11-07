---
{
  "schema_version": 2,
  "id": "puzzles-gravity",
  "title": "重力決策",
  "title_en": "Changing gravity direction",
  "category": "puzzles",
  "source_category": "puzzles",
  "tags": [
    "spatial",
    "dexterity",
    "planning"
  ],
  "summary": "重新定义下方，把障碍变成落脚点。",
  "note_status": "draft",
  "related": [
    "puzzles-beam-routing",
    "puzzles-box-pushing",
    "puzzles-linked-portals",
    "puzzles-paper-folding"
  ],
  "sources": [
    {
      "title": "Changing gravity direction — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/puzzles-gravity/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「重新定义下方，把障碍变成落脚点。」
出處：`sources/text/puzzles-gravity.json` 字元 170-186 `summary.zh`
顯示：重新定義下方，把障礙變成落腳點。

## 規則

「玩家改变角色或场景的重力方向，用坠落跨越常规跳跃无法到达的路径。每次切换都要预判落点、障碍与移动物体；角色轨迹直接显示推理是否正确。」
出處：`sources/text/puzzles-gravity.json` 字元 278-344 `rules.zh`
顯示：玩家改變角色或場景的重力方向，用墜落跨越常規跳躍無法到達的路徑。每次切換都要預判落點、障礙與移動物體；角色軌跡直接顯示推理是否正確。

## 核心循環

「观察下一个安全面」
出處：`sources/text/puzzles-gravity.json` 字元 581-589 `loop[0].zh`
顯示：觀察下一個安全面

「选择切换位置」
出處：`sources/text/puzzles-gravity.json` 字元 659-665 `loop[1].zh`
顯示：選擇切換位置

「改变重力并移动」
出處：`sources/text/puzzles-gravity.json` 字元 736-743 `loop[2].zh`
顯示：改變重力並移動

「落稳后规划下一步」
出處：`sources/text/puzzles-gravity.json` 字元 810-818 `loop[3].zh`
顯示：落穩後規劃下一步

## 玩家取捨

「提前翻转获得反应时间，还是贴近边缘获得更好轨迹？」
出處：`sources/text/puzzles-gravity.json` 字元 910-934 `decisions[0].zh`
顯示：提前翻轉獲得反應時間，還是貼近邊緣獲得更好軌跡？

「全场重力改变时，危险物会不会先到终点？」
出處：`sources/text/puzzles-gravity.json` 字元 1049-1068 `decisions[1].zh`
顯示：全場重力改變時，危險物會不會先到終點？

## 可調參數

「切换条件」
出處：`sources/text/puzzles-gravity.json` 字元 1202-1206 `parameters[0].name.zh`
顯示：切換條件

「接触地面才能切换强化路径推理；空中切换更偏操控。」
出處：`sources/text/puzzles-gravity.json` 字元 1285-1309 `parameters[0].effect.zh`
顯示：接觸地面才能切換強化路徑推理；空中切換更偏操控。

「影响范围」
出處：`sources/text/puzzles-gravity.json` 字元 1452-1456 `parameters[1].name.zh`
顯示：影響範圍

「只影响角色易读；影响全场增加联动解谜。」
出處：`sources/text/puzzles-gravity.json` 字元 1532-1551 `parameters[1].effect.zh`
顯示：隻影響角色易讀；影響全場增加聯動解謎。

## 原型

「先只切换角色的上下重力，制作一间有静态障碍的房间。」
出處：`sources/text/puzzles-gravity.json` 字元 2957-2982 `prototype.firstStep.zh`
顯示：先只切換角色的上下重力，製作一間有靜態障礙的房間。

「让玩家翻转前指出预计落点，检查是否理解轨迹而非碰运气。」
出處：`sources/text/puzzles-gravity.json` 字元 3318-3345 `prototype.test.zh`
顯示：讓玩家翻轉前指出預計落點，檢查是否理解軌跡而非碰運氣。

「让所有物体一起翻转会增加碰撞状态；先确认角色操作和镜头容易理解。」
出處：`sources/text/puzzles-gravity.json` 字元 3125-3157 `prototype.pitfall.zh`
顯示：讓所有物體一起翻轉會增加碰撞狀態；先確認角色操作和鏡頭容易理解。

## 相關模式

- [光束路由](puzzles-beam-routing.md)
- [不可逆推動與位置可達性](puzzles-box-pushing.md)
- [聯動傳送門](puzzles-linked-portals.md)
- [摺疊地形以連接路線](puzzles-paper-folding.md)

## 參考來源

- [Changing gravity direction — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/puzzles-gravity/) — 查閱：2026-11-02；取得方式：page-text。
