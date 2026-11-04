---
{
  "schema_version": 2,
  "id": "relationships-faction-reputation",
  "title": "陣營聲望決策",
  "title_en": "Faction reputation",
  "category": "relationships",
  "source_category": "relationships",
  "tags": [
    "narrative",
    "economy",
    "risk"
  ],
  "summary": "把各方对玩家的评价分开记录，让同一行动产生不同后果。",
  "note_status": "draft",
  "related": [
    "relationships-companion-approval",
    "relationships-persuasion-checks",
    "relationships-relationship-commitment",
    "relationships-secrets-leverage"
  ],
  "sources": [
    {
      "title": "Faction reputation — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/relationships-faction-reputation/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把各方对玩家的评价分开记录，让同一行动产生不同后果。」
出處：`sources/text/relationships-faction-reputation.json` 字元 185-211 `summary.zh`
顯示：把各方對玩家的評價分開記錄，讓同一行動產生不同後果。

## 規則

「玩家完成任务、帮助或伤害某个群体；各方独立记录态度。称号、敌对、对话或特殊能力反馈关系变化，玩家据此选择继续站队或维持灰色空间。」
出處：`sources/text/relationships-faction-reputation.json` 字元 336-400 `rules.zh`
顯示：玩家完成任務、幫助或傷害某個羣體；各方獨立記錄態度。稱號、敵對、對話或特殊能力反饋關係變化，玩家據此選擇繼續站隊或維持灰色空間。

## 核心循環

「识别利益相关方」
出處：`sources/text/relationships-faction-reputation.json` 字元 613-620 `loop[0].zh`
顯示：識別利益相關方

「选择帮助对象」
出處：`sources/text/relationships-faction-reputation.json` 字元 681-687 `loop[1].zh`
顯示：選擇幫助對象

「更新多方评价」
出處：`sources/text/relationships-faction-reputation.json` 字元 750-756 `loop[2].zh`
顯示：更新多方評價

「利用或承受新待遇」
出處：`sources/text/relationships-faction-reputation.json` 字元 818-826 `loop[3].zh`

## 玩家取捨

「拿眼前奖励是否会封掉另一方的长期机会？」
出處：`sources/text/relationships-faction-reputation.json` 字元 916-935 `decisions[0].zh`
顯示：拿眼前獎勵是否會封掉另一方的長期機會？

「同时积累敬畏和信任，比单纯讨好更适合角色吗？」
出處：`sources/text/relationships-faction-reputation.json` 字元 1042-1064 `decisions[1].zh`
顯示：同時積累敬畏和信任，比單純討好更適合角色嗎？

## 可調參數

「评价维度」
出處：`sources/text/relationships-faction-reputation.json` 字元 1208-1212 `parameters[0].name.zh`
顯示：評價維度

「双维度可保留矛盾评价，单轴更易读。」
出處：`sources/text/relationships-faction-reputation.json` 字元 1295-1312 `parameters[0].effect.zh`
顯示：雙維度可保留矛盾評價，單軸更易讀。

「跨阵营影响」
出處：`sources/text/relationships-faction-reputation.json` 字元 1452-1457 `parameters[1].name.zh`
顯示：跨陣營影響

「连带影响越强，站队越有战略重量。」
出處：`sources/text/relationships-faction-reputation.json` 字元 1540-1556 `parameters[1].effect.zh`
顯示：連帶影響越強，站隊越有戰略重量。

## 原型

「做两个阵营、三次有连带影响的任务和两个由关系改变的后续选项。」
出處：`sources/text/relationships-faction-reputation.json` 字元 3093-3123 `prototype.firstStep.zh`
顯示：做兩個陣營、三次有連帶影響的任務和兩個由關係改變的後續選項。

「观察玩家是否把未来通行或交易机会纳入当前任务选择。」
出處：`sources/text/relationships-faction-reputation.json` 字元 3443-3468 `prototype.test.zh`
顯示：觀察玩家是否把未來通行或交易機會納入當前任務選擇。

「先确保后果可追溯；太多阵营与隐藏数值会让关系变化难以归因。」
出處：`sources/text/relationships-faction-reputation.json` 字元 3271-3300 `prototype.pitfall.zh`
顯示：先確保後果可追溯；太多陣營與隱藏數值會讓關係變化難以歸因。

## 相關模式

- [同伴認可得失](relationships-companion-approval.md)
- [說服檢定](relationships-persuasion-checks.md)
- [關係承諾](relationships-relationship-commitment.md)
- [秘密把柄](relationships-secrets-leverage.md)

## 參考來源

- [Faction reputation — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/relationships-faction-reputation/) — 查閱：2026-11-02；取得方式：page-text。
