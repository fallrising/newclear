---
{
  "schema_version": 2,
  "id": "rhythm-hidden-beats",
  "title": "提示消失後的內在節拍",
  "title_en": "Keep time when the cues disappear",
  "category": "rhythm",
  "source_category": "rhythm",
  "tags": [
    "timing",
    "information",
    "precision"
  ],
  "summary": "先让玩家听懂节奏，再拿掉一部分提示，检验能否自己把拍子续下去。",
  "note_status": "draft",
  "related": [
    "rhythm-cue-response",
    "rhythm-sustain-notes",
    "rhythm-onbeat-actions",
    "rhythm-streak-multiplier"
  ],
  "sources": [
    {
      "title": "Keep time when the cues disappear — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/rhythm-hidden-beats/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先让玩家听懂节奏，再拿掉一部分提示，检验能否自己把拍子续下去。」
出處：`sources/text/rhythm-hidden-beats.json` 字元 185-216 `summary.zh`
顯示：先讓玩家聽懂節奏，再拿掉一部分提示，檢驗能否自己把拍子續下去。

## 規則

「一段稳定节奏先建立参照，随后部分声音或画面提示暂时消失，但判定时间仍照常前进。玩家要在心里保持间隔，在不可见或无声的目标拍回应；提示回来后可以重新校准。本条新增的约束是缺少外部参照，而不是多记一串按钮。」
出處：`sources/text/rhythm-hidden-beats.json` 字元 344-445 `rules.zh`
顯示：一段穩定節奏先建立參照，隨後部分聲音或畫面提示暫時消失，但判定時間仍照常前進。玩家要在心裏保持間隔，在不可見或無聲的目標拍回應；提示回來後可以重新校準。本條新增的約束是缺少外部參照，而不是多記一串按鈕。

## 核心循環

「用完整提示建立拍感」
出處：`sources/text/rhythm-hidden-beats.json` 字元 812-821 `loop[0].zh`

「发现哪些提示被拿掉」
出處：`sources/text/rhythm-hidden-beats.json` 字元 900-909 `loop[1].zh`
顯示：發現哪些提示被拿掉

「在空白段继续计拍并输入」
出處：`sources/text/rhythm-hidden-beats.json` 字元 980-991 `loop[2].zh`
顯示：在空白段繼續計拍並輸入

「对照回来的提示修正节奏」
出處：`sources/text/rhythm-hidden-beats.json` 字元 1072-1083 `loop[3].zh`
顯示：對照回來的提示修正節奏

## 玩家取捨

「画面干扰与原节奏不一致时，要跟着变化追赶，还是守住原来的间隔？」
出處：`sources/text/rhythm-hidden-beats.json` 字元 1176-1207 `decisions[0].zh`
顯示：畫面干擾與原節奏不一致時，要跟着變化追趕，還是守住原來的間隔？

「空白段结束后发现偏快，要从哪个新提示重新对齐，避免越按越乱？」
出處：`sources/text/rhythm-hidden-beats.json` 字元 1348-1378 `decisions[1].zh`
顯示：空白段結束後發現偏快，要從哪個新提示重新對齊，避免越按越亂？

## 可調參數

「空白段长度」
出處：`sources/text/rhythm-hidden-beats.json` 字元 1558-1563 `parameters[0].name.zh`
顯示：空白段長度

「空白越长，微小误差越容易积累；短空白更适合第一次教学。」
出處：`sources/text/rhythm-hidden-beats.json` 字元 1642-1669 `parameters[0].effect.zh`
顯示：空白越長，微小誤差越容易積累；短空白更適合第一次教學。

「保留的参照」
出處：`sources/text/rhythm-hidden-beats.json` 字元 1826-1831 `parameters[1].name.zh`
顯示：保留的參照

「保留音乐、动画或部分拍点会提供不同程度的帮助，不能把全部关闭当成唯一加难方法。」
出處：`sources/text/rhythm-hidden-beats.json` 字元 1913-1952 `parameters[1].effect.zh`
顯示：保留音樂、動畫或部分拍點會提供不同程度的幫助，不能把全部關閉當成唯一加難方法。

「重新对齐的机会」
出處：`sources/text/rhythm-hidden-beats.json` 字元 2153-2160 `parameters[2].name.zh`
顯示：重新對齊的機會

「规律出现的强提示能让一次漂移有机会恢复，不必失败到段落结束。」
出處：`sources/text/rhythm-hidden-beats.json` 字元 2244-2274 `parameters[2].effect.zh`
顯示：規律出現的強提示能讓一次漂移有機會恢復，不必失敗到段落結束。

## 原型

「做八拍循环，只隐藏中间两拍，仍给出命中目标与误差；熟悉后再扩大缺口。」
出處：`sources/text/rhythm-hidden-beats.json` 字元 3905-3939 `prototype.firstStep.zh`
顯示：做八拍循環，只隱藏中間兩拍，仍給出命中目標與誤差；熟悉後再擴大缺口。

「玩家是否能在提示回来时主动校正，而不是只能重新开始整关？」
出處：`sources/text/rhythm-hidden-beats.json` 字元 4343-4371 `prototype.test.zh`
顯示：玩家是否能在提示回來時主動校正，而不是隻能重新開始整關？

「提示消失时若实际拍速也偷偷变化，玩家无法从已有信息推算正确答案。」
出處：`sources/text/rhythm-hidden-beats.json` 字元 4130-4162 `prototype.pitfall.zh`
顯示：提示消失時若實際拍速也偷偷變化，玩家無法從已有信息推算正確答案。

## 相關模式

- [提示回應](rhythm-cue-response.md)
- [按住長音的時值判斷](rhythm-sustain-notes.md)
- [拍點上動作](rhythm-onbeat-actions.md)
- [連續倍率](rhythm-streak-multiplier.md)

## 參考來源

- [Keep time when the cues disappear — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/rhythm-hidden-beats/) — 查閱：2026-11-02；取得方式：page-text。
