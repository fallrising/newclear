---
{
  "schema_version": 2,
  "id": "defense-target-priority",
  "title": "目標優先",
  "title_en": "Set automatic target priorities",
  "category": "defense",
  "source_category": "defense",
  "tags": [
    "information",
    "planning",
    "optimization"
  ],
  "summary": "塔会自己开火，玩家决定它先解决哪一种威胁。",
  "note_status": "draft",
  "related": [
    "automation-item-filtering",
    "defense-ammunition-supply",
    "defense-maze-routing",
    "defense-resistance-counters"
  ],
  "sources": [
    {
      "title": "Set automatic target priorities — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/defense-target-priority/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「塔会自己开火，玩家决定它先解决哪一种威胁。」
出處：`sources/text/defense-target-priority.json` 字元 186-207 `summary.zh`
顯示：塔會自己開火，玩家決定它先解決哪一種威脅。

## 規則

「玩家为防御单位选择目标规则，例如优先打最前面的敌人或最强的敌人。规则持续生效，直到玩家更改；射线、目标标记和漏怪结果帮助判断分工。目标选择仍受射程、攻击类型和是否能发现目标限制。」
出處：`sources/text/defense-target-priority.json` 字元 334-423 `rules.zh`
顯示：玩家爲防禦單位選擇目標規則，例如優先打最前面的敵人或最強的敵人。規則持續生效，直到玩家更改；射線、目標標記和漏怪結果幫助判斷分工。目標選擇仍受射程、攻擊類型和是否能發現目標限制。

## 核心循環

「观察队列里的不同威胁」
出處：`sources/text/defense-target-priority.json` 字元 714-724 `loop[0].zh`
顯示：觀察隊列裏的不同威脅

「给塔设置目标规则」
出處：`sources/text/defense-target-priority.json` 字元 809-817 `loop[1].zh`
顯示：給塔設置目標規則

「查看火力实际分配」
出處：`sources/text/defense-target-priority.json` 字元 884-892 `loop[2].zh`
顯示：查看火力實際分配

「按漏怪情况调整分工」
出處：`sources/text/defense-target-priority.json` 字元 962-971 `loop[3].zh`
顯示：按漏怪情況調整分工

## 玩家取捨

「先清掉出口前的小怪，还是让重火力持续打高血量敌人？」
出處：`sources/text/defense-target-priority.json` 字元 1066-1091 `decisions[0].zh`
顯示：先清掉出口前的小怪，還是讓重火力持續打高血量敵人？

「所有塔打同一个强敌可能浪费伤害，分工又可能让强敌活着走出射程。」
出處：`sources/text/defense-target-priority.json` 字元 1212-1243 `decisions[1].zh`
顯示：所有塔打同一個強敵可能浪費傷害，分工又可能讓強敵活着走出射程。

## 可調參數

「切换成本」
出處：`sources/text/defense-target-priority.json` 字元 1426-1430 `parameters[0].name.zh`
顯示：切換成本

「免费切换鼓励临场指挥；有冷却时更重视波次前的判断。」
出處：`sources/text/defense-target-priority.json` 字元 1506-1531 `parameters[0].effect.zh`
顯示：免費切換鼓勵臨場指揮；有冷卻時更重視波次前的判斷。

「优先级种类」
出處：`sources/text/defense-target-priority.json` 字元 1690-1695 `parameters[1].name.zh`
顯示：優先級種類

「先给少量能看出差异的规则，过多细分会增加理解和操作负担。」
出處：`sources/text/defense-target-priority.json` 字元 1777-1805 `parameters[1].effect.zh`
顯示：先給少量能看出差異的規則，過多細分會增加理解和操作負擔。

## 原型

「先做一条路、两座塔和“最前/最高血量”两个规则。」
出處：`sources/text/defense-target-priority.json` 字元 3356-3380 `prototype.firstStep.zh`
顯示：先做一條路、兩座塔和“最前/最高血量”兩個規則。

「同一布局只换优先级，玩家能否预测哪类敌人更容易漏掉？」
出處：`sources/text/defense-target-priority.json` 字元 3678-3704 `prototype.test.zh`
顯示：同一佈局只換優先級，玩家能否預測哪類敵人更容易漏掉？

「目标标记和射程必须清楚，否则玩家会以为塔没有听指令。」
出處：`sources/text/defense-target-priority.json` 字元 3516-3542 `prototype.pitfall.zh`
顯示：目標標記和射程必須清楚，否則玩家會以爲塔沒有聽指令。

## 相關模式

- [物品篩選](automation-item-filtering.md)
- [彈藥供給](defense-ammunition-supply.md)
- [路徑路由](defense-maze-routing.md)
- [抗性克制](defense-resistance-counters.md)

## 參考來源

- [Set automatic target priorities — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/defense-target-priority/) — 查閱：2026-11-02；取得方式：page-text。
