---
{
  "schema_version": 2,
  "id": "projectiles-charged-release",
  "title": "蓄力後釋放",
  "title_en": "Charge, then choose when to release",
  "category": "projectiles",
  "source_category": "projectiles",
  "tags": [
    "timing",
    "risk",
    "precision"
  ],
  "summary": "多等一会儿能换强力一击，也可能把安全出手机会等没了。",
  "note_status": "draft",
  "related": [
    "projectiles-spread-recovery",
    "combat-timed-parry",
    "projectiles-active-reload",
    "projectiles-graze-reward"
  ],
  "sources": [
    {
      "title": "Charge, then choose when to release — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/projectiles-charged-release/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「多等一会儿能换强力一击，也可能把安全出手机会等没了。」
出處：`sources/text/projectiles-charged-release.json` 字元 198-224 `summary.zh`
顯示：多等一會兒能換強力一擊，也可能把安全出手機會等沒了。

## 規則

「按住攻击进入蓄力状态，松开后发射；蓄力改变伤害、射程或其他效果，并通过音效、光效或进度显示。玩家需要估计敌人的接近速度，在快速弱击与等待强击之间选择。」
出處：`sources/text/projectiles-charged-release.json` 字元 337-412 `rules.zh`
顯示：按住攻擊進入蓄力狀態，鬆開後發射；蓄力改變傷害、射程或其他效果，並通過音效、光效或進度顯示。玩家需要估計敵人的接近速度，在快速弱擊與等待強擊之間選擇。

## 核心循環

「估计安全等待时间」
出處：`sources/text/projectiles-charged-release.json` 字元 674-682 `loop[0].zh`
顯示：估計安全等待時間

「开始蓄力并保持瞄准」
出處：`sources/text/projectiles-charged-release.json` 字元 756-765 `loop[1].zh`
顯示：開始蓄力並保持瞄準

「选择时机释放」
出處：`sources/text/projectiles-charged-release.json` 字元 837-843 `loop[2].zh`
顯示：選擇時機釋放

「根据命中和敌人位置再准备」
出處：`sources/text/projectiles-charged-release.json` 字元 910-922 `loop[3].zh`
顯示：根據命中和敵人位置再準備

## 玩家取捨

「弱敌是否值得蓄满，还是快速射击更节省暴露时间？」
出處：`sources/text/projectiles-charged-release.json` 字元 1038-1061 `decisions[0].zh`
顯示：弱敵是否值得蓄滿，還是快速射擊更節省暴露時間？

「快蓄满时目标离开射线，是放弃这次蓄力还是继续追踪？」
出處：`sources/text/projectiles-charged-release.json` 字元 1171-1196 `decisions[1].zh`
顯示：快蓄滿時目標離開射線，是放棄這次蓄力還是繼續追蹤？

## 可調參數

「蓄力收益曲线」
出處：`sources/text/projectiles-charged-release.json` 字元 1363-1369 `parameters[0].name.zh`
顯示：蓄力收益曲線

「前期就有明显收益便于灵活出手；收益集中在末段会鼓励冒险等满。」
出處：`sources/text/projectiles-charged-release.json` 字元 1450-1480 `parameters[0].effect.zh`
顯示：前期就有明顯收益便於靈活出手；收益集中在末段會鼓勵冒險等滿。

「蓄力时移动限制」
出處：`sources/text/projectiles-charged-release.json` 字元 1638-1645 `parameters[1].name.zh`
顯示：蓄力時移動限制

「减速越多，蓄力越依赖提前选位；完全自由则更强调跟瞄。」
出處：`sources/text/projectiles-charged-release.json` 字元 1730-1756 `parameters[1].effect.zh`
顯示：減速越多，蓄力越依賴提前選位；完全自由則更強調跟瞄。

## 原型

「先做两档威力、一个接近目标和清楚的蓄满提示。」
出處：`sources/text/projectiles-charged-release.json` 字元 3181-3203 `prototype.firstStep.zh`
顯示：先做兩檔威力、一個接近目標和清楚的蓄滿提示。

「面对慢目标和突然贴近的目标，玩家会不会主动切换蓄力长度？」
出處：`sources/text/projectiles-charged-release.json` 字元 3481-3509 `prototype.test.zh`
顯示：面對慢目標和突然貼近的目標，玩家會不會主動切換蓄力長度？

「如果满蓄力在所有场合都最好，轻射会失去意义。」
出處：`sources/text/projectiles-charged-release.json` 字元 3336-3358 `prototype.pitfall.zh`
顯示：如果滿蓄力在所有場合都最好，輕射會失去意義。

## 相關模式

- [停火以收回彈道散布](projectiles-spread-recovery.md)
- [限時招架](combat-timed-parry.md)
- [主動裝填](projectiles-active-reload.md)
- [擦彈獎勵](projectiles-graze-reward.md)

## 參考來源

- [Charge, then choose when to release — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/projectiles-charged-release/) — 查閱：2026-11-02；取得方式：page-text。
