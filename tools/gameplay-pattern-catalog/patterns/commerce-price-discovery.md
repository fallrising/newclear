---
{
  "schema_version": 2,
  "id": "commerce-price-discovery",
  "title": "以回饋進行價格探索",
  "title_en": "Price discovery",
  "category": "commerce",
  "source_category": "commerce",
  "tags": [
    "information-gain",
    "exploration-exploitation",
    "pricing"
  ],
  "summary": "根据顾客反应逐步找到可接受的售价，而不是直接查看标准答案。",
  "note_status": "draft",
  "related": [
    "relationships-gift-allocation",
    "allocation-shop-reservation"
  ],
  "sources": [
    {
      "title": "Price discovery — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/commerce-price-discovery/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「根据顾客反应逐步找到可接受的售价，而不是直接查看标准答案。」
出處：`sources/text/commerce-price-discovery.json` 字元 167-196 `summary.zh`
顯示：根據顧客反應逐步找到可接受的售價，而不是直接查看標準答案。

## 規則

「玩家给待售物定价，观察顾客是否接受及情绪反馈。更高价格提高单笔收益，却可能失去成交；把观察转化为下一轮报价才形成学习循环。」
出處：`sources/text/commerce-price-discovery.json` 字元 321-382 `rules.zh`
顯示：玩家給待售物定價，觀察顧客是否接受及情緒反饋。更高價格提高單筆收益，卻可能失去成交；把觀察轉化爲下一輪報價才形成學習循環。

## 核心循環

「选品并估价」
出處：`sources/text/commerce-price-discovery.json` 字元 593-598 `loop[0].zh`
顯示：選品並估價

「报出试探价格」
出處：`sources/text/commerce-price-discovery.json` 字元 661-667 `loop[1].zh`
顯示：報出試探價格

「观察顾客反应」
出處：`sources/text/commerce-price-discovery.json` 字元 728-734 `loop[2].zh`
顯示：觀察顧客反應

「调整下一次报价」
出處：`sources/text/commerce-price-discovery.json` 字元 795-802 `loop[3].zh`
顯示：調整下一次報價

## 玩家取捨

「先用低价确保成交，还是为获取上限信息承担流失？」
出處：`sources/text/commerce-price-discovery.json` 字元 888-911 `decisions[0].zh`
顯示：先用低價確保成交，還是爲獲取上限信息承擔流失？

「一个顾客接受高价，能否代表其他顾客也接受？」
出處：`sources/text/commerce-price-discovery.json` 字元 1018-1039 `decisions[1].zh`
顯示：一個顧客接受高價，能否代表其他顧客也接受？

## 可調參數

「反馈分辨率」
出處：`sources/text/commerce-price-discovery.json` 字元 1178-1183 `parameters[0].name.zh`
顯示：反饋分辨率

「细分表情方便收敛价格，模糊反馈保留试探空间。」
出處：`sources/text/commerce-price-discovery.json` 字元 1263-1285 `parameters[0].effect.zh`
顯示：細分表情方便收斂價格，模糊反饋保留試探空間。

「顾客差异」
出處：`sources/text/commerce-price-discovery.json` 字元 1437-1441 `parameters[1].name.zh`
顯示：顧客差異

「不同预算让定价无法一次求解，也增加理解成本。」
出處：`sources/text/commerce-price-discovery.json` 字元 1521-1543 `parameters[1].effect.zh`
顯示：不同預算讓定價無法一次求解，也增加理解成本。

## 原型

「做一种商品、三类购买预算与明确的嫌贵、满意、惊喜反应。」
出處：`sources/text/commerce-price-discovery.json` 字元 2985-3012 `prototype.firstStep.zh`
顯示：做一種商品、三類購買預算與明確的嫌貴、滿意、驚喜反應。

「观察玩家是否利用前次反应调整报价，而非无规律地来回改价。」
出處：`sources/text/commerce-price-discovery.json` 字元 3331-3359 `prototype.test.zh`
顯示：觀察玩家是否利用前次反應調整報價，而非無規律地來回改價。

「如果每次反馈直接显示答案，就没有试探；如果完全随机，又无法学习。」
出處：`sources/text/commerce-price-discovery.json` 字元 3165-3197 `prototype.pitfall.zh`
顯示：如果每次反饋直接顯示答案，就沒有試探；如果完全隨機，又無法學習。

## 相關模式

- [偏好探索與禮物分配](relationships-gift-allocation.md)
- [商店保留與選項成本](allocation-shop-reservation.md)

## 參考來源

- [Price discovery — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/commerce-price-discovery/) — 查閱：2026-11-02；取得方式：page-text。
