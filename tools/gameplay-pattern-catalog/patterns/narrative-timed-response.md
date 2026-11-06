---
{
  "schema_version": 2,
  "id": "narrative-timed-response",
  "title": "限時回應",
  "title_en": "Answer before the response window closes",
  "category": "narrative",
  "source_category": "narrative",
  "tags": [
    "timing",
    "narrative",
    "risk"
  ],
  "summary": "还没想好也会继续，犹豫本身消耗说话机会。",
  "note_status": "draft",
  "related": [
    "narrative-conversation-intervention",
    "narrative-deliberate-silence",
    "commerce-haggling",
    "narrative-background-dialogue-access"
  ],
  "sources": [
    {
      "title": "Answer before the response window closes — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/narrative-timed-response/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「还没想好也会继续，犹豫本身消耗说话机会。」
出處：`sources/text/narrative-timed-response.json` 字元 199-219 `summary.zh`
顯示：還沒想好也會繼續，猶豫本身消耗說話機會。

## 規則

「对话出现可选回应，同时给出有限的作答窗口。玩家必须在窗口关闭前选定态度；超时后系统按预先写好的默认回应继续，而不是一直等候。本条关注选择截止时间，默认回应可以是沉默，但不等同于所有沉默玩法。」
出處：`sources/text/narrative-timed-response.json` 字元 355-450 `rules.zh`
顯示：對話出現可選回應，同時給出有限的作答窗口。玩家必須在窗口關閉前選定態度；超時後系統按預先寫好的默認回應繼續，而不是一直等候。本條關注選擇截止時間，默認回應可以是沉默，但不等同於所有沉默玩法。

## 核心循環

「听清眼前的问题」
出處：`sources/text/narrative-timed-response.json` 字元 753-760 `loop[0].zh`
顯示：聽清眼前的問題

「在有限时间内比较回应」
出處：`sources/text/narrative-timed-response.json` 字元 831-841 `loop[1].zh`
顯示：在有限時間內比較回應

「选择一句话或接受超时结果」
出處：`sources/text/narrative-timed-response.json` 字元 922-934 `loop[2].zh`
顯示：選擇一句話或接受超時結果

「面对对方的新反应」
出處：`sources/text/narrative-timed-response.json` 字元 1013-1021 `loop[3].zh`
顯示：面對對方的新反應

## 玩家取捨

「先选稳妥答复，还是冒着错过窗口的风险多想一下？」
出處：`sources/text/narrative-timed-response.json` 字元 1113-1136 `decisions[0].zh`
顯示：先選穩妥答覆，還是冒着錯過窗口的風險多想一下？

「当前信息不够时，要不要先表态承担承诺？」
出處：`sources/text/narrative-timed-response.json` 字元 1244-1263 `decisions[1].zh`
顯示：當前信息不夠時，要不要先表態承擔承諾？

## 可調參數

「作答窗口长度」
出處：`sources/text/narrative-timed-response.json` 字元 1435-1441 `parameters[0].name.zh`
顯示：作答窗口長度

「更短会增加临场压力；至少应让玩家读完选项，并允许调整阅读时间。」
出處：`sources/text/narrative-timed-response.json` 字元 1525-1556 `parameters[0].effect.zh`
顯示：更短會增加臨場壓力；至少應讓玩家讀完選項，並允許調整閱讀時間。

「超时结果」
出處：`sources/text/narrative-timed-response.json` 字元 1708-1712 `parameters[1].name.zh`
顯示：超時結果

「明确的默认回应让犹豫成为可理解的后果；隐蔽的随机结果容易显得不公平。」
出處：`sources/text/narrative-timed-response.json` 字元 1789-1823 `parameters[1].effect.zh`
顯示：明確的默認回應讓猶豫成爲可理解的後果；隱蔽的隨機結果容易顯得不公平。

## 原型

「做一个问题、三句回应、一个可调整时长的倒计时和一条超时分支。」
出處：`sources/text/narrative-timed-response.json` 字元 3334-3364 `prototype.firstStep.zh`
顯示：做一個問題、三句回應、一個可調整時長的倒計時和一條超時分支。

「玩家能否说明是主动选了立场，还是根本没来得及读懂？」
出處：`sources/text/narrative-timed-response.json` 字元 3656-3681 `prototype.test.zh`
顯示：玩家能否說明是主動選了立場，還是根本沒來得及讀懂？

「同时出现长字幕和短倒计时，会把阅读速度误当成决策能力。」
出處：`sources/text/narrative-timed-response.json` 字元 3499-3526 `prototype.pitfall.zh`
顯示：同時出現長字幕和短倒計時，會把閱讀速度誤當成決策能力。

## 相關模式

- [對話介入](narrative-conversation-intervention.md)
- [刻意沉默](narrative-deliberate-silence.md)
- [議價中的讓步](commerce-haggling.md)
- [背景事件對話進出](narrative-background-dialogue-access.md)

## 參考來源

- [Answer before the response window closes — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/narrative-timed-response/) — 查閱：2026-11-02；取得方式：page-text。
