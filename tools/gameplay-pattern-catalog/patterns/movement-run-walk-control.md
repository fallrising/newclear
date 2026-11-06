---
{
  "schema_version": 2,
  "id": "movement-run-walk-control",
  "title": "奔跑與行走的距離控制",
  "title_en": "Switch speed to control reach and landing",
  "category": "movement",
  "source_category": "movement",
  "tags": [
    "precision",
    "timing",
    "risk"
  ],
  "summary": "跑得快能跨远处，走得慢才容易对准窄路。",
  "note_status": "draft",
  "related": [
    "movement-auto-forward",
    "movement-downward-slam",
    "movement-ledge-catch",
    "movement-short-retry"
  ],
  "sources": [
    {
      "title": "Switch speed to control reach and landing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/movement-run-walk-control/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「跑得快能跨远处，走得慢才容易对准窄路。」
出處：`sources/text/movement-run-walk-control.json` 字元 202-221 `summary.zh`
顯示：跑得快能跨遠處，走得慢才容易對準窄路。

## 規則

「玩家能在较快和较慢的移动状态之间切换。快移动扩大横向跨越距离，却缩短接近危险时的反应时间；慢移动让边缘和窄落点更容易对准，玩家要在同一段路上反复改变速度。」
出處：`sources/text/movement-run-walk-control.json` 字元 341-418 `rules.zh`
顯示：玩家能在較快和較慢的移動狀態之間切換。快移動擴大橫向跨越距離，卻縮短接近危險時的反應時間；慢移動讓邊緣和窄落點更容易對準，玩家要在同一段路上反覆改變速度。

## 核心循環

「判断路面宽度与间隙」
出處：`sources/text/movement-run-walk-control.json` 字元 699-708 `loop[0].zh`
顯示：判斷路面寬度與間隙

「选择跑或走」
出處：`sources/text/movement-run-walk-control.json` 字元 779-784 `loop[1].zh`
顯示：選擇跑或走

「通过宽缝或窄路」
出處：`sources/text/movement-run-walk-control.json` 字元 853-860 `loop[2].zh`
顯示：通過寬縫或窄路

「为下个障碍调整速度」
出處：`sources/text/movement-run-walk-control.json` 字元 935-944 `loop[3].zh`
顯示：爲下個障礙調整速度

## 玩家取捨

「宽坑前要不要提速，还是先慢走到更靠近边缘的位置？」
出處：`sources/text/movement-run-walk-control.json` 字元 1043-1067 `decisions[0].zh`
顯示：寬坑前要不要提速，還是先慢走到更靠近邊緣的位置？

「落点附近有陷阱，继续跑能赶时间，但是否先切慢速确认安全？」
出處：`sources/text/movement-run-walk-control.json` 字元 1175-1203 `decisions[1].zh`
顯示：落點附近有陷阱，繼續跑能趕時間，但是否先切慢速確認安全？

## 可調參數

「快慢速度差」
出處：`sources/text/movement-run-walk-control.json` 字元 1378-1383 `parameters[0].name.zh`

「差距越大，切换的价值越清楚，但窄路上误用快跑的代价也更大。」
出處：`sources/text/movement-run-walk-control.json` 字元 1461-1490 `parameters[0].effect.zh`
顯示：差距越大，切換的價值越清楚，但窄路上誤用快跑的代價也更大。

「速度切换的过渡时间」
出處：`sources/text/movement-run-walk-control.json` 字元 1664-1673 `parameters[1].name.zh`
顯示：速度切換的過渡時間

「立即变化便于精确调整，缓慢变化则要求更早判断下一处障碍。」
出處：`sources/text/movement-run-walk-control.json` 字元 1750-1778 `parameters[1].effect.zh`
顯示：立即變化便於精確調整，緩慢變化則要求更早判斷下一處障礙。

## 原型

「制作一条 20 格长的测试路：宽坑、窄落点、贴边陷阱各一处，只提供跑走切换和跳跃。」
出處：`sources/text/movement-run-walk-control.json` 字元 3374-3415 `prototype.firstStep.zh`
顯示：製作一條 20 格長的測試路：寬坑、窄落點、貼邊陷阱各一處，只提供跑走切換和跳躍。

「记录每段采用的速度；确认同一位玩家会主动在宽坑前提速、窄路前降速。」
出處：`sources/text/movement-run-walk-control.json` 字元 3761-3794 `prototype.test.zh`
顯示：記錄每段採用的速度；確認同一位玩家會主動在寬坑前提速、窄路前降速。

「如果快跑能无代价解决所有障碍，慢走按钮就没有选择价值。」
出處：`sources/text/movement-run-walk-control.json` 字元 3599-3626 `prototype.pitfall.zh`
顯示：如果快跑能無代價解決所有障礙，慢走按鈕就沒有選擇價值。

## 相關模式

- [自動推進前進](movement-auto-forward.md)
- [承諾一次下砸](movement-downward-slam.md)
- [邊緣抓取](movement-ledge-catch.md)
- [短距重試](movement-short-retry.md)

## 參考來源

- [Switch speed to control reach and landing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/movement-run-walk-control/) — 查閱：2026-11-02；取得方式：page-text。
