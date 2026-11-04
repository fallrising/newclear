---
{
  "schema_version": 2,
  "id": "stealth-disguise-access",
  "title": "偽裝進出",
  "title_en": "Disguise permissions",
  "category": "stealth",
  "source_category": "stealth",
  "tags": [
    "information",
    "planning",
    "risk"
  ],
  "summary": "换一身衣服，就换了一张能去不同地方的通行证。",
  "note_status": "draft",
  "related": [
    "stealth-peeking",
    "stealth-body-concealment",
    "stealth-hiding-spots",
    "stealth-knockout-window"
  ],
  "sources": [
    {
      "title": "Disguise permissions — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/stealth-disguise-access/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「换一身衣服，就换了一张能去不同地方的通行证。」
出處：`sources/text/stealth-disguise-access.json` 字元 173-195 `summary.zh`
顯示：換一身衣服，就換了一張能去不同地方的通行證。

## 規則

「区域按身份决定谁能进入、能携带什么。玩家先取得合适服装，再利用权限接近目标；特定识破者或越界行为仍会暴露身份，界面应及时解释原因。」
出處：`sources/text/stealth-disguise-access.json` 字元 293-358 `rules.zh`
顯示：區域按身份決定誰能進入、能攜帶什麼。玩家先取得合適服裝，再利用權限接近目標；特定識破者或越界行爲仍會暴露身份，界面應及時解釋原因。

## 核心循環

「辨认区域要求的身份」
出處：`sources/text/stealth-disguise-access.json` 字元 616-625 `loop[0].zh`
顯示：辨認區域要求的身份

「取得合适服装」
出處：`sources/text/stealth-disguise-access.json` 字元 695-701 `loop[1].zh`
顯示：取得合適服裝

「避开会识破的人」
出處：`sources/text/stealth-disguise-access.json` 字元 769-776 `loop[2].zh`
顯示：避開會識破的人

「利用权限完成目标」
出處：`sources/text/stealth-disguise-access.json` 字元 856-864 `loop[3].zh`
顯示：利用權限完成目標

## 玩家取捨

「先绕路拿权限更大的服装，还是利用现有身份走一条更窄的路线？」
出處：`sources/text/stealth-disguise-access.json` 字元 957-986 `decisions[0].zh`
顯示：先繞路拿權限更大的服裝，還是利用現有身份走一條更窄的路線？

「一个身份能过门却不能带武器时，要放下工具还是另找入口？」
出處：`sources/text/stealth-disguise-access.json` 字元 1110-1137 `decisions[1].zh`
顯示：一個身份能過門卻不能帶武器時，要放下工具還是另找入口？

## 可調參數

「身份覆盖范围」
出處：`sources/text/stealth-disguise-access.json` 字元 1311-1317 `parameters[0].name.zh`
顯示：身份覆蓋範圍

「一种服装能进的区域越多，换装决策越少；权限交错会增加路线规划。」
出處：`sources/text/stealth-disguise-access.json` 字元 1398-1429 `parameters[0].effect.zh`
顯示：一種服裝能進的區域越多，換裝決策越少；權限交錯會增加路線規劃。

「识破者密度」
出處：`sources/text/stealth-disguise-access.json` 字元 1585-1590 `parameters[1].name.zh`
顯示：識破者密度

「少量固定识破者能让玩家读懂规则，过密会使伪装几乎失去作用。」
出處：`sources/text/stealth-disguise-access.json` 字元 1670-1699 `parameters[1].effect.zh`
顯示：少量固定識破者能讓玩家讀懂規則，過密會使僞裝幾乎失去作用。

## 原型

「做两间房、两套服装、一个门卫；用颜色说明当前身份能去哪里。」
出處：`sources/text/stealth-disguise-access.json` 字元 3126-3155 `prototype.firstStep.zh`
顯示：做兩間房、兩套服裝、一個門衛；用顏色說明當前身份能去哪裏。

「让玩家解释为什么同一扇门换衣前后反应不同，并观察是否会主动规划换装顺序。」
出處：`sources/text/stealth-disguise-access.json` 字元 3480-3516 `prototype.test.zh`
顯示：讓玩家解釋爲什麼同一扇門換衣前後反應不同，並觀察是否會主動規劃換裝順序。

「先别做复杂人物记忆；必须先让玩家分清“钥匙开门”和“身份获准进入”。」
出處：`sources/text/stealth-disguise-access.json` 字元 3303-3337 `prototype.pitfall.zh`
顯示：先別做複雜人物記憶；必須先讓玩家分清“鑰匙開門”和“身份獲准進入”。

## 相關模式

- [探頭決策](stealth-peeking.md)
- [移動與藏起目標](stealth-body-concealment.md)
- [藏點與脫離時機](stealth-hiding-spots.md)
- [擊昏窗口](stealth-knockout-window.md)

## 參考來源

- [Disguise permissions — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/stealth-disguise-access/) — 查閱：2026-11-02；取得方式：page-text。
