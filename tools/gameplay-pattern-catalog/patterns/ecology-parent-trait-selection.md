---
{
  "schema_version": 2,
  "id": "ecology-parent-trait-selection",
  "title": "親代性狀選拔",
  "title_en": "Select parents for offspring traits",
  "category": "ecology",
  "source_category": "ecology",
  "tags": [
    "planning",
    "randomness",
    "progression"
  ],
  "summary": "繁殖之前看双方特点，繁殖之后检查哪些特点传给了下一代。",
  "note_status": "draft",
  "related": [
    "ecology-genetic-diversity",
    "ecology-animal-taming",
    "ecology-breeding-conditions",
    "ecology-habitat-capacity"
  ],
  "sources": [
    {
      "title": "Select parents for offspring traits — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/ecology-parent-trait-selection/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「繁殖之前看双方特点，繁殖之后检查哪些特点传给了下一代。」
出處：`sources/text/ecology-parent-trait-selection.json` 字元 198-225 `summary.zh`
顯示：繁殖之前看雙方特點，繁殖之後檢查哪些特點傳給了下一代。

## 規則

「玩家根据目标选择一对亲本，后代按公开或可研究的遗传规则获得性状。结果通常有不确定性，玩家要决定留下谁继续繁殖，而不是只让数量增加。」
出處：`sources/text/ecology-parent-trait-selection.json` 字元 353-418 `rules.zh`
顯示：玩家根據目標選擇一對親本，後代按公開或可研究的遺傳規則獲得性狀。結果通常有不確定性，玩家要決定留下誰繼續繁殖，而不是隻讓數量增加。

## 核心循環

「确定需要的后代特点」
出處：`sources/text/ecology-parent-trait-selection.json` 字元 681-690 `loop[0].zh`
顯示：確定需要的後代特點

「比较并配对亲本」
出處：`sources/text/ecology-parent-trait-selection.json` 字元 765-772 `loop[1].zh`
顯示：比較並配對親本

「检查后代的实际结果」
出處：`sources/text/ecology-parent-trait-selection.json` 字元 840-849 `loop[2].zh`
顯示：檢查後代的實際結果

「留下合适个体进行下一代」
出處：`sources/text/ecology-parent-trait-selection.json` 字元 923-934 `loop[3].zh`
顯示：留下合適個體進行下一代

## 玩家取捨

「选当前数值最高的两个，还是选特点互补的一对？」
出處：`sources/text/ecology-parent-trait-selection.json` 字元 1047-1069 `decisions[0].zh`
顯示：選當前數值最高的兩個，還是選特點互補的一對？

「已有合适后代时停止，还是继续繁殖争取稀有组合？」
出處：`sources/text/ecology-parent-trait-selection.json` 字元 1174-1197 `decisions[1].zh`
顯示：已有合適後代時停止，還是繼續繁殖爭取稀有組合？

## 可調參數

「遗传信息可见度」
出處：`sources/text/ecology-parent-trait-selection.json` 字元 1346-1353 `parameters[0].name.zh`
顯示：遺傳信息可見度

「只显示外观会鼓励试验；显示潜在基因能支持更明确的配对推理。」
出處：`sources/text/ecology-parent-trait-selection.json` 字元 1437-1466 `parameters[0].effect.zh`
顯示：只顯示外觀會鼓勵試驗；顯示潛在基因能支持更明確的配對推理。

「育种占用成本」
出處：`sources/text/ecology-parent-trait-selection.json` 字元 1633-1639 `parameters[1].name.zh`
顯示：育種佔用成本

「后代占用空间和照料资源，才能让“再试一次”成为真实选择。」
出處：`sources/text/ecology-parent-trait-selection.json` 字元 1723-1751 `parameters[1].effect.zh`
顯示：後代佔用空間和照料資源，才能讓“再試一次”成爲真實選擇。

## 原型

「用两项性状、三个亲本和一个可解释的遗传表做三代实验。」
出處：`sources/text/ecology-parent-trait-selection.json` 字元 3246-3272 `prototype.firstStep.zh`
顯示：用兩項性狀、三個親本和一個可解釋的遺傳表做三代實驗。

「让玩家连续选择两代亲本，看其能否依据后代结果修改下一次配对。」
出處：`sources/text/ecology-parent-trait-selection.json` 字元 3619-3649 `prototype.test.zh`
顯示：讓玩家連續選擇兩代親本，看其能否依據後代結果修改下一次配對。

「不要先做几十种外观和复杂家谱；先让配对能改变后代选择。」
出處：`sources/text/ecology-parent-trait-selection.json` 字元 3431-3458 `prototype.pitfall.zh`
顯示：不要先做幾十種外觀和複雜家譜；先讓配對能改變後代選擇。

## 相關模式

- [遺傳多樣性](ecology-genetic-diversity.md)
- [動物馴養](ecology-animal-taming.md)
- [繁育條件組](ecology-breeding-conditions.md)
- [棲地容量](ecology-habitat-capacity.md)

## 參考來源

- [Select parents for offspring traits — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/ecology-parent-trait-selection/) — 查閱：2026-11-02；取得方式：page-text。
