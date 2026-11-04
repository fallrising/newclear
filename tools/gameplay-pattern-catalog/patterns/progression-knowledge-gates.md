---
{
  "schema_version": 2,
  "id": "progression-knowledge-gates",
  "title": "知識門檻",
  "title_en": "Progress through learned knowledge",
  "category": "progression",
  "source_category": "progression",
  "tags": [
    "information",
    "discovery",
    "progression"
  ],
  "summary": "角色没有变强，是玩家知道了一种原本就能用的做法。",
  "note_status": "draft",
  "related": [
    "exploration-ability-gates",
    "progression-evolution-recipes",
    "exploration-earned-map",
    "exploration-fast-travel-network"
  ],
  "sources": [
    {
      "title": "Progress through learned knowledge — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/progression-knowledge-gates/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「角色没有变强，是玩家知道了一种原本就能用的做法。」
出處：`sources/text/progression-knowledge-gates.json` 字元 199-223 `summary.zh`
顯示：角色沒有變強，是玩家知道了一種原本就能用的做法。

## 規則

「一个障碍不检查等级或新道具，而是要求玩家知道特定规律、时机或操作。通过探索线索形成理解，再回到旧地点验证；一旦理解，就可以更快走过同样的流程。」
出處：`sources/text/progression-knowledge-gates.json` 字元 350-421 `rules.zh`
顯示：一個障礙不檢查等級或新道具，而是要求玩家知道特定規律、時機或操作。通過探索線索形成理解，再回到舊地點驗證；一旦理解，就可以更快走過同樣的流程。

## 核心循環

「遇到暂时不懂的障碍」
出處：`sources/text/progression-knowledge-gates.json` 字元 692-701 `loop[0].zh`
顯示：遇到暫時不懂的障礙

「在别处找到线索」
出處：`sources/text/progression-knowledge-gates.json` 字元 773-780 `loop[1].zh`
顯示：在別處找到線索

「形成可验证的猜想」
出處：`sources/text/progression-knowledge-gates.json` 字元 845-853 `loop[2].zh`
顯示：形成可驗證的猜想

「返回应用知识继续前进」
出處：`sources/text/progression-knowledge-gates.json` 字元 917-927 `loop[3].zh`
顯示：返回應用知識繼續前進

## 玩家取捨

「继续在原地尝试，还是去别处寻找能解释现象的线索？」
出處：`sources/text/progression-knowledge-gates.json` 字元 1011-1035 `decisions[0].zh`
顯示：繼續在原地嘗試，還是去別處尋找能解釋現象的線索？

「已经有一个猜想，要现在验证，还是多找证据避免一次高成本尝试？」
出處：`sources/text/progression-knowledge-gates.json` 字元 1142-1172 `decisions[1].zh`
顯示：已經有一個猜想，要現在驗證，還是多找證據避免一次高成本嘗試？

## 可調參數

「线索距离」
出處：`sources/text/progression-knowledge-gates.json` 字元 1330-1334 `parameters[0].name.zh`
顯示：線索距離

「线索与障碍相隔越远，越需要清楚的记录和地标帮助玩家联系。」
出處：`sources/text/progression-knowledge-gates.json` 字元 1413-1441 `parameters[0].effect.zh`
顯示：線索與障礙相隔越遠，越需要清楚的記錄和地標幫助玩家聯繫。

「验证成本」
出處：`sources/text/progression-knowledge-gates.json` 字元 1595-1599 `parameters[1].name.zh`
顯示：驗證成本

「验证快会鼓励猜想；重跑很久才知道对错，会压低实验意愿。」
出處：`sources/text/progression-knowledge-gates.json` 字元 1676-1703 `parameters[1].effect.zh`
顯示：驗證快會鼓勵猜想；重跑很久才知道對錯，會壓低實驗意願。

## 原型

「做一个三步输入机关、一条远处线索和一条返回捷径；开始时所有操作已可用。」
出處：`sources/text/progression-knowledge-gates.json` 字元 3285-3320 `prototype.firstStep.zh`
顯示：做一個三步輸入機關、一條遠處線索和一條返回捷徑；開始時所有操作已可用。

「玩家读到线索后能否自己返回解开机关，并在重开后直接通过？」
出處：`sources/text/progression-knowledge-gates.json` 字元 3661-3689 `prototype.test.zh`
顯示：玩家讀到線索後能否自己返回解開機關，並在重開後直接通過？

「不要把解法只藏在无法推理的暗号里；线索要让玩家能解释为什么有效。」
出處：`sources/text/progression-knowledge-gates.json` 字元 3486-3518 `prototype.pitfall.zh`
顯示：不要把解法只藏在無法推理的暗號裏；線索要讓玩家能解釋爲什麼有效。

## 相關模式

- [能力解鎖與回訪](exploration-ability-gates.md)
- [進化配方鏈](progression-evolution-recipes.md)
- [掙得地圖](exploration-earned-map.md)
- [快速旅行網路](exploration-fast-travel-network.md)

## 參考來源

- [Progress through learned knowledge — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/progression-knowledge-gates/) — 查閱：2026-11-02；取得方式：page-text。
