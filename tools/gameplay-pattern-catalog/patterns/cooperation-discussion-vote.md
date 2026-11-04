---
{
  "schema_version": 2,
  "id": "cooperation-discussion-vote",
  "title": "討論投票",
  "title_en": "Discussion, evidence and voting",
  "category": "cooperation",
  "source_category": "cooperation",
  "tags": [
    "information",
    "cooperation",
    "narrative"
  ],
  "summary": "把每个人只看到的一小段事实，变成一次全体承担后果的决定。",
  "note_status": "draft",
  "related": [
    "cooperation-hidden-role",
    "cooperation-split-information",
    "cooperation-complementary-abilities",
    "cooperation-downed-revival"
  ],
  "sources": [
    {
      "title": "Discussion, evidence and voting — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooperation-discussion-vote/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把每个人只看到的一小段事实，变成一次全体承担后果的决定。」
出處：`sources/text/cooperation-discussion-vote.json` 字元 195-223 `summary.zh`
顯示：把每個人只看到的一小段事實，變成一次全體承擔後果的決定。

## 規則

「事件触发讨论阶段，玩家依次陈述见闻、质疑矛盾，再投票决定怀疑对象或暂不行动。投票结果改变参与者或局势，余下玩家据此重新判断旧证词。」
出處：`sources/text/cooperation-discussion-vote.json` 字元 357-422 `rules.zh`
顯示：事件觸發討論階段，玩家依次陳述見聞、質疑矛盾，再投票決定懷疑對象或暫不行動。投票結果改變參與者或局勢，餘下玩家據此重新判斷舊證詞。

## 核心循環

「出现需要解释的事件」
出處：`sources/text/cooperation-discussion-vote.json` 字元 688-697 `loop[0].zh`
顯示：出現需要解釋的事件

「交换见闻并追问矛盾」
出處：`sources/text/cooperation-discussion-vote.json` 字元 769-778 `loop[1].zh`
顯示：交換見聞並追問矛盾

「投票承担选择后果」
出處：`sources/text/cooperation-discussion-vote.json` 字元 861-869 `loop[2].zh`
顯示：投票承擔選擇後果

「回看证词再进入行动」
出處：`sources/text/cooperation-discussion-vote.json` 字元 942-951 `loop[3].zh`
顯示：回看證詞再進入行動

## 玩家取捨

「证据不足时跟随多数，还是保留意见并解释原因？」
出處：`sources/text/cooperation-discussion-vote.json` 字元 1049-1071 `decisions[0].zh`
顯示：證據不足時跟隨多數，還是保留意見並解釋原因？

「先说最可疑的人，还是先报能被别人核对的时间地点？」
出處：`sources/text/cooperation-discussion-vote.json` 字元 1182-1206 `decisions[1].zh`
顯示：先說最可疑的人，還是先報能被別人覈對的時間地點？

## 可調參數

「讨论时长」
出處：`sources/text/cooperation-discussion-vote.json` 字元 1346-1350 `parameters[0].name.zh`
顯示：討論時長

「太短只能抢话，太长容易重复；应容纳一轮陈述和追问。」
出處：`sources/text/cooperation-discussion-vote.json` 字元 1431-1456 `parameters[0].effect.zh`
顯示：太短只能搶話，太長容易重複；應容納一輪陳述和追問。

「结果公开程度」
出處：`sources/text/cooperation-discussion-vote.json` 字元 1622-1628 `parameters[1].name.zh`
顯示：結果公開程度

「公开身份让推理快速校正，隐藏身份让后续判断更不确定。」
出處：`sources/text/cooperation-discussion-vote.json` 字元 1708-1734 `parameters[1].effect.zh`
顯示：公開身份讓推理快速校正，隱藏身份讓後續判斷更不確定。

## 原型

「用四份不同证词、一个限时讨论和纸面投票，做三轮短案情。」
出處：`sources/text/cooperation-discussion-vote.json` 字元 3363-3390 `prototype.firstStep.zh`
顯示：用四份不同證詞、一個限時討論和紙面投票，做三輪短案情。

「至少有一名试玩者因新证据改变原投票，并能说明是哪条信息改变了判断。」
出處：`sources/text/cooperation-discussion-vote.json` 字元 3744-3777 `prototype.test.zh`
顯示：至少有一名試玩者因新證據改變原投票，並能說明是哪條信息改變了判斷。

「先让证据能改变投票；复杂发言权限、实时语音与房间匹配会掩盖基础讨论是否成立。」
出處：`sources/text/cooperation-discussion-vote.json` 字元 3532-3570 `prototype.pitfall.zh`
顯示：先讓證據能改變投票；複雜發言權限、實時語音與房間匹配會掩蓋基礎討論是否成立。

## 相關模式

- [隱藏角色](cooperation-hidden-role.md)
- [分工資訊](cooperation-split-information.md)
- [互補能力組](cooperation-complementary-abilities.md)
- [倒地救起](cooperation-downed-revival.md)

## 參考來源

- [Discussion, evidence and voting — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooperation-discussion-vote/) — 查閱：2026-11-02；取得方式：page-text。
