---
{
  "schema_version": 2,
  "id": "cooperation-temporary-alliance",
  "title": "暫時結盟",
  "title_en": "Temporary alliances and betrayal",
  "category": "cooperation",
  "source_category": "cooperation",
  "tags": [
    "cooperation",
    "risk",
    "economy"
  ],
  "summary": "眼前需要彼此，最后却只想自己赢：每次合作都要重新判断是否可信。",
  "note_status": "draft",
  "related": [
    "cooperation-downed-revival",
    "cooperation-hidden-role",
    "commerce-auction-bidding",
    "commerce-debt-pressure"
  ],
  "sources": [
    {
      "title": "Temporary alliances and betrayal — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooperation-temporary-alliance/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「眼前需要彼此，最后却只想自己赢：每次合作都要重新判断是否可信。」
出處：`sources/text/cooperation-temporary-alliance.json` 字元 198-229 `summary.zh`
顯示：眼前需要彼此，最後卻只想自己贏：每次合作都要重新判斷是否可信。

## 規則

「玩家有独立得分目标，也有共同危险或共同对手。帮助他人能带来眼前收益，却可能壮大竞争者；承诺不保证执行，玩家根据行动、筹码和剩余机会决定继续合作、退出或背叛。」
出處：`sources/text/cooperation-temporary-alliance.json` 字元 374-452 `rules.zh`
顯示：玩家有獨立得分目標，也有共同危險或共同對手。幫助他人能帶來眼前收益，卻可能壯大競爭者；承諾不保證執行，玩家根據行動、籌碼和剩餘機會決定繼續合作、退出或背叛。

## 核心循環

「发现暂时共同的利益」
出處：`sources/text/cooperation-temporary-alliance.json` 字元 754-763 `loop[0].zh`
顯示：發現暫時共同的利益

「商量并投入有限帮助」
出處：`sources/text/cooperation-temporary-alliance.json` 字元 839-848 `loop[1].zh`
顯示：商量並投入有限幫助

「观察对方是否兑现」
出處：`sources/text/cooperation-temporary-alliance.json` 字元 925-933 `loop[2].zh`
顯示：觀察對方是否兌現

「继续、退出或转而竞争」
出處：`sources/text/cooperation-temporary-alliance.json` 字元 1008-1018 `loop[3].zh`
顯示：繼續、退出或轉而競爭

## 玩家取捨

「先帮别人压制领先者，会不会只是把新对手扶到第一？」
出處：`sources/text/cooperation-temporary-alliance.json` 字元 1112-1136 `decisions[0].zh`
顯示：先幫別人壓制領先者，會不會只是把新對手扶到第一？

「现在背叛能拿更多，但后面还需要对方一起过险关吗？」
出處：`sources/text/cooperation-temporary-alliance.json` 字元 1236-1260 `decisions[1].zh`
顯示：現在背叛能拿更多，但後面還需要對方一起過險關嗎？

## 可調參數

「共同危险强度」
出處：`sources/text/cooperation-temporary-alliance.json` 字元 1401-1407 `parameters[0].name.zh`
顯示：共同危險強度

「危险太弱没人需要合作，太强则背叛几乎没有空间。」
出處：`sources/text/cooperation-temporary-alliance.json` 字元 1482-1505 `parameters[0].effect.zh`
顯示：危險太弱沒人需要合作，太強則背叛幾乎沒有空間。

「合作收益与个人收益」
出處：`sources/text/cooperation-temporary-alliance.json` 字元 1669-1678 `parameters[1].name.zh`
顯示：合作收益與個人收益

「合作有真实好处，背叛也有机会成本，双方才需要判断。」
出處：`sources/text/cooperation-temporary-alliance.json` 字元 1769-1794 `parameters[1].effect.zh`
顯示：合作有真實好處，背叛也有機會成本，雙方纔需要判斷。

## 原型

「先用三人纸面竞分、三轮共同费用和不强制执行的口头约定，测合作是否会自然出现。」
出處：`sources/text/cooperation-temporary-alliance.json` 字元 3509-3547 `prototype.firstStep.zh`
顯示：先用三人紙面競分、三輪共同費用和不強制執行的口頭約定，測合作是否會自然出現。

「同一组试玩者至少有一次主动合作，也有一次因局势变化拒绝合作，并能解释原因。」
出處：`sources/text/cooperation-temporary-alliance.json` 字元 3945-3982 `prototype.test.zh`
顯示：同一組試玩者至少有一次主動合作，也有一次因局勢變化拒絕合作，並能解釋原因。

「别先做自动谈判AI或复杂外交条约；先找到合作和背叛各有合理时机的收益结构。」
出處：`sources/text/cooperation-temporary-alliance.json` 字元 3729-3766 `prototype.pitfall.zh`
顯示：別先做自動談判AI或複雜外交條約；先找到合作和背叛各有合理時機的收益結構。

## 相關模式

- [倒地救起](cooperation-downed-revival.md)
- [隱藏角色](cooperation-hidden-role.md)
- [拍賣出價](commerce-auction-bidding.md)
- [債務壓力](commerce-debt-pressure.md)

## 參考來源

- [Temporary alliances and betrayal — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooperation-temporary-alliance/) — 查閱：2026-11-02；取得方式：page-text。
