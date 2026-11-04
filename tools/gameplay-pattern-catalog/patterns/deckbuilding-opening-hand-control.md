---
{
  "schema_version": 2,
  "id": "deckbuilding-opening-hand-control",
  "title": "起手牌的可控範圍",
  "title_en": "Choosing guaranteed opening cards",
  "category": "deckbuilding",
  "source_category": "deckbuilding",
  "tags": [
    "planning",
    "optimization"
  ],
  "summary": "把最关键的准备步骤放进首回合，换取开局的稳定性。",
  "note_status": "draft",
  "related": [
    "deckbuilding-dice-allocation",
    "deckbuilding-duplicate-investment",
    "deckbuilding-reward-choice",
    "deckbuilding-temporary-generation"
  ],
  "sources": [
    {
      "title": "Choosing guaranteed opening cards — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-opening-hand-control/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把最关键的准备步骤放进首回合，换取开局的稳定性。」
出處：`sources/text/deckbuilding-opening-hand-control.json` 字元 202-226 `summary.zh`
顯示：把最關鍵的準備步驟放進首回合，換取開局的穩定性。

## 規則

「给少量牌附加开局保证，使它们必定出现在首手或专门的开局阶段。玩家在战前选择先保证哪个环节，同时承担占用首手位置、金币或稀缺标记的成本。」
出處：`sources/text/deckbuilding-opening-hand-control.json` 字元 329-396 `rules.zh`
顯示：給少量牌附加開局保證，使它們必定出現在首手或專門的開局階段。玩家在戰前選擇先保證哪個環節，同時承擔佔用首手位置、金幣或稀缺標記的成本。

## 核心循環

「找出开局依赖」
出處：`sources/text/deckbuilding-opening-hand-control.json` 字元 640-646 `loop[0].zh`
顯示：找出開局依賴

「分配开局标记」
出處：`sources/text/deckbuilding-opening-hand-control.json` 字元 719-725 `loop[1].zh`
顯示：分配開局標記

「稳定启动组合」
出處：`sources/text/deckbuilding-opening-hand-control.json` 字元 790-796 `loop[2].zh`
顯示：穩定啓動組合

「按新需求重新安排」
出處：`sources/text/deckbuilding-opening-hand-control.json` 字元 870-878 `loop[3].zh`

## 玩家取捨

「保证防守能降低翻车风险，保证引擎牌能更快滚起优势，先选哪一个？」
出處：`sources/text/deckbuilding-opening-hand-control.json` 字元 965-996 `decisions[0].zh`
顯示：保證防守能降低翻車風險，保證引擎牌能更快滾起優勢，先選哪一個？

「首手全是准备牌时，是否还留得下立即应对敌人的牌？」
出處：`sources/text/deckbuilding-opening-hand-control.json` 字元 1106-1130 `decisions[1].zh`
顯示：首手全是準備牌時，是否還留得下立即應對敵人的牌？

## 可調參數

「保证数量」
出處：`sources/text/deckbuilding-opening-hand-control.json` 字元 1273-1277 `parameters[0].name.zh`
顯示：保證數量

「数量过多会让每场开局变成固定脚本。」
出處：`sources/text/deckbuilding-opening-hand-control.json` 字元 1360-1377 `parameters[0].effect.zh`
顯示：數量過多會讓每場開局變成固定腳本。

「附加行动成本」
出處：`sources/text/deckbuilding-opening-hand-control.json` 字元 1509-1515 `parameters[1].name.zh`
顯示：附加行動成本

「只保证抽到与额外免费打出，会产生很不同的强度。」
出處：`sources/text/deckbuilding-opening-hand-control.json` 字元 1596-1619 `parameters[1].effect.zh`
顯示：只保證抽到與額外免費打出，會產生很不同的強度。

## 原型

「做八张牌和一个可移动的开局标记，让玩家连续试三次开局。」
出處：`sources/text/deckbuilding-opening-hand-control.json` 字元 2993-3020 `prototype.firstStep.zh`
顯示：做八張牌和一個可移動的開局標記，讓玩家連續試三次開局。

「玩家能察觉开局更可靠，也能指出为它牺牲了哪个首手选项。」
出處：`sources/text/deckbuilding-opening-hand-control.json` 字元 3298-3325 `prototype.test.zh`
顯示：玩家能察覺開局更可靠，也能指出爲它犧牲了哪個首手選項。

「首版不要同时支持免费打出、额外抽牌和任意排序，以免分不清稳定性的价值。」
出處：`sources/text/deckbuilding-opening-hand-control.json` 字元 3149-3184 `prototype.pitfall.zh`
顯示：首版不要同時支持免費打出、額外抽牌和任意排序，以免分不清穩定性的價值。

## 相關模式

- [骰子配給](deckbuilding-dice-allocation.md)
- [複製投入](deckbuilding-duplicate-investment.md)
- [獎勵選擇](deckbuilding-reward-choice.md)
- [暫時生成](deckbuilding-temporary-generation.md)

## 參考來源

- [Choosing guaranteed opening cards — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/deckbuilding-opening-hand-control/) — 查閱：2026-11-02；取得方式：page-text。
