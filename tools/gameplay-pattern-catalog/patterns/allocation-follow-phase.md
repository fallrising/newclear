---
{
  "schema_version": 2,
  "id": "allocation-follow-phase",
  "title": "跟進階段",
  "title_en": "Choose a phase that others can also use",
  "category": "allocation",
  "source_category": "allocation",
  "tags": [
    "information",
    "planning"
  ],
  "summary": "自己开启的机会，也可能帮对手推进计划。",
  "note_status": "draft",
  "related": [
    "allocation-public-pick",
    "allocation-area-majority",
    "allocation-public-goal-race",
    "allocation-shared-stock"
  ],
  "sources": [
    {
      "title": "Choose a phase that others can also use — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/allocation-follow-phase/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「自己开启的机会，也可能帮对手推进计划。」
出處：`sources/text/allocation-follow-phase.json` 字元 201-220 `summary.zh`
顯示：自己開啓的機會，也可能幫對手推進計劃。

## 規則

「玩家各自选择希望发生的行动阶段，公布后只执行有人选择的阶段，其他玩家也可在符合条件时参与。玩家要判断别人会选什么，借对方开启的阶段完成自己的计划；自己选择则确保阶段发生，或获得选择者奖励。」
出處：`sources/text/allocation-follow-phase.json` 字元 321-415 `rules.zh`
顯示：玩家各自選擇希望發生的行動階段，公佈後只執行有人選擇的階段，其他玩家也可在符合條件時參與。玩家要判斷別人會選什麼，借對方開啓的階段完成自己的計劃；自己選擇則確保階段發生，或獲得選擇者獎勵。

## 核心循環

「观察大家当前需要什么」
出處：`sources/text/allocation-follow-phase.json` 字元 687-697 `loop[0].zh`
顯示：觀察大家當前需要什麼

「选择自己必须确保的阶段」
出處：`sources/text/allocation-follow-phase.json` 字元 770-781 `loop[1].zh`
顯示：選擇自己必須確保的階段

「揭示并共同执行已选阶段」
出處：`sources/text/allocation-follow-phase.json` 字元 858-869 `loop[2].zh`
顯示：揭示並共同執行已選階段

「利用结果预测下一轮」
出處：`sources/text/allocation-follow-phase.json` 字元 947-956 `loop[3].zh`
顯示：利用結果預測下一輪

## 玩家取捨

「相信别人会选生产，自己去选出售，还是亲自确保生产发生？」
出處：`sources/text/allocation-follow-phase.json` 字元 1061-1088 `decisions[0].zh`
顯示：相信別人會選生產，自己去選出售，還是親自確保生產發生？

「某个阶段对自己有利，但会让对手更快得分，还要开启吗？」
出處：`sources/text/allocation-follow-phase.json` 字元 1225-1251 `decisions[1].zh`
顯示：某個階段對自己有利，但會讓對手更快得分，還要開啓嗎？

## 可調參數

「选择是否隐藏」
出處：`sources/text/allocation-follow-phase.json` 字元 1400-1406 `parameters[0].name.zh`
顯示：選擇是否隱藏

「同时暗选强化预测，公开顺选则强化回应与让利判断。」
出處：`sources/text/allocation-follow-phase.json` 字元 1484-1508 `parameters[0].effect.zh`
顯示：同時暗選強化預測，公開順選則強化回應與讓利判斷。

「选择者优势」
出處：`sources/text/allocation-follow-phase.json` 字元 1672-1677 `parameters[1].name.zh`
顯示：選擇者優勢

「额外收益能补偿开启公共机会，也不能大到让跟随没有意义。」
出處：`sources/text/allocation-follow-phase.json` 字元 1755-1782 `parameters[1].effect.zh`
顯示：額外收益能補償開啓公共機會，也不能大到讓跟隨沒有意義。

## 原型

「两名本地玩家轮流遮屏选三种阶段，生产、加工、出售按固定顺序执行。」
出處：`sources/text/allocation-follow-phase.json` 字元 3397-3429 `prototype.firstStep.zh`
顯示：兩名本地玩家輪流遮屏選三種階段，生產、加工、出售按固定順序執行。

「玩家是否会根据对手库存预测阶段，且猜错后能解释原因？」
出處：`sources/text/allocation-follow-phase.json` 字元 3745-3771 `prototype.test.zh`
顯示：玩家是否會根據對手庫存預測階段，且猜錯後能解釋原因？

「必须区分选阶段与在阶段中有资格行动，避免用户觉得跟随被漏算。」
出處：`sources/text/allocation-follow-phase.json` 字元 3603-3633 `prototype.pitfall.zh`
顯示：必須區分選階段與在階段中有資格行動，避免用戶覺得跟隨被漏算。

## 相關模式

- [公開選取](allocation-public-pick.md)
- [區域多數](allocation-area-majority.md)
- [公開目標競速](allocation-public-goal-race.md)
- [共享人才池的招募](allocation-shared-stock.md)

## 參考來源

- [Choose a phase that others can also use — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/allocation-follow-phase/) — 查閱：2026-11-02；取得方式：page-text。
