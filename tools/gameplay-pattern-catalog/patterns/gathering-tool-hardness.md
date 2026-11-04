---
{
  "schema_version": 2,
  "id": "gathering-tool-hardness",
  "title": "工具能力門檻",
  "title_en": "Harvesting tool gates",
  "category": "gathering",
  "source_category": "gathering",
  "tags": [
    "capability-gate",
    "progression",
    "backtracking"
  ],
  "summary": "看得到的资源，不一定能用现在的工具带走。",
  "note_status": "draft",
  "related": [
    "exploration-ability-gates",
    "cooking-recipe-learning"
  ],
  "sources": [
    {
      "title": "Harvesting tool gates — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/gathering-tool-hardness/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「看得到的资源，不一定能用现在的工具带走。」
出處：`sources/text/gathering-tool-hardness.json` 字元 175-195 `summary.zh`
顯示：看得到的資源，不一定能用現在的工具帶走。

## 規則

「矿物或植物要求特定工具类别或等级，低级工具无法采得有效材料。玩家记录位置、取得升级材料再回来，成功开采反馈工具升级的实际价值。」
出處：`sources/text/gathering-tool-hardness.json` 字元 302-365 `rules.zh`
顯示：礦物或植物要求特定工具類別或等級，低級工具無法採得有效材料。玩家記錄位置、取得升級材料再回來，成功開採反饋工具升級的實際價值。

## 核心循環

「发现新资源」
出處：`sources/text/gathering-tool-hardness.json` 字元 607-612 `loop[0].zh`
顯示：發現新資源

「检查工具要求」
出處：`sources/text/gathering-tool-hardness.json` 字元 675-681 `loop[1].zh`
顯示：檢查工具要求

「升级或更换工具」
出處：`sources/text/gathering-tool-hardness.json` 字元 748-755 `loop[2].zh`
顯示：升級或更換工具

「返回开采」
出處：`sources/text/gathering-tool-hardness.json` 字元 822-826 `loop[3].zh`
顯示：返回開採

## 玩家取捨

「现在为升级绕路，还是先采现有工具能处理的资源？」
出處：`sources/text/gathering-tool-hardness.json` 字元 908-931 `decisions[0].zh`
顯示：現在爲升級繞路，還是先採現有工具能處理的資源？

「新工具先服务哪条装备或建筑路线？」
出處：`sources/text/gathering-tool-hardness.json` 字元 1038-1054 `decisions[1].zh`
顯示：新工具先服務哪條裝備或建築路線？

## 可調參數

「门槛跨度」
出處：`sources/text/gathering-tool-hardness.json` 字元 1205-1209 `parameters[0].name.zh`
顯示：門檻跨度

「跨度大让升级更有冲击力，也可能造成长时间空转。」
出處：`sources/text/gathering-tool-hardness.json` 字元 1283-1306 `parameters[0].effect.zh`
顯示：跨度大讓升級更有衝擊力，也可能造成長時間空轉。

「失败反馈」
出處：`sources/text/gathering-tool-hardness.json` 字元 1439-1443 `parameters[1].name.zh`
顯示：失敗反饋

「明确提示缺少工具减少无效敲击；只显示零伤害容易误导。」
出處：`sources/text/gathering-tool-hardness.json` 字元 1521-1547 `parameters[1].effect.zh`
顯示：明確提示缺少工具減少無效敲擊；只顯示零傷害容易誤導。

## 原型

「做两种工具和两种矿点，显示不能开采的原因，并允许标记位置。」
出處：`sources/text/gathering-tool-hardness.json` 字元 3039-3068 `prototype.firstStep.zh`
顯示：做兩種工具和兩種礦點，顯示不能開採的原因，並允許標記位置。

「玩家遇到不可采矿点后，是否能自行找到升级目标并愿意回来？」
出處：`sources/text/gathering-tool-hardness.json` 字元 3388-3416 `prototype.test.zh`
顯示：玩家遇到不可採礦點後，是否能自行找到升級目標並願意回來？

「工具层级太多会造成反复刷同样材料；先让每次升级带来清楚的新用途。」
出處：`sources/text/gathering-tool-hardness.json` 字元 3217-3249 `prototype.pitfall.zh`
顯示：工具層級太多會造成反覆刷同樣材料；先讓每次升級帶來清楚的新用途。

## 相關模式

- [能力解鎖與回訪](exploration-ability-gates.md)
- [知識與材料雙重解鎖](cooking-recipe-learning.md)

## 參考來源

- [Harvesting tool gates — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/gathering-tool-hardness/) — 查閱：2026-11-02；取得方式：page-text。
