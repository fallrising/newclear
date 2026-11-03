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
  "summary": "用有限禮物連接偏好探索、關係經營與機會成本。",
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

## 來源摘要

原站描述將物品送給不同角色，偏好與贈禮限制影響收益，互動回饋幫助下一次分配。核心循環：蒐集偏好線索 → 取得禮物 → 選擇收禮者與物品並贈送 → 記錄反應。

## 問題與情境（本地分析）

適用於需要將角色互動與資源分配結合的系統。玩家應有理由在已知安全選項與探索未知偏好間權衡。

## 核心循環（本地分析）

- 玩家行動：從對話或互動中蒐集角色偏好的線索，並取得可以送出的禮物；贈送時要同時選擇收禮者與物品。
- 系統回饋：選定收禮者與禮物送出後，角色以不同程度的反應回應，玩家能分辨這份禮物是投其所好、普通還是踩雷。
- 下一個決策：記錄這次反應，決定下一份稀缺禮物要給同一個角色加深關係，還是轉給其他人。

## 解法與取捨（本地分析）

- 分開保存已知偏好與關係數值；介面應保留已觀察到的反應，避免重複背誦。
- 喜愛角色與實用獎勵可以構成不同動機，但不要暗示角色關係只有交換收益。

## 可調參數（本地分析）

- 禮物稀缺度、偏好提示、每日或故事階段限制、回饋是否即時。
- 偏好是否固定；若變動，需給出可理解的新情境。

## 失敗模式（本地分析）

- 唯一高收益禮物適用所有角色，會消除分配問題。
- 隱藏偏好頻繁隨機變動，會抹消學習價值。

## 最小原型與驗收（本地提案）

此原型尚未實玩驗證。其中的數量是本地測試設定，不是來源遊戲參數。

- 本地提案：三名原創角色、三種物品、每天兩次贈禮；不建完整對話系統。
- 驗收：Given 尚未知的偏好，When 送禮後收到回饋，Then 知識紀錄被更新，下一次選擇可直接查閱並減少盲目重試；另在禮物不足時，觀察玩家是否依偏好與目標分配，而非每人機械送一份。

## 相關模式

- [以回饋進行價格探索](commerce-price-discovery.md)：贈禮反應與顧客反應都是用一次付出換資訊，不能把單一個案當成全局真值。
- [知識與材料雙重解鎖](cooking-recipe-learning.md)：禮物與料理都可能先卡在「知道對方要什麼」或「手上有沒有材料」。

## 參考來源

- [Gift preferences and allocation — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/relationships-gift-allocation/) — 查閱：2026-11-02；取得方式：page-text。
