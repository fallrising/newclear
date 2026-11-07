---
{
  "schema_version": 2,
  "id": "projectiles-wall-ricochet",
  "title": "牆面反彈",
  "title_en": "Bounce a shot around a corner",
  "category": "projectiles",
  "source_category": "projectiles",
  "tags": [
    "spatial",
    "precision",
    "creativity"
  ],
  "summary": "墙面成为弹道的一部分，打不到的目标也可能有间接路线。",
  "note_status": "draft",
  "related": [
    "building-modular-snapping",
    "projectiles-ballistic-arc",
    "projectiles-independent-aim",
    "building-terrain-shaping"
  ],
  "sources": [
    {
      "title": "Bounce a shot around a corner — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/projectiles-wall-ricochet/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「墙面成为弹道的一部分，打不到的目标也可能有间接路线。」
出處：`sources/text/projectiles-wall-ricochet.json` 字元 193-219 `summary.zh`
顯示：牆面成爲彈道的一部分，打不到的目標也可能有間接路線。

## 規則

「投射物碰到允许反弹的表面后改变方向，并消耗次数或能量。玩家用墙的位置与角度安排间接攻击，也要观察反弹是否把危险带回自己身边；反弹结束后重新寻找下一条路线。」
出處：`sources/text/projectiles-wall-ricochet.json` 字元 339-416 `rules.zh`
顯示：投射物碰到允許反彈的表面後改變方向，並消耗次數或能量。玩家用牆的位置與角度安排間接攻擊，也要觀察反彈是否把危險帶回自己身邊；反彈結束後重新尋找下一條路線。

## 核心循環

「寻找目标与可反弹墙面」
出處：`sources/text/projectiles-wall-ricochet.json` 字元 696-706 `loop[0].zh`
顯示：尋找目標與可反彈牆面

「选择入射角度」
出處：`sources/text/projectiles-wall-ricochet.json` 字元 783-789 `loop[1].zh`
顯示：選擇入射角度

「观察反弹后的路径」
出處：`sources/text/projectiles-wall-ricochet.json` 字元 858-866 `loop[2].zh`
顯示：觀察反彈後的路徑

「换角度或换位置再发射」
出處：`sources/text/projectiles-wall-ricochet.json` 字元 934-944 `loop[3].zh`
顯示：換角度或換位置再發射

## 玩家取捨

「直射更可靠，借墙能保持掩护但路线更难判断。」
出處：`sources/text/projectiles-wall-ricochet.json` 字元 1051-1072 `decisions[0].zh`
顯示：直射更可靠，借牆能保持掩護但路線更難判斷。

「多次反弹能扫更大范围，也可能浪费在空处或带来自伤风险。」
出處：`sources/text/projectiles-wall-ricochet.json` 字元 1196-1223 `decisions[1].zh`
顯示：多次反彈能掃更大範圍，也可能浪費在空處或帶來自傷風險。

## 可調參數

「反弹次数与能量保留」
出處：`sources/text/projectiles-wall-ricochet.json` 字元 1382-1391 `parameters[0].name.zh`
顯示：反彈次數與能量保留

「次数多会放大场地几何的重要性；逐次衰减能限制无限扫场。」
出處：`sources/text/projectiles-wall-ricochet.json` 字元 1485-1512 `parameters[0].effect.zh`
顯示：次數多會放大場地幾何的重要性；逐次衰減能限制無限掃場。

「可反弹表面的辨识」
出處：`sources/text/projectiles-wall-ricochet.json` 字元 1664-1672 `parameters[1].name.zh`
顯示：可反彈表面的辨識

「材质与标记应清楚区分反弹、吸收和穿透，避免靠猜。」
出處：`sources/text/projectiles-wall-ricochet.json` 字元 1751-1775 `parameters[1].effect.zh`
顯示：材質與標記應清楚區分反彈、吸收和穿透，避免靠猜。

## 原型

「做一个房间、一种固定速度的弹丸和最多一次反弹，先显示路线辅助线。」
出處：`sources/text/projectiles-wall-ricochet.json` 字元 3134-3166 `prototype.firstStep.zh`
顯示：做一個房間、一種固定速度的彈丸和最多一次反彈，先顯示路線輔助線。

「玩家能否在第二次尝试前预测弹丸会从哪面墙离开？」
出處：`sources/text/projectiles-wall-ricochet.json` 字元 3481-3504 `prototype.test.zh`
顯示：玩家能否在第二次嘗試前預測彈丸會從哪面牆離開？

「角落、薄墙和高速碰撞最容易让反弹结果失真。」
出處：`sources/text/projectiles-wall-ricochet.json` 字元 3314-3335 `prototype.pitfall.zh`
顯示：角落、薄牆和高速碰撞最容易讓反彈結果失真。

## 相關模式

- [模組吸附決策](building-modular-snapping.md)
- [拋物彈道](projectiles-ballistic-arc.md)
- [分離瞄準](projectiles-independent-aim.md)
- [地形塑形](building-terrain-shaping.md)

## 參考來源

- [Bounce a shot around a corner — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/projectiles-wall-ricochet/) — 查閱：2026-11-02；取得方式：page-text。
