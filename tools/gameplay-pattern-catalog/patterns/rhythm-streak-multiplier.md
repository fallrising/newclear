---
{
  "schema_version": 2,
  "id": "rhythm-streak-multiplier",
  "title": "連續倍率",
  "title_en": "Keep a multiplier through accurate streaks",
  "category": "rhythm",
  "source_category": "rhythm",
  "tags": [
    "timing",
    "risk",
    "progression"
  ],
  "summary": "一连串稳定表现会让后面的行动更值钱，也让下一次失误更可惜。",
  "note_status": "draft",
  "related": [
    "rhythm-cue-response",
    "rhythm-hidden-beats",
    "rhythm-onbeat-actions",
    "rhythm-sustain-notes"
  ],
  "sources": [
    {
      "title": "Keep a multiplier through accurate streaks — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/rhythm-streak-multiplier/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「一连串稳定表现会让后面的行动更值钱，也让下一次失误更可惜。」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 199-228 `summary.zh`
顯示：一連串穩定表現會讓後面的行動更值錢，也讓下一次失誤更可惜。

## 規則

「系统记录一段连续合格的行动，达到条件就提高伤害、得分或资源收益；失误会降低或重置这份奖励。玩家不只要完成眼前动作，还要决定是否为了额外收益冒着断连风险。本条关注累积成果的保留，不以每招不同或单次踩准拍点作为完整玩法。」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 353-461 `rules.zh`
顯示：系統記錄一段連續合格的行動，達到條件就提高傷害、得分或資源收益；失誤會降低或重置這份獎勵。玩家不只要完成眼前動作，還要決定是否爲了額外收益冒着斷連風險。本條關注累積成果的保留，不以每招不同或單次踩準拍點作爲完整玩法。

## 核心循環

「连续完成合格行动」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 840-848 `loop[0].zh`
顯示：連續完成合格行動

「看到倍率逐步提高」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 930-938 `loop[1].zh`

「选择稳住连锁或挑战更难目标」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 1011-1024 `loop[2].zh`
顯示：選擇穩住連鎖或挑戰更難目標

「保住奖励，或失误后重新积累」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 1113-1126 `loop[3].zh`
顯示：保住獎勵，或失誤後重新積累

## 玩家取捨

「倍率已经很高时，先处理容易命中的目标，还是冒险追击更高收益的目标？」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 1232-1265 `decisions[0].zh`
顯示：倍率已經很高時，先處理容易命中的目標，還是冒險追擊更高收益的目標？

「当前局面容易受伤断连，要绕路维持节奏，还是接受掉倍率换一个更好位置？」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 1394-1428 `decisions[1].zh`
顯示：當前局面容易受傷斷連，要繞路維持節奏，還是接受掉倍率換一個更好位置？

## 可調參數

「升级门槛与上限」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 1636-1643 `parameters[0].name.zh`
顯示：升級門檻與上限

「门槛低能快速建立正反馈；上限高会让高手与新手的收益差距变大。」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 1723-1753 `parameters[0].effect.zh`
顯示：門檻低能快速建立正反饋；上限高會讓高手與新手的收益差距變大。

「断连惩罚」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 1931-1935 `parameters[1].name.zh`
顯示：斷連懲罰

「掉一级比全清零更容易恢复；惩罚应与玩家投入的连续时间相称。」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 2016-2045 `parameters[1].effect.zh`
顯示：掉一級比全清零更容易恢復；懲罰應與玩家投入的連續時間相稱。

「奖励的用途」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 2221-2226 `parameters[2].name.zh`
顯示：獎勵的用途

「只加分主要服务挑战成绩；提高伤害或收入会进一步改变之后的战斗与购买能力。」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 2299-2335 `parameters[2].effect.zh`
顯示：只加分主要服務挑戰成績；提高傷害或收入會進一步改變之後的戰鬥與購買能力。

## 原型

「用一个键、两档奖励和一个可见连中计数；只设一种断连原因，先测试玩家是否看懂收益变化。」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 4041-4083 `prototype.firstStep.zh`
顯示：用一個鍵、兩檔獎勵和一個可見連中計數；只設一種斷連原因，先測試玩家是否看懂收益變化。

「倍率快升级或已经很高时，玩家是否会主动改变目标选择来保住它？」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 4448-4478 `prototype.test.zh`
顯示：倍率快升級或已經很高時，玩家是否會主動改變目標選擇來保住它？

「倍率掉落若没有指出原因，会让玩家把正常失误误解为系统随意扣奖。」
出處：`sources/text/rhythm-streak-multiplier.json` 字元 4286-4317 `prototype.pitfall.zh`
顯示：倍率掉落若沒有指出原因，會讓玩家把正常失誤誤解爲系統隨意扣獎。

## 相關模式

- [提示回應](rhythm-cue-response.md)
- [提示消失後的內在節拍](rhythm-hidden-beats.md)
- [拍點上動作](rhythm-onbeat-actions.md)
- [按住長音的時值判斷](rhythm-sustain-notes.md)

## 參考來源

- [Keep a multiplier through accurate streaks — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/rhythm-streak-multiplier/) — 查閱：2026-11-02；取得方式：page-text。
