---
{
  "schema_version": 2,
  "id": "projectiles-maintain-lock",
  "title": "維持鎖定",
  "title_en": "Keep a target inside the lock zone",
  "category": "projectiles",
  "source_category": "projectiles",
  "tags": [
    "precision",
    "time",
    "risk"
  ],
  "summary": "先付出持续追踪的时间，再换取发射时的命中帮助。",
  "note_status": "draft",
  "related": [
    "projectiles-charged-release",
    "projectiles-graze-reward",
    "projectiles-spread-recovery",
    "projectiles-active-reload"
  ],
  "sources": [
    {
      "title": "Keep a target inside the lock zone — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/projectiles-maintain-lock/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先付出持续追踪的时间，再换取发射时的命中帮助。」
出處：`sources/text/projectiles-maintain-lock.json` 字元 197-220 `summary.zh`
顯示：先付出持續追蹤的時間，再換取發射時的命中幫助。

## 規則

「目标进入锁定区域后开始累积锁定，离开范围、遮挡或超过时限会中断或削弱进度。玩家需保持视线并等待提示，再发射追踪弹或已分配的弹药；等待期间仍可能受到反击。」
出處：`sources/text/projectiles-maintain-lock.json` 字元 332-408 `rules.zh`
顯示：目標進入鎖定區域後開始累積鎖定，離開範圍、遮擋或超過時限會中斷或削弱進度。玩家需保持視線並等待提示，再發射追蹤彈或已分配的彈藥；等待期間仍可能受到反擊。

## 核心循環

「把目标放进锁定范围」
出處：`sources/text/projectiles-maintain-lock.json` 字元 675-684 `loop[0].zh`
顯示：把目標放進鎖定範圍

「维持视线等待标记」
出處：`sources/text/projectiles-maintain-lock.json` 字元 761-769 `loop[1].zh`
顯示：維持視線等待標記

「确认锁定后发射」
出處：`sources/text/projectiles-maintain-lock.json` 字元 845-852 `loop[2].zh`
顯示：確認鎖定後發射

「观察命中并寻找下一个目标」
出處：`sources/text/projectiles-maintain-lock.json` 字元 926-938 `loop[3].zh`
顯示：觀察命中並尋找下一個目標

## 玩家取捨

「先发射少量已锁定弹药，还是多等一会儿争取完整齐射？」
出處：`sources/text/projectiles-maintain-lock.json` 字元 1043-1068 `decisions[0].zh`
顯示：先發射少量已鎖定彈藥，還是多等一會兒爭取完整齊射？

「追踪高价值目标时，是否应该放弃锁定先躲开眼前攻击？」
出處：`sources/text/projectiles-maintain-lock.json` 字元 1167-1192 `decisions[1].zh`
顯示：追蹤高價值目標時，是否應該放棄鎖定先躲開眼前攻擊？

## 可調參數

「锁定时间与范围」
出處：`sources/text/projectiles-maintain-lock.json` 字元 1329-1336 `parameters[0].name.zh`
顯示：鎖定時間與範圍

「宽范围、短等待降低跟瞄负担；窄范围、长等待更强调稳定追踪。」
出處：`sources/text/projectiles-maintain-lock.json` 字元 1416-1445 `parameters[0].effect.zh`
顯示：寬範圍、短等待降低跟瞄負擔；窄範圍、長等待更強調穩定追蹤。

「失去目标后的保留时间」
出處：`sources/text/projectiles-maintain-lock.json` 字元 1620-1630 `parameters[1].name.zh`
顯示：失去目標後的保留時間

「短暂保留能容忍小遮挡；立即清空会强化找安全射线的压力。」
出處：`sources/text/projectiles-maintain-lock.json` 字元 1721-1748 `parameters[1].effect.zh`
顯示：短暫保留能容忍小遮擋；立即清空會強化找安全射線的壓力。

## 原型

「做一个来回移动的靶子、一个锁定圈和一根遮挡柱，先不做网络对抗。」
出處：`sources/text/projectiles-maintain-lock.json` 字元 3174-3205 `prototype.firstStep.zh`
顯示：做一個來回移動的靶子、一個鎖定圈和一根遮擋柱，先不做網絡對抗。

「玩家能否判断锁定为什么中断，并为了保持视线改变位置？」
出處：`sources/text/projectiles-maintain-lock.json` 字元 3519-3545 `prototype.test.zh`
顯示：玩家能否判斷鎖定爲什麼中斷，併爲了保持視線改變位置？

「锁定成功不应被误读为必定命中；障碍和有效距离要用反馈说明。」
出處：`sources/text/projectiles-maintain-lock.json` 字元 3344-3373 `prototype.pitfall.zh`
顯示：鎖定成功不應被誤讀爲必定命中；障礙和有效距離要用反饋說明。

## 相關模式

- [蓄力後釋放](projectiles-charged-release.md)
- [擦彈獎勵](projectiles-graze-reward.md)
- [停火以收回彈道散布](projectiles-spread-recovery.md)
- [主動裝填](projectiles-active-reload.md)

## 參考來源

- [Keep a target inside the lock zone — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/projectiles-maintain-lock/) — 查閱：2026-11-02；取得方式：page-text。
