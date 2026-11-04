---
{
  "schema_version": 2,
  "id": "stealth-body-concealment",
  "title": "移動與藏起目標",
  "title_en": "Moving and hiding bodies",
  "category": "stealth",
  "source_category": "stealth",
  "tags": [
    "planning",
    "spatial",
    "risk"
  ],
  "summary": "放倒守卫只是前半步，还得决定把留下的证据放哪儿。",
  "note_status": "draft",
  "related": [
    "stealth-disguise-access",
    "stealth-knockout-window",
    "stealth-peeking",
    "stealth-synchronized-actions"
  ],
  "sources": [
    {
      "title": "Moving and hiding bodies — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/stealth-body-concealment/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「放倒守卫只是前半步，还得决定把留下的证据放哪儿。」
出處：`sources/text/stealth-body-concealment.json` 字元 178-202 `summary.zh`
顯示：放倒守衛只是前半步，還得決定把留下的證據放哪兒。

## 規則

「倒地人物留在场景里，其他人发现后会改变警戒。玩家可花时间拖走或放入藏匿点，但搬运时更难迅速脱身；先选处置位置，往往比先动手更重要。」
出處：`sources/text/stealth-body-concealment.json` 字元 325-390 `rules.zh`
顯示：倒地人物留在場景裏，其他人發現後會改變警戒。玩家可花時間拖走或放入藏匿點，但搬運時更難迅速脫身；先選處置位置，往往比先動手更重要。

## 核心循環

「观察其他人的巡逻」
出處：`sources/text/stealth-body-concealment.json` 字元 633-641 `loop[0].zh`
顯示：觀察其他人的巡邏

「选好放倒位置」
出處：`sources/text/stealth-body-concealment.json` 字元 704-710 `loop[1].zh`
顯示：選好放倒位置

「把身体移到遮蔽处」
出處：`sources/text/stealth-body-concealment.json` 字元 778-786 `loop[2].zh`
顯示：把身體移到遮蔽處

「重新检查通路」
出處：`sources/text/stealth-body-concealment.json` 字元 856-862 `loop[3].zh`
顯示：重新檢查通路

## 玩家取捨

「就地绕过身体节省时间，还是搬走以免稍后的巡逻发现？」
出處：`sources/text/stealth-body-concealment.json` 字元 944-969 `decisions[0].zh`
顯示：就地繞過身體節省時間，還是搬走以免稍後的巡邏發現？

「近处藏点方便但会绕远出口，远处藏点是否值得更长搬运？」
出處：`sources/text/stealth-body-concealment.json` 字元 1084-1110 `decisions[1].zh`
顯示：近處藏點方便但會繞遠出口，遠處藏點是否值得更長搬運？

## 可調參數

「搬运速度」
出處：`sources/text/stealth-body-concealment.json` 字元 1277-1281 `parameters[0].name.zh`
顯示：搬運速度

「速度差越大，放倒地点越重要，也越需要规划第二个人的视线。」
出處：`sources/text/stealth-body-concealment.json` 字元 1354-1382 `parameters[0].effect.zh`
顯示：速度差越大，放倒地點越重要，也越需要規劃第二個人的視線。

「藏匿容量」
出處：`sources/text/stealth-body-concealment.json` 字元 1545-1549 `parameters[1].name.zh`

「有限容量迫使玩家分散行动地点，而非反复堆在同一处。」
出處：`sources/text/stealth-body-concealment.json` 字元 1626-1651 `parameters[1].effect.zh`
顯示：有限容量迫使玩家分散行動地點，而非反覆堆在同一處。

## 原型

「做两名守卫、一条巡逻线、一个可拖动身体与一个藏匿区。」
出處：`sources/text/stealth-body-concealment.json` 字元 3075-3101 `prototype.firstStep.zh`
顯示：做兩名守衛、一條巡邏線、一個可拖動身體與一個藏匿區。

「玩家第二次尝试时，会不会先看藏点再决定在哪里放倒守卫？」
出處：`sources/text/stealth-body-concealment.json` 字元 3413-3440 `prototype.test.zh`
顯示：玩家第二次嘗試時，會不會先看藏點再決定在哪裏放倒守衛？

「避免身体碰撞与动画先耗尽工期；原型用一个可拖动标记验证路线成本即可。」
出處：`sources/text/stealth-body-concealment.json` 字元 3234-3268 `prototype.pitfall.zh`
顯示：避免身體碰撞與動畫先耗盡工期；原型用一個可拖動標記驗證路線成本即可。

## 相關模式

- [偽裝進出](stealth-disguise-access.md)
- [擊昏窗口](stealth-knockout-window.md)
- [探頭決策](stealth-peeking.md)
- [同步動作](stealth-synchronized-actions.md)

## 參考來源

- [Moving and hiding bodies — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/stealth-body-concealment/) — 查閱：2026-11-02；取得方式：page-text。
