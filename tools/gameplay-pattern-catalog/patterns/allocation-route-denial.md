---
{
  "schema_version": 2,
  "id": "allocation-route-denial",
  "title": "路線封鎖",
  "title_en": "Claim routes to alter an opponent’s path",
  "category": "allocation",
  "source_category": "allocation",
  "tags": [
    "spatial",
    "risk"
  ],
  "summary": "一段路既能帮自己连接，也能让别人被迫绕远。",
  "note_status": "draft",
  "related": [
    "allocation-area-majority",
    "allocation-follow-phase",
    "allocation-public-goal-race",
    "allocation-public-pick"
  ],
  "sources": [
    {
      "title": "Claim routes to alter an opponent’s path — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/allocation-route-denial/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「一段路既能帮自己连接，也能让别人被迫绕远。」
出處：`sources/text/allocation-route-denial.json` 字元 199-220 `summary.zh`
顯示：一段路既能幫自己連接，也能讓別人被迫繞遠。

## 規則

「地图上的路段或路口具有排他占用规则，玩家抢先建立连接或据点后，别人不能再用同一位置延伸。玩家在完成自己的路线与封住关键通路之间取舍；绕行距离、剩余入口和建设成本给出后果。」
出處：`sources/text/allocation-route-denial.json` 字元 330-415 `rules.zh`
顯示：地圖上的路段或路口具有排他佔用規則，玩家搶先建立連接或據點後，別人不能再用同一位置延伸。玩家在完成自己的路線與封住關鍵通路之間取捨；繞行距離、剩餘入口和建設成本給出後果。

## 核心循環

「寻找必要通路与替代路径」
出處：`sources/text/allocation-route-denial.json` 字元 725-736 `loop[0].zh`
顯示：尋找必要通路與替代路徑

「支付资源抢占路段或节点」
出處：`sources/text/allocation-route-denial.json` 字元 816-827 `loop[1].zh`
顯示：支付資源搶佔路段或節點

「更新双方可延伸范围」
出處：`sources/text/allocation-route-denial.json` 字元 903-912 `loop[2].zh`
顯示：更新雙方可延伸範圍

「绕行或抢下一处缺口」
出處：`sources/text/allocation-route-denial.json` 字元 983-992 `loop[3].zh`
顯示：繞行或搶下一處缺口

## 玩家取捨

「先铺最短路线，还是先拿对手也需要的狭窄连接？」
出處：`sources/text/allocation-route-denial.json` 字元 1087-1109 `decisions[0].zh`
顯示：先鋪最短路線，還是先拿對手也需要的狹窄連接？

「绕路成本已经很高，还要完成原目标吗？」
出處：`sources/text/allocation-route-denial.json` 字元 1222-1240 `decisions[1].zh`
顯示：繞路成本已經很高，還要完成原目標嗎？

## 可調參數

「替代路线数量」
出處：`sources/text/allocation-route-denial.json` 字元 1388-1394 `parameters[0].name.zh`
顯示：替代路線數量

「只有一条通路会放大先手，多个绕行选择更利于补救。」
出處：`sources/text/allocation-route-denial.json` 字元 1474-1498 `parameters[0].effect.zh`
顯示：只有一條通路會放大先手，多個繞行選擇更利於補救。

「占用持续时间」
出處：`sources/text/allocation-route-denial.json` 字元 1646-1652 `parameters[1].name.zh`
顯示：佔用持續時間

「永久占用强调提前判断，临时封锁更强调时机。」
出處：`sources/text/allocation-route-denial.json` 字元 1732-1753 `parameters[1].effect.zh`
顯示：永久佔用強調提前判斷，臨時封鎖更強調時機。

## 原型

「画六个节点、八条可独占边，两名玩家轮流花代币连线。」
出處：`sources/text/allocation-route-denial.json` 字元 3192-3217 `prototype.firstStep.zh`
顯示：畫六個節點、八條可獨佔邊，兩名玩家輪流花代幣連線。

「路被抢后，玩家是否能读出替代路线及额外代价？」
出處：`sources/text/allocation-route-denial.json` 字元 3497-3519 `prototype.test.zh`
顯示：路被搶後，玩家是否能讀出替代路線及額外代價？

「别让一次开局抢路就永久失去参与机会。」
出處：`sources/text/allocation-route-denial.json` 字元 3361-3379 `prototype.pitfall.zh`
顯示：別讓一次開局搶路就永久失去參與機會。

## 相關模式

- [區域多數](allocation-area-majority.md)
- [跟進階段](allocation-follow-phase.md)
- [公開目標競速](allocation-public-goal-race.md)
- [公開選取](allocation-public-pick.md)

## 參考來源

- [Claim routes to alter an opponent’s path — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/allocation-route-denial/) — 查閱：2026-11-02；取得方式：page-text。
