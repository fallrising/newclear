---
{
  "schema_version": 2,
  "id": "stealth-light-shadow",
  "title": "光影之間的路線",
  "title_en": "Moving through light and shadow",
  "category": "stealth",
  "source_category": "stealth",
  "tags": [
    "spatial",
    "timing",
    "information"
  ],
  "summary": "地面上的明暗，决定哪里适合停留、哪里必须快速通过。",
  "note_status": "draft",
  "related": [
    "exploration-stealth-awareness",
    "stealth-sound-lures",
    "stealth-hiding-spots",
    "stealth-synchronized-actions"
  ],
  "sources": [
    {
      "title": "Moving through light and shadow — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/stealth-light-shadow/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「地面上的明暗，决定哪里适合停留、哪里必须快速通过。」
出處：`sources/text/stealth-light-shadow.json` 字元 180-205 `summary.zh`
顯示：地面上的明暗，決定哪裏適合停留、哪裏必須快速通過。

## 規則

「光照改变角色被看见的难度，玩家在暗区停留、观察，再穿过亮区。可交互灯具还能改变安全路线；画面或指示器必须说明角色目前是否藏在阴影里。」
出處：`sources/text/stealth-light-shadow.json` 字元 317-383 `rules.zh`
顯示：光照改變角色被看見的難度，玩家在暗區停留、觀察，再穿過亮區。可交互燈具還能改變安全路線；畫面或指示器必須說明角色目前是否藏在陰影裏。

## 核心循環

「找出亮区与暗区」
出處：`sources/text/stealth-light-shadow.json` 字元 643-650 `loop[0].zh`
顯示：找出亮區與暗區

「在暗处观察巡逻」
出處：`sources/text/stealth-light-shadow.json` 字元 717-724 `loop[1].zh`
顯示：在暗處觀察巡邏

「选择时机穿过亮区」
出處：`sources/text/stealth-light-shadow.json` 字元 795-803 `loop[2].zh`
顯示：選擇時機穿過亮區

「抵达下一处阴影」
出處：`sources/text/stealth-light-shadow.json` 字元 872-879 `loop[3].zh`
顯示：抵達下一處陰影

## 玩家取捨

「走短但明亮的通路，还是沿更长的暗区绕行？」
出處：`sources/text/stealth-light-shadow.json` 字元 965-985 `decisions[0].zh`
顯示：走短但明亮的通路，還是沿更長的暗區繞行？

「关灯能创造安全区，但执行关灯的过程是否更危险？」
出處：`sources/text/stealth-light-shadow.json` 字元 1081-1104 `decisions[1].zh`
顯示：關燈能創造安全區，但執行關燈的過程是否更危險？

## 可調參數

「光照对发现速度的影响」
出處：`sources/text/stealth-light-shadow.json` 字元 1263-1273 `parameters[0].name.zh`
顯示：光照對發現速度的影響

「差距过小会让明暗沦为装饰，过大则可能让暗处成为绝对安全区。」
出處：`sources/text/stealth-light-shadow.json` 字元 1360-1389 `parameters[0].effect.zh`
顯示：差距過小會讓明暗淪爲裝飾，過大則可能讓暗處成爲絕對安全區。

「安全区间距」
出處：`sources/text/stealth-light-shadow.json` 字元 1551-1556 `parameters[1].name.zh`
顯示：安全區間距

「间距越大，越需要等待守卫转向，并计划中途退路。」
出處：`sources/text/stealth-light-shadow.json` 字元 1647-1670 `parameters[1].effect.zh`
顯示：間距越大，越需要等待守衛轉向，並計劃中途退路。

## 原型

「用二维地图放两片暗区、一片亮区和一名转头守卫；先用区域标签计算可见性。」
出處：`sources/text/stealth-light-shadow.json` 字元 3095-3130 `prototype.firstStep.zh`
顯示：用二維地圖放兩片暗區、一片亮區和一名轉頭守衛；先用區域標籤計算可見性。

「隐藏指示器暂时遮住后，玩家能否仅凭画面预测哪里更安全？」
出處：`sources/text/stealth-light-shadow.json` 字元 3475-3502 `prototype.test.zh`
顯示：隱藏指示器暫時遮住後，玩家能否僅憑畫面預測哪裏更安全？

「先别追求真实光线渲染；视觉上很暗但规则判定很亮，会使玩家觉得不公平。」
出處：`sources/text/stealth-light-shadow.json` 字元 3295-3329 `prototype.pitfall.zh`
顯示：先別追求真實光線渲染；視覺上很暗但規則判定很亮，會使玩家覺得不公平。

## 相關模式

- [潛行警戒](exploration-stealth-awareness.md)
- [聲音誘餌](stealth-sound-lures.md)
- [藏點與脫離時機](stealth-hiding-spots.md)
- [同步動作](stealth-synchronized-actions.md)

## 參考來源

- [Moving through light and shadow — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/stealth-light-shadow/) — 查閱：2026-11-02；取得方式：page-text。
