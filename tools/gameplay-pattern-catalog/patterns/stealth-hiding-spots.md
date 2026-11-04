---
{
  "schema_version": 2,
  "id": "stealth-hiding-spots",
  "title": "藏點與脫離時機",
  "title_en": "Hiding spots and exit timing",
  "category": "stealth",
  "source_category": "stealth",
  "tags": [
    "timing",
    "risk",
    "information"
  ],
  "summary": "柜子提供暂时安全，却把自由行动换成了等待出口时机。",
  "note_status": "draft",
  "related": [
    "exploration-stealth-awareness",
    "stealth-disguise-access",
    "stealth-light-shadow",
    "stealth-peeking"
  ],
  "sources": [
    {
      "title": "Hiding spots and exit timing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/stealth-hiding-spots/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「柜子提供暂时安全，却把自由行动换成了等待出口时机。」
出處：`sources/text/stealth-hiding-spots.json` 字元 181-206 `summary.zh`
顯示：櫃子提供暫時安全，卻把自由行動換成了等待出口時機。

## 規則

「玩家进入柜子、箱体等专用藏身点，暂时离开普通视野判定；随后观察外界再出来。进入过程被看见是否失效、藏点是否已占用、出口能看到多少都应明确，不能让藏点成为无条件消除追踪的按钮。」
出處：`sources/text/stealth-hiding-spots.json` 字元 319-406 `rules.zh`
顯示：玩家進入櫃子、箱體等專用藏身點，暫時離開普通視野判定；隨後觀察外界再出來。進入過程被看見是否失效、藏點是否已佔用、出口能看到多少都應明確，不能讓藏點成爲無條件消除追蹤的按鈕。

## 核心循環

「发现可用藏身点」
出處：`sources/text/stealth-hiding-spots.json` 字元 685-692 `loop[0].zh`
顯示：發現可用藏身點

「趁无人看到时进入」
出處：`sources/text/stealth-hiding-spots.json` 字元 767-775 `loop[1].zh`
顯示：趁無人看到時進入

「判断外部巡逻」
出處：`sources/text/stealth-hiding-spots.json` 字元 847-853 `loop[2].zh`
顯示：判斷外部巡邏

「择机出来继续移动」
出處：`sources/text/stealth-hiding-spots.json` 字元 922-930 `loop[3].zh`
顯示：擇機出來繼續移動

## 玩家取捨

「现在躲进去等待，还是趁巡逻空当继续前进？」
出處：`sources/text/stealth-hiding-spots.json` 字元 1019-1039 `decisions[0].zh`
顯示：現在躲進去等待，還是趁巡邏空當繼續前進？

「出口视野不完整时，是多等一轮还是冒险出来侦察？」
出處：`sources/text/stealth-hiding-spots.json` 字元 1144-1167 `decisions[1].zh`
顯示：出口視野不完整時，是多等一輪還是冒險出來偵察？

## 可調參數

「进出耗时」
出處：`sources/text/stealth-hiding-spots.json` 字元 1322-1326 `parameters[0].name.zh`
顯示：進出耗時

「耗时越长，藏点越像预先安排的落脚处，而不是即时逃生按钮。」
出處：`sources/text/stealth-hiding-spots.json` 字元 1407-1435 `parameters[0].effect.zh`
顯示：耗時越長，藏點越像預先安排的落腳處，而不是即時逃生按鈕。

「内部可见范围」
出處：`sources/text/stealth-hiding-spots.json` 字元 1573-1579 `parameters[1].name.zh`
顯示：內部可見範圍

「视野越窄，离开时越不确定；应给声音或缝隙视线作为判断线索。」
出處：`sources/text/stealth-hiding-spots.json` 字元 1657-1686 `parameters[1].effect.zh`
顯示：視野越窄，離開時越不確定；應給聲音或縫隙視線作爲判斷線索。

## 原型

「做一个柜子和一个往返守卫，进入后限制移动并保留一个小观察窗口。」
出處：`sources/text/stealth-hiding-spots.json` 字元 3078-3109 `prototype.firstStep.zh`
顯示：做一個櫃子和一個往返守衛，進入後限制移動並保留一個小觀察窗口。

「玩家会不会在出来前主动检查巡逻，而不是把柜子当作无限暂停键？」
出處：`sources/text/stealth-hiding-spots.json` 字元 3443-3473 `prototype.test.zh`
顯示：玩家會不會在出來前主動檢查巡邏，而不是把櫃子當作無限暫停鍵？

「必须规定被看见钻入时会怎样；否则玩家无法理解为何这次藏住、下次却失败。」
出處：`sources/text/stealth-hiding-spots.json` 字元 3271-3306 `prototype.pitfall.zh`
顯示：必須規定被看見鑽入時會怎樣；否則玩家無法理解爲何這次藏住、下次卻失敗。

## 相關模式

- [潛行警戒](exploration-stealth-awareness.md)
- [偽裝進出](stealth-disguise-access.md)
- [光影之間的路線](stealth-light-shadow.md)
- [探頭決策](stealth-peeking.md)

## 參考來源

- [Hiding spots and exit timing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/stealth-hiding-spots/) — 查閱：2026-11-02；取得方式：page-text。
