---
{
  "schema_version": 2,
  "id": "cooking-ingredient-substitution",
  "title": "食材替換",
  "title_en": "Ingredient substitution",
  "category": "cooking",
  "source_category": "cooking",
  "tags": [
    "economy",
    "planning",
    "optimization"
  ],
  "summary": "满足配方条件即可换料，把稀缺材料留给更重要的用途。",
  "note_status": "draft",
  "related": [
    "commerce-trade-route-programming",
    "cooking-food-preservation",
    "cooking-meal-loadout",
    "cooking-preparation-chain"
  ],
  "sources": [
    {
      "title": "Ingredient substitution — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooking-ingredient-substitution/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「满足配方条件即可换料，把稀缺材料留给更重要的用途。」
出處：`sources/text/cooking-ingredient-substitution.json` 字元 183-208 `summary.zh`
顯示：滿足配方條件即可換料，把稀缺材料留給更重要的用途。

## 規則

「配方可以要求具体物品，也可以要求食材类别或属性。玩家在满足条件的前提下选择便宜、过剩或快坏的材料；结果取决于规则，而不只是背下一组固定名称。」
出處：`sources/text/cooking-ingredient-substitution.json` 字元 329-399 `rules.zh`
顯示：配方可以要求具體物品，也可以要求食材類別或屬性。玩家在滿足條件的前提下選擇便宜、過剩或快壞的材料；結果取決於規則，而不只是背下一組固定名稱。

## 核心循環

「查看必须条件」
出處：`sources/text/cooking-ingredient-substitution.json` 字元 661-667 `loop[0].zh`
顯示：查看必須條件

「选择可替代材料」
出處：`sources/text/cooking-ingredient-substitution.json` 字元 736-743 `loop[1].zh`
顯示：選擇可替代材料

「检查冲突与成本」
出處：`sources/text/cooking-ingredient-substitution.json` 字元 811-818 `loop[2].zh`
顯示：檢查衝突與成本

「制作并保留贵重食材」
出處：`sources/text/cooking-ingredient-substitution.json` 字元 886-895 `loop[3].zh`
顯示：製作並保留貴重食材

## 玩家取捨

「用高价鱼做普通菜，还是换成便宜鱼？」
出處：`sources/text/cooking-ingredient-substitution.json` 字元 998-1015 `decisions[0].zh`
顯示：用高價魚做普通菜，還是換成便宜魚？

「替换后仍满足所有条件吗，是否触发另一配方？」
出處：`sources/text/cooking-ingredient-substitution.json` 字元 1107-1128 `decisions[1].zh`
顯示：替換後仍滿足所有條件嗎，是否觸發另一配方？

## 可調參數

「替代范围」
出處：`sources/text/cooking-ingredient-substitution.json` 字元 1288-1292 `parameters[0].name.zh`
顯示：替代範圍

「范围越宽越能救活杂乱库存；太宽会抹平食材身份。」
出處：`sources/text/cooking-ingredient-substitution.json` 字元 1374-1397 `parameters[0].effect.zh`
顯示：範圍越寬越能救活雜亂庫存；太寬會抹平食材身份。

「冲突规则透明度」
出處：`sources/text/cooking-ingredient-substitution.json` 字元 1555-1562 `parameters[1].name.zh`
顯示：衝突規則透明度

「提前预览结果鼓励优化；隐藏优先级会把首次尝试变成试错。」
出處：`sources/text/cooking-ingredient-substitution.json` 字元 1643-1670 `parameters[1].effect.zh`
顯示：提前預覽結果鼓勵優化；隱藏優先級會把首次嘗試變成試錯。

## 原型

「做“任意鱼＋蔬菜”与一个更严格配方，让玩家看到材料类别和预期结果。」
出處：`sources/text/cooking-ingredient-substitution.json` 字元 3163-3196 `prototype.firstStep.zh`
顯示：做“任意魚＋蔬菜”與一個更嚴格配方，讓玩家看到材料類別和預期結果。

「当某种材料涨价或快过期时，玩家是否能主动替换并保留贵重材料？」
出處：`sources/text/cooking-ingredient-substitution.json` 字元 3552-3582 `prototype.test.zh`
顯示：當某種材料漲價或快過期時，玩家是否能主動替換並保留貴重材料？

「隐藏配方优先级会使替换结果难解释，先明确哪条规则决定最后出锅的菜。」
出處：`sources/text/cooking-ingredient-substitution.json` 字元 3366-3399 `prototype.pitfall.zh`
顯示：隱藏配方優先級會使替換結果難解釋，先明確哪條規則決定最後出鍋的菜。

## 相關模式

- [貿易路線編排](commerce-trade-route-programming.md)
- [食物保存](cooking-food-preservation.md)
- [餐點配置組](cooking-meal-loadout.md)
- [備料連鎖](cooking-preparation-chain.md)

## 參考來源

- [Ingredient substitution — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooking-ingredient-substitution/) — 查閱：2026-11-02；取得方式：page-text。
