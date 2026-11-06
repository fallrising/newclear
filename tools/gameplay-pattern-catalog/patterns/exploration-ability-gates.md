---
{
  "schema_version": 2,
  "id": "exploration-ability-gates",
  "title": "能力解鎖與回訪",
  "title_en": "Ability-gated backtracking",
  "category": "exploration",
  "source_category": "exploration",
  "tags": [
    "capability-gate",
    "backtracking",
    "world-connectivity"
  ],
  "summary": "先看到去不了的地方，再用新能力重新理解旧地图。",
  "note_status": "draft",
  "related": [
    "gathering-tool-hardness",
    "puzzles-box-pushing"
  ],
  "sources": [
    {
      "title": "Ability-gated backtracking — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/exploration-ability-gates/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先看到去不了的地方，再用新能力重新理解旧地图。」
出處：`sources/text/exploration-ability-gates.json` 字元 185-208 `summary.zh`
顯示：先看到去不了的地方，再用新能力重新理解舊地圖。

## 規則

「地图用跳跃距离、墙面、特殊障碍等限制通行。获得能力后，玩家回忆旧障碍并重访；真正的奖励不仅是新房间，还包括原有空间连接方式的改变。」
出處：`sources/text/exploration-ability-gates.json` 字元 318-383 `rules.zh`
顯示：地圖用跳躍距離、牆面、特殊障礙等限制通行。獲得能力後，玩家回憶舊障礙並重訪；真正的獎勵不僅是新房間，還包括原有空間連接方式的改變。

## 核心循環

「发现当前无法通过的路」
出處：`sources/text/exploration-ability-gates.json` 字元 624-634 `loop[0].zh`
顯示：發現當前無法通過的路

「记住位置与障碍特征」
出處：`sources/text/exploration-ability-gates.json` 字元 706-715 `loop[1].zh`
顯示：記住位置與障礙特徵

「获取对应能力」
出處：`sources/text/exploration-ability-gates.json` 字元 789-795 `loop[2].zh`
顯示：獲取對應能力

「返回并打开新连接」
出處：`sources/text/exploration-ability-gates.json` 字元 865-873 `loop[3].zh`
顯示：返回並打開新連接

## 玩家取捨

「继续寻找主路，还是为可疑支路做标记？玩家在未知收益间分配注意力。」
出處：`sources/text/exploration-ability-gates.json` 字元 966-998 `decisions[0].zh`
顯示：繼續尋找主路，還是爲可疑支路做標記？玩家在未知收益間分配注意力。

「新能力到手后，先推进还是回收旧区域，形成节奏选择。」
出處：`sources/text/exploration-ability-gates.json` 字元 1142-1167 `decisions[1].zh`
顯示：新能力到手後，先推進還是回收舊區域，形成節奏選擇。

## 可調參數

「障碍可辨识度」
出處：`sources/text/exploration-ability-gates.json` 字元 1319-1325 `parameters[0].name.zh`
顯示：障礙可辨識度

「视觉语言越清楚，玩家越容易记住需要哪种能力。」
出處：`sources/text/exploration-ability-gates.json` 字元 1403-1425 `parameters[0].effect.zh`
顯示：視覺語言越清楚，玩家越容易記住需要哪種能力。

「回访距离」
出處：`sources/text/exploration-ability-gates.json` 字元 1567-1571 `parameters[1].name.zh`
顯示：回訪距離

「距离太长会变成跑腿；捷径可让回访保留发现感。」
出處：`sources/text/exploration-ability-gates.json` 字元 1651-1673 `parameters[1].effect.zh`
顯示：距離太長會變成跑腿；捷徑可讓回訪保留髮現感。

## 原型

「做五个相连房间、一项移动能力和两处明显但暂时无法通过的障碍。」
出處：`sources/text/exploration-ability-gates.json` 字元 3161-3191 `prototype.firstStep.zh`
顯示：做五個相連房間、一項移動能力和兩處明顯但暫時無法通過的障礙。

「取得能力后不给任务标记，观察玩家能否主动想起至少一处旧障碍。」
出處：`sources/text/exploration-ability-gates.json` 字元 3506-3536 `prototype.test.zh`
顯示：取得能力後不給任務標記，觀察玩家能否主動想起至少一處舊障礙。

「地图没形成值得回访的连接时，增加能力只会增加找路负担。」
出處：`sources/text/exploration-ability-gates.json` 字元 3326-3353 `prototype.pitfall.zh`
顯示：地圖沒形成值得回訪的連接時，增加能力只會增加找路負擔。

## 相關模式

- [工具能力門檻](gathering-tool-hardness.md)
- [不可逆推動與位置可達性](puzzles-box-pushing.md)

## 參考來源

- [Ability-gated backtracking — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/exploration-ability-gates/) — 查閱：2026-11-02；取得方式：page-text。
