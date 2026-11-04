---
{
  "schema_version": 2,
  "id": "command-frontline-shielding",
  "title": "前線掩護",
  "title_en": "Protect damage dealers with a front line",
  "category": "command",
  "source_category": "command",
  "tags": [
    "spatial",
    "planning"
  ],
  "summary": "用队列顺序决定谁先挨打。",
  "note_status": "draft",
  "related": [
    "command-prebattle-formation",
    "command-split-objectives",
    "command-focus-fire",
    "command-initiative-order"
  ],
  "sources": [
    {
      "title": "Protect damage dealers with a front line — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/command-frontline-shielding/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「用队列顺序决定谁先挨打。」
出處：`sources/text/command-frontline-shielding.json` 字元 199-211 `summary.zh`
顯示：用隊列順序決定誰先捱打。

## 規則

「攻击通常优先落在一排最前方的单位身上，玩家把耐打者放前面，把输出者放后面。前排倒下会暴露后排；穿透或特殊目标规则又可能绕过保护，因此站位要随敌人变化。」
出處：`sources/text/command-frontline-shielding.json` 字元 306-381 `rules.zh`
顯示：攻擊通常優先落在一排最前方的單位身上，玩家把耐打者放前面，把輸出者放後面。前排倒下會暴露後排；穿透或特殊目標規則又可能繞過保護，因此站位要隨敵人變化。

## 核心循環

「查看敌人的攻击对象」
出處：`sources/text/command-frontline-shielding.json` 字元 609-618 `loop[0].zh`
顯示：查看敵人的攻擊對象

「排列承伤与输出位置」
出處：`sources/text/command-frontline-shielding.json` 字元 682-691 `loop[1].zh`
顯示：排列承傷與輸出位置

「观察前排消耗」
出處：`sources/text/command-frontline-shielding.json` 字元 765-771 `loop[2].zh`
顯示：觀察前排消耗

「替换或补充保护」
出處：`sources/text/command-frontline-shielding.json` 字元 838-845 `loop[3].zh`
顯示：替換或補充保護

## 玩家取捨

「前排更厚能多打几轮，但会占掉输出位置。」
出處：`sources/text/command-frontline-shielding.json` 字元 941-960 `decisions[0].zh`
顯示：前排更厚能多打幾輪，但會佔掉輸出位置。

「是否把残血前排撤下，让另一人承接下一击？」
出處：`sources/text/command-frontline-shielding.json` 字元 1061-1081 `decisions[1].zh`
顯示：是否把殘血前排撤下，讓另一人承接下一擊？

## 可調參數

「每排容量」
出處：`sources/text/command-frontline-shielding.json` 字元 1224-1228 `parameters[0].name.zh`

「容量小让保护与输出直接争位置。」
出處：`sources/text/command-frontline-shielding.json` 字元 1302-1317 `parameters[0].effect.zh`
顯示：容量小讓保護與輸出直接爭位置。

「绕过前排的频率」
出處：`sources/text/command-frontline-shielding.json` 字元 1445-1452 `parameters[1].name.zh`
顯示：繞過前排的頻率

「少量穿透敌人可打破固定答案，过多则会让前排规则失去意义。」
出處：`sources/text/command-frontline-shielding.json` 字元 1530-1558 `parameters[1].effect.zh`
顯示：少量穿透敵人可打破固定答案，過多則會讓前排規則失去意義。

## 原型

「一条双方各三格的队列，普通攻击只打最前目标。」
出處：`sources/text/command-frontline-shielding.json` 字元 2915-2937 `prototype.firstStep.zh`
顯示：一條雙方各三格的隊列，普通攻擊只打最前目標。

「玩家是否主动换位分伤，而不是只把最高血量永久放第一格？」
出處：`sources/text/command-frontline-shielding.json` 字元 3186-3213 `prototype.test.zh`
顯示：玩家是否主動換位分傷，而不是隻把最高血量永久放第一格？

「必须解释特殊攻击为何能绕过保护。」
出處：`sources/text/command-frontline-shielding.json` 字元 3064-3080 `prototype.pitfall.zh`
顯示：必須解釋特殊攻擊爲何能繞過保護。

## 相關模式

- [戰前陣型](command-prebattle-formation.md)
- [分工目標組](command-split-objectives.md)
- [集中火力決策](command-focus-fire.md)
- [先攻順序](command-initiative-order.md)

## 參考來源

- [Protect damage dealers with a front line — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/command-frontline-shielding/) — 查閱：2026-11-02；取得方式：page-text。
