---
{
  "schema_version": 2,
  "id": "fishing-bite-window",
  "title": "訊號辨識與反應窗口",
  "title_en": "Bite timing",
  "category": "fishing",
  "source_category": "fishing",
  "tags": [
    "signal-reading",
    "timing",
    "risk-reward"
  ],
  "summary": "从试探动作中识别真咬钩，在短窗口内提竿。",
  "note_status": "draft",
  "related": [
    "combat-stamina-budget"
  ],
  "sources": [
    {
      "title": "Bite timing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/fishing-bite-window/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「从试探动作中识别真咬钩，在短窗口内提竿。」
出處：`sources/text/fishing-bite-window.json` 字元 159-179 `summary.zh`
顯示：從試探動作中識別真咬鉤，在短窗口內提竿。

## 規則

「玩家抛出鱼钩后等待信号，在真正咬钩时按键提竿。等待时间并不固定，过早或过晚行动可能空竿；浮标、音效或提示符把不可见的水下状态转成可判断的信息。」
出處：`sources/text/fishing-bite-window.json` 字元 279-350 `rules.zh`
顯示：玩家拋出魚鉤後等待信號，在真正咬鉤時按鍵提竿。等待時間並不固定，過早或過晚行動可能空竿；浮標、音效或提示符把不可見的水下狀態轉成可判斷的信息。

## 核心循環

「把鱼钩投入水中」
出處：`sources/text/fishing-bite-window.json` 字元 605-612 `loop[0].zh`
顯示：把魚鉤投入水中

「等待并辨认信号」
出處：`sources/text/fishing-bite-window.json` 字元 671-678 `loop[1].zh`
顯示：等待並辨認信號

「在窗口内提竿」
出處：`sources/text/fishing-bite-window.json` 字元 750-756 `loop[2].zh`
顯示：在窗口內提竿

「进入收线或重新抛竿」
出處：`sources/text/fishing-bite-window.json` 字元 824-833 `loop[3].zh`
顯示：進入收線或重新拋竿

## 玩家取捨

「浮标只是轻晃，还是已经真正下沉？现在提竿能抢到机会，也可能太早空竿。」
出處：`sources/text/fishing-bite-window.json` 字元 919-953 `decisions[0].zh`
顯示：浮標只是輕晃，還是已經真正下沉？現在提竿能搶到機會，也可能太早空竿。

「已经出现咬钩信号，要立即提竿，还是再等一瞬确认并承担错过窗口的风险？」
出處：`sources/text/fishing-bite-window.json` 字元 1097-1131 `decisions[1].zh`
顯示：已經出現咬鉤信號，要立即提竿，還是再等一瞬確認並承擔錯過窗口的風險？

## 可調參數

「有效窗口」
出處：`sources/text/fishing-bite-window.json` 字元 1308-1312 `parameters[0].name.zh`

「窄窗口强调反应，宽窗口更适合休闲与辅助操作。」
出處：`sources/text/fishing-bite-window.json` 字元 1389-1411 `parameters[0].effect.zh`
顯示：窄窗口強調反應，寬窗口更適合休閒與輔助操作。

「信号差异」
出處：`sources/text/fishing-bite-window.json` 字元 1551-1555 `parameters[1].name.zh`
顯示：信號差異

「真假信号越接近越需要注意力，也越容易令人疲劳。」
出處：`sources/text/fishing-bite-window.json` 字元 1632-1655 `parameters[1].effect.zh`
顯示：真假信號越接近越需要注意力，也越容易令人疲勞。

## 原型

「做“等待／试探／真咬钩／逃走”四态和一个按键，让真假信号有可学习差异。」
出處：`sources/text/fishing-bite-window.json` 字元 3015-3050 `prototype.firstStep.zh`
顯示：做“等待／試探／真咬鉤／逃走”四態和一個按鍵，讓真假信號有可學習差異。

「试玩几轮后，玩家能否说出自己是按早了还是按晚了，并提高成功率？」
出處：`sources/text/fishing-bite-window.json` 字元 3382-3413 `prototype.test.zh`
顯示：試玩幾輪後，玩家能否說出自己是按早了還是按晚了，並提高成功率？

「先别增加鱼种与装备；如果失败原因不清楚，更多内容只会放大猜测感。」
出處：`sources/text/fishing-bite-window.json` 字元 3202-3234 `prototype.pitfall.zh`
顯示：先別增加魚種與裝備；如果失敗原因不清楚，更多內容只會放大猜測感。

## 相關模式

- [攻守共用資源預算](combat-stamina-budget.md)

## 參考來源

- [Bite timing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/fishing-bite-window/) — 查閱：2026-11-02；取得方式：page-text。
