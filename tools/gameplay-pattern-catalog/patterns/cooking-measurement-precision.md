---
{
  "schema_version": 2,
  "id": "cooking-measurement-precision",
  "title": "計量精度",
  "title_en": "Measured ingredient dosing",
  "category": "cooking",
  "source_category": "cooking",
  "tags": [
    "precision",
    "dexterity",
    "information"
  ],
  "summary": "把配方中的数字变成手上需要控制的分量。",
  "note_status": "draft",
  "related": [
    "cooking-judged-flavor",
    "cooking-recipe-learning",
    "commerce-auction-bidding",
    "commerce-interpret-orders"
  ],
  "sources": [
    {
      "title": "Measured ingredient dosing — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooking-measurement-precision/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把配方中的数字变成手上需要控制的分量。」
出處：`sources/text/cooking-measurement-precision.json` 字元 182-201 `summary.zh`
顯示：把配方中的數字變成手上需要控制的分量。

## 規則

「玩家按要求称量、倾倒或分割材料，实际投入量参与结果计算。过量不一定能撤回，计量工具和分步添加能降低误差；反馈让玩家区分操作失误与配方问题。」
出處：`sources/text/cooking-measurement-precision.json` 字元 317-386 `rules.zh`
顯示：玩家按要求稱量、傾倒或分割材料，實際投入量參與結果計算。過量不一定能撤回，計量工具和分步添加能降低誤差；反饋讓玩家區分操作失誤與配方問題。

## 核心循環

「读取目标用量」
出處：`sources/text/cooking-measurement-precision.json` 字元 661-667 `loop[0].zh`
顯示：讀取目標用量

「选择容器或切分方式」
出處：`sources/text/cooking-measurement-precision.json` 字元 733-742 `loop[1].zh`
顯示：選擇容器或切分方式

「逐步加料」
出處：`sources/text/cooking-measurement-precision.json` 字元 825-829 `loop[2].zh`

「检查实际剂量」
出處：`sources/text/cooking-measurement-precision.json` 字元 890-896 `loop[3].zh`
顯示：檢查實際劑量

## 玩家取捨

「一次倒完节省时间，还是分次加料保证精度？」
出處：`sources/text/cooking-measurement-precision.json` 字元 986-1006 `decisions[0].zh`
顯示：一次倒完節省時間，還是分次加料保證精度？

「误差出现后补救整批，还是从头开始？」
出處：`sources/text/cooking-measurement-precision.json` 字元 1110-1127 `decisions[1].zh`
顯示：誤差出現後補救整批，還是從頭開始？

## 可調參數

「允许误差」
出處：`sources/text/cooking-measurement-precision.json` 字元 1252-1256 `parameters[0].name.zh`
顯示：允許誤差

「宽容差更适合轻松操作；窄容差提高工具掌握的价值。」
出處：`sources/text/cooking-measurement-precision.json` 字元 1327-1351 `parameters[0].effect.zh`
顯示：寬容差更適合輕鬆操作；窄容差提高工具掌握的價值。

「信息精度」
出處：`sources/text/cooking-measurement-precision.json` 字元 1490-1494 `parameters[1].name.zh`

「实时数字方便校准；只看外观会强调经验但降低可预测性。」
出處：`sources/text/cooking-measurement-precision.json` 字元 1576-1602 `parameters[1].effect.zh`
顯示：實時數字方便校準；只看外觀會強調經驗但降低可預測性。

## 原型

「做一个倾倒按钮、液量读数和目标范围，先用确定流速，不模拟完整液体物理。」
出處：`sources/text/cooking-measurement-precision.json` 字元 3104-3139 `prototype.firstStep.zh`
顯示：做一個傾倒按鈕、液量讀數和目標範圍，先用確定流速，不模擬完整液體物理。

「重复同一配方时，玩家是否逐渐从大步加料改为接近目标后的细调？」
出處：`sources/text/cooking-measurement-precision.json` 字元 3478-3508 `prototype.test.zh`
顯示：重複同一配方時，玩家是否逐漸從大步加料改爲接近目標後的細調？

「工具惯性、抖动与隐藏容差一起加入会难以调试；先让玩家理解误差来源。」
出處：`sources/text/cooking-measurement-precision.json` 字元 3293-3326 `prototype.pitfall.zh`
顯示：工具慣性、抖動與隱藏容差一起加入會難以調試；先讓玩家理解誤差來源。

## 相關模式

- [評分風味](cooking-judged-flavor.md)
- [知識與材料雙重解鎖](cooking-recipe-learning.md)
- [拍賣出價](commerce-auction-bidding.md)
- [顧客訂單的解讀](commerce-interpret-orders.md)

## 參考來源

- [Measured ingredient dosing — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooking-measurement-precision/) — 查閱：2026-11-02；取得方式：page-text。
