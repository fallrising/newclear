---
{
  "schema_version": 2,
  "id": "projectiles-spread-recovery",
  "title": "停火以收回彈道散布",
  "title_en": "Pause fire to tighten the spread",
  "category": "projectiles",
  "source_category": "projectiles",
  "tags": [
    "precision",
    "timing",
    "risk"
  ],
  "summary": "连射换来更多子弹，也可能让后续射击偏得更远。",
  "note_status": "draft",
  "related": [
    "projectiles-charged-release",
    "combat-timed-parry",
    "projectiles-active-reload",
    "projectiles-graze-reward"
  ],
  "sources": [
    {
      "title": "Pause fire to tighten the spread — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/projectiles-spread-recovery/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「连射换来更多子弹，也可能让后续射击偏得更远。」
出處：`sources/text/projectiles-spread-recovery.json` 字元 198-220 `summary.zh`
顯示：連射換來更多子彈，也可能讓後續射擊偏得更遠。

## 規則

「连续射击会累积散布或后坐偏移，停火后逐步恢复。玩家观察准星扩张和弹着，决定一直压住扳机，还是分成短点射；远近距离会改变哪种节奏更划算。」
出處：`sources/text/projectiles-spread-recovery.json` 字元 334-401 `rules.zh`
顯示：連續射擊會累積散佈或後坐偏移，停火後逐步恢復。玩家觀察準星擴張和彈着，決定一直壓住扳機，還是分成短點射；遠近距離會改變哪種節奏更划算。

## 核心循環

「估计目标距离和大小」
出處：`sources/text/projectiles-spread-recovery.json` 字元 636-645 `loop[0].zh`
顯示：估計目標距離和大小

「打一小段观察弹着」
出處：`sources/text/projectiles-spread-recovery.json` 字元 722-730 `loop[1].zh`
顯示：打一小段觀察彈着

「继续连射或松开恢复」
出處：`sources/text/projectiles-spread-recovery.json` 字元 806-815 `loop[2].zh`
顯示：繼續連射或鬆開恢復

「准度恢复后重新瞄准」
出處：`sources/text/projectiles-spread-recovery.json` 字元 896-905 `loop[3].zh`
顯示：準度恢復後重新瞄準

## 玩家取捨

「近处大目标可以承受较大散布；远处小目标是否值得少打几发换准度？」
出處：`sources/text/projectiles-spread-recovery.json` 字元 996-1027 `decisions[0].zh`
顯示：近處大目標可以承受較大散佈；遠處小目標是否值得少打幾發換準度？

「等准星收拢时，敌人是否会先走进掩体？」
出處：`sources/text/projectiles-spread-recovery.json` 字元 1174-1192 `decisions[1].zh`
顯示：等準星收攏時，敵人是否會先走進掩體？

## 可調參數

「每发累积与恢复速度」
出處：`sources/text/projectiles-spread-recovery.json` 字元 1345-1354 `parameters[0].name.zh`
顯示：每發累積與恢復速度

「累积快、恢复慢会鼓励短点射；恢复太快会让停火几乎没有代价。」
出處：`sources/text/projectiles-spread-recovery.json` 字元 1443-1472 `parameters[0].effect.zh`
顯示：累積快、恢復慢會鼓勵短點射；恢復太快會讓停火幾乎沒有代價。

「准星反馈」
出處：`sources/text/projectiles-spread-recovery.json` 字元 1638-1642 `parameters[1].name.zh`
顯示：準星反饋

「让准星大小对应可能落点，玩家才能把偏差归因于规则而非运气。」
出處：`sources/text/projectiles-spread-recovery.json` 字元 1720-1749 `parameters[1].effect.zh`
顯示：讓準星大小對應可能落點，玩家才能把偏差歸因於規則而非運氣。

## 原型

「做一个固定靶、可视准星和随射击增加、随时间下降的散布值。」
出處：`sources/text/projectiles-spread-recovery.json` 字元 3208-3236 `prototype.firstStep.zh`
顯示：做一個固定靶、可視準星和隨射擊增加、隨時間下降的散佈值。

「把靶子移远后，玩家是否自发缩短连射长度？」
出處：`sources/text/projectiles-spread-recovery.json` 字元 3558-3578 `prototype.test.zh`
顯示：把靶子移遠後，玩家是否自發縮短連射長度？

「随机散布过强会掩盖玩家输入；先保留明确的近距离命中范围。」
出處：`sources/text/projectiles-spread-recovery.json` 字元 3395-3423 `prototype.pitfall.zh`
顯示：隨機散佈過強會掩蓋玩家輸入；先保留明確的近距離命中範圍。

## 相關模式

- [蓄力後釋放](projectiles-charged-release.md)
- [限時招架](combat-timed-parry.md)
- [主動裝填](projectiles-active-reload.md)
- [擦彈獎勵](projectiles-graze-reward.md)

## 參考來源

- [Pause fire to tighten the spread — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/projectiles-spread-recovery/) — 查閱：2026-11-02；取得方式：page-text。
