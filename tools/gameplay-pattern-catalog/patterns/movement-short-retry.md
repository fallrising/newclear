---
{
  "schema_version": 2,
  "id": "movement-short-retry",
  "title": "短距重試",
  "title_en": "Retry the same short segment immediately",
  "category": "movement",
  "source_category": "movement",
  "tags": [
    "precision",
    "timing",
    "information"
  ],
  "summary": "把失败变成一次有用的练习，下一次只改一个动作。",
  "note_status": "draft",
  "related": [
    "movement-auto-forward",
    "movement-run-walk-control",
    "movement-target-bounce",
    "movement-variable-jump"
  ],
  "sources": [
    {
      "title": "Retry the same short segment immediately — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/movement-short-retry/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把失败变成一次有用的练习，下一次只改一个动作。」
出處：`sources/text/movement-short-retry.json` 字元 195-218 `summary.zh`
顯示：把失敗變成一次有用的練習，下一次只改一個動作。

## 規則

「挑战被切成较短的动作段，失败后迅速回到这一段的起点，已经通过的前段不必重做。玩家利用刚看到的失败位置调整起跳或移动时机；当连续动作终于接上，就进入下一段新挑战。」
出處：`sources/text/movement-short-retry.json` 字元 331-411 `rules.zh`
顯示：挑戰被切成較短的動作段，失敗後迅速回到這一段的起點，已經通過的前段不必重做。玩家利用剛看到的失敗位置調整起跳或移動時機；當連續動作終於接上，就進入下一段新挑戰。

## 核心循環

「尝试短动作段」
出處：`sources/text/movement-short-retry.json` 字元 718-724 `loop[0].zh`
顯示：嘗試短動作段

「看到失败位置」
出處：`sources/text/movement-short-retry.json` 字元 792-798 `loop[1].zh`
顯示：看到失敗位置

「迅速回到段落起点」
出處：`sources/text/movement-short-retry.json` 字元 861-869 `loop[2].zh`
顯示：迅速回到段落起點

「修改一个动作再试」
出處：`sources/text/movement-short-retry.json` 字元 948-956 `loop[3].zh`
顯示：修改一個動作再試

「通过后进入新段」
出處：`sources/text/movement-short-retry.json` 字元 1027-1034 `loop[4].zh`
顯示：通過後進入新段

## 玩家取捨

「刚才撞上顶棚，这次提前松手，还是改变起跳位置？」
出處：`sources/text/movement-short-retry.json` 字元 1119-1142 `decisions[0].zh`
顯示：剛纔撞上頂棚，這次提前鬆手，還是改變起跳位置？

「继续使用接近成功的路线，还是换一条更稳但更慢的走法？」
出處：`sources/text/movement-short-retry.json` 字元 1263-1289 `decisions[1].zh`
顯示：繼續使用接近成功的路線，還是換一條更穩但更慢的走法？

## 可調參數

「重试段长度」
出處：`sources/text/movement-short-retry.json` 字元 1435-1440 `parameters[0].name.zh`
顯示：重試段長度

「短段方便把失败归因到一个动作，长段更强调动作的连续稳定性。」
出處：`sources/text/movement-short-retry.json` 字元 1522-1551 `parameters[0].effect.zh`
顯示：短段方便把失敗歸因到一個動作，長段更強調動作的連續穩定性。

「失败到可操作的等待」
出處：`sources/text/movement-short-retry.json` 字元 1718-1727 `parameters[1].name.zh`
顯示：失敗到可操作的等待

「等待越短越容易保留刚才的动作记忆；过短而缺乏失败提示也可能让原因不清楚。」
出處：`sources/text/movement-short-retry.json` 字元 1817-1853 `parameters[1].effect.zh`
顯示：等待越短越容易保留剛纔的動作記憶；過短而缺乏失敗提示也可能讓原因不清楚。

## 原型

「做三间各 5—10 秒可通过的房间，失败后约半秒恢复操作，并保留清晰的碰撞反馈。」
出處：`sources/text/movement-short-retry.json` 字元 3569-3609 `prototype.firstStep.zh`
顯示：做三間各 5—10 秒可通過的房間，失敗後約半秒恢復操作，並保留清晰的碰撞反饋。

「连续记录五次尝试，检查玩家是否改变失败附近的动作，而不是每次从头盲按。」
出處：`sources/text/movement-short-retry.json` 字元 4019-4054 `prototype.test.zh`
顯示：連續記錄五次嘗試，檢查玩家是否改變失敗附近的動作，而不是每次從頭盲按。

「重试太快不等于可读性好；隐藏陷阱或不稳定的重置位置仍会让玩家无法学习。」
出處：`sources/text/movement-short-retry.json` 字元 3819-3854 `prototype.pitfall.zh`
顯示：重試太快不等於可讀性好；隱藏陷阱或不穩定的重置位置仍會讓玩家無法學習。

## 相關模式

- [自動推進前進](movement-auto-forward.md)
- [奔跑與行走的距離控制](movement-run-walk-control.md)
- [目標彈跳](movement-target-bounce.md)
- [可變跳躍](movement-variable-jump.md)

## 參考來源

- [Retry the same short segment immediately — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/movement-short-retry/) — 查閱：2026-11-02；取得方式：page-text。
