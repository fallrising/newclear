---
{
  "schema_version": 2,
  "id": "stealth-security-network",
  "title": "保全網路",
  "title_en": "Surveillance control",
  "category": "stealth",
  "source_category": "stealth",
  "tags": [
    "information",
    "planning",
    "economy"
  ],
  "summary": "摄像头既能发现你，也能成为你看见敌人的眼睛。",
  "note_status": "draft",
  "related": [
    "stealth-disguise-access",
    "stealth-peeking",
    "automation-item-filtering",
    "exploration-stealth-awareness"
  ],
  "sources": [
    {
      "title": "Surveillance control — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/stealth-security-network/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「摄像头既能发现你，也能成为你看见敌人的眼睛。」
出處：`sources/text/stealth-security-network.json` 字元 175-197 `summary.zh`
顯示：攝像頭既能發現你，也能成爲你看見敵人的眼睛。

## 規則

「设施监视一片区域，并可能记录证据或触发警戒。玩家选择绕开、破坏或接管，付出工具、资源或绕路成本；接管后的信息收益与清除记录后的补救收益应分开呈现。」
出處：`sources/text/stealth-security-network.json` 字元 293-366 `rules.zh`
顯示：設施監視一片區域，並可能記錄證據或觸發警戒。玩家選擇繞開、破壞或接管，付出工具、資源或繞路成本；接管後的信息收益與清除記錄後的補救收益應分開呈現。

## 核心循環

「确认监控覆盖」
出處：`sources/text/stealth-security-network.json` 字元 628-634 `loop[0].zh`
顯示：確認監控覆蓋

「寻找设备或控制点」
出處：`sources/text/stealth-security-network.json` 字元 704-712 `loop[1].zh`
顯示：尋找設備或控制點

「绕开、关闭或接管」
出處：`sources/text/stealth-security-network.json` 字元 790-798 `loop[2].zh`
顯示：繞開、關閉或接管

「利用新的安全与情报」
出處：`sources/text/stealth-security-network.json` 字元 871-880 `loop[3].zh`
顯示：利用新的安全與情報

## 玩家取捨

「为短暂通过直接破坏摄像头，还是投入更多资源让它持续侦察？」
出處：`sources/text/stealth-security-network.json` 字元 978-1006 `decisions[0].zh`
顯示：爲短暫通過直接破壞攝像頭，還是投入更多資源讓它持續偵察？

「已经被录下时，完成目标就走，还是绕去清除记录？」
出處：`sources/text/stealth-security-network.json` 字元 1132-1155 `decisions[1].zh`
顯示：已經被錄下時，完成目標就走，還是繞去清除記錄？

## 可調參數

「共享控制范围」
出處：`sources/text/stealth-security-network.json` 字元 1318-1324 `parameters[0].name.zh`
顯示：共享控制範圍

「一个终端控制越多设备，争夺终端越有价值，也越容易成为唯一解。」
出處：`sources/text/stealth-security-network.json` 字元 1402-1432 `parameters[0].effect.zh`
顯示：一個終端控制越多設備，爭奪終端越有價值，也越容易成爲唯一解。

「接管成本」
出處：`sources/text/stealth-security-network.json` 字元 1602-1606 `parameters[1].name.zh`

「成本越高，玩家越要比较情报能否服务于后续路线，而非只看当前房间。」
出處：`sources/text/stealth-security-network.json` 字元 1680-1712 `parameters[1].effect.zh`
顯示：成本越高，玩家越要比較情報能否服務於後續路線，而非只看當前房間。

## 原型

「做一台摄像头、一个开关终端与敌方/玩家两种控制状态；同一视野数据切换所有者。」
出處：`sources/text/stealth-security-network.json` 字元 3240-3278 `prototype.firstStep.zh`
顯示：做一臺攝像頭、一個開關終端與敵方/玩家兩種控制狀態；同一視野數據切換所有者。

「玩家能否说清接管摄像头带来的新信息，并据此改变下一步路线？」
出處：`sources/text/stealth-security-network.json` 字元 3620-3649 `prototype.test.zh`
顯示：玩家能否說清接管攝像頭帶來的新信息，並據此改變下一步路線？

「先别做完整黑客小游戏；让控制权变化确实改变玩家能看到什么。」
出處：`sources/text/stealth-security-network.json` 字元 3444-3473 `prototype.pitfall.zh`
顯示：先別做完整黑客小遊戲；讓控制權變化確實改變玩家能看到什麼。

## 相關模式

- [偽裝進出](stealth-disguise-access.md)
- [探頭決策](stealth-peeking.md)
- [物品篩選](automation-item-filtering.md)
- [潛行警戒](exploration-stealth-awareness.md)

## 參考來源

- [Surveillance control — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/stealth-security-network/) — 查閱：2026-11-02；取得方式：page-text。
