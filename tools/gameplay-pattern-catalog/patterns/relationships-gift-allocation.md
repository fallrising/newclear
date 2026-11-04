---
{
  "schema_version": 2,
  "id": "relationships-gift-allocation",
  "title": "偏好探索與禮物分配",
  "title_en": "Gift preferences and allocation",
  "category": "relationships",
  "source_category": "relationships",
  "tags": [
    "preference-learning",
    "scarce-resource",
    "relationship"
  ],
  "summary": "把有限礼物送给合适的人，换取关系或实用回馈。",
  "note_status": "draft",
  "related": [
    "commerce-price-discovery",
    "cooking-recipe-learning"
  ],
  "sources": [
    {
      "title": "Gift preferences and allocation — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/relationships-gift-allocation/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把有限礼物送给合适的人，换取关系或实用回馈。」
出處：`sources/text/relationships-gift-allocation.json` 字元 196-218 `summary.zh`
顯示：把有限禮物送給合適的人，換取關係或實用回饋。

## 規則

「玩家从礼物库存中选择对象和物品。接收者的偏好、赠送次数限制或剧情门槛改变收益；台词、关系记录或回礼让玩家修正下一次分配。」
出處：`sources/text/relationships-gift-allocation.json` 字元 334-394 `rules.zh`
顯示：玩家從禮物庫存中選擇對象和物品。接收者的偏好、贈送次數限制或劇情門檻改變收益；臺詞、關係記錄或回禮讓玩家修正下一次分配。

## 核心循環

「了解对象」
出處：`sources/text/relationships-gift-allocation.json` 字元 616-620 `loop[0].zh`
顯示：瞭解對象

「获得礼物」
出處：`sources/text/relationships-gift-allocation.json` 字元 681-685 `loop[1].zh`
顯示：獲得禮物

「分配并赠送」
出處：`sources/text/relationships-gift-allocation.json` 字元 742-747 `loop[2].zh`
顯示：分配並贈送

「记录反应」
出處：`sources/text/relationships-gift-allocation.json` 字元 808-812 `loop[3].zh`
顯示：記錄反應

## 玩家取捨

「稀有礼物给最喜欢的角色，还是给能立即提供能力的人？」
出處：`sources/text/relationships-gift-allocation.json` 字元 893-918 `decisions[0].zh`
顯示：稀有禮物給最喜歡的角色，還是給能立即提供能力的人？

「未知偏好值得试错，还是重复已知的安全选择？」
出處：`sources/text/relationships-gift-allocation.json` 字元 1041-1062 `decisions[1].zh`
顯示：未知偏好值得試錯，還是重複已知的安全選擇？

## 可調參數

「偏好差异」
出處：`sources/text/relationships-gift-allocation.json` 字元 1197-1201 `parameters[0].name.zh`
顯示：偏好差異

「差异越大，记住人物细节越有价值。」
出處：`sources/text/relationships-gift-allocation.json` 字元 1280-1296 `parameters[0].effect.zh`
顯示：差異越大，記住人物細節越有價值。

「赠送上限」
出處：`sources/text/relationships-gift-allocation.json` 字元 1424-1428 `parameters[1].name.zh`
顯示：贈送上限

「上限越低，单次分配越重要，也越容易形成等待。」
出處：`sources/text/relationships-gift-allocation.json` 字元 1504-1526 `parameters[1].effect.zh`
顯示：上限越低，單次分配越重要，也越容易形成等待。

## 原型

「做三位角色、六种礼物和可记录的喜欢、普通、讨厌三种反应。」
出處：`sources/text/relationships-gift-allocation.json` 字元 3024-3052 `prototype.firstStep.zh`
顯示：做三位角色、六種禮物和可記錄的喜歡、普通、討厭三種反應。

「礼物不足时，观察玩家是否依据偏好和目标分配，而非每人机械送一份。」
出處：`sources/text/relationships-gift-allocation.json` 字元 3382-3414 `prototype.test.zh`
顯示：禮物不足時，觀察玩家是否依據偏好和目標分配，而非每人機械送一份。

「不必先写大量台词；先让偏好能被观察与记忆，避免纯试错查表。」
出處：`sources/text/relationships-gift-allocation.json` 字元 3194-3223 `prototype.pitfall.zh`
顯示：不必先寫大量臺詞；先讓偏好能被觀察與記憶，避免純試錯查表。

## 相關模式

- [以回饋進行價格探索](commerce-price-discovery.md)
- [知識與材料雙重解鎖](cooking-recipe-learning.md)

## 參考來源

- [Gift preferences and allocation — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/relationships-gift-allocation/) — 查閱：2026-11-02；取得方式：page-text。
