---
{
  "schema_version": 2,
  "id": "survival-body-inspection",
  "title": "檢查身體找出問題",
  "title_en": "Inspecting the body to find problems",
  "category": "survival",
  "source_category": "survival",
  "tags": [
    "information",
    "discovery"
  ],
  "summary": "先找出哪里出问题，才能用对处理方法。",
  "note_status": "draft",
  "related": [
    "puzzles-language-decoding",
    "puzzles-scene-deduction",
    "puzzles-visual-rule-learning",
    "survival-contagion-control"
  ],
  "sources": [
    {
      "title": "Inspecting the body to find problems — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/survival-body-inspection/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「先找出哪里出问题，才能用对处理方法。」
出處：`sources/text/survival-body-inspection.json` 字元 192-210 `summary.zh`
顯示：先找出哪裏出問題，才能用對處理方法。

## 規則

「系统先给出疼痛或异常提示，玩家打开身体视图逐部位检查，再选择相应工具处理。信息不是一次全部弹出；发现的位置和外观决定下一步操作。」
出處：`sources/text/survival-body-inspection.json` 字元 300-364 `rules.zh`
顯示：系統先給出疼痛或異常提示，玩家打開身體視圖逐部位檢查，再選擇相應工具處理。信息不是一次全部彈出；發現的位置和外觀決定下一步操作。

## 核心循環

「察觉异常提示」
出處：`sources/text/survival-body-inspection.json` 字元 599-605 `loop[0].zh`
顯示：察覺異常提示

「查看具体身体部位」
出處：`sources/text/survival-body-inspection.json` 字元 665-673 `loop[1].zh`
顯示：查看具體身體部位

「辨认问题并选择工具」
出處：`sources/text/survival-body-inspection.json` 字元 737-746 `loop[2].zh`
顯示：辨認問題並選擇工具

「处理后重新检查」
出處：`sources/text/survival-body-inspection.json` 字元 826-833 `loop[3].zh`
顯示：處理後重新檢查

## 玩家取捨

「先快速检查最可能的部位，还是全面排查？」
出處：`sources/text/survival-body-inspection.json` 字元 921-940 `decisions[0].zh`
顯示：先快速檢查最可能的部位，還是全面排查？

「看到表面伤口后还要不要查找其他问题？」
出處：`sources/text/survival-body-inspection.json` 字元 1039-1057 `decisions[1].zh`
顯示：看到表面傷口後還要不要查找其他問題？

## 可調參數

「线索精确度」
出處：`sources/text/survival-body-inspection.json` 字元 1191-1196 `parameters[0].name.zh`
顯示：線索精確度

「提示越模糊越强调观察，但必须有可辨认的外观或部位线索。」
出處：`sources/text/survival-body-inspection.json` 字元 1272-1299 `parameters[0].effect.zh`
顯示：提示越模糊越強調觀察，但必須有可辨認的外觀或部位線索。

「检查成本」
出處：`sources/text/survival-body-inspection.json` 字元 1450-1454 `parameters[1].name.zh`
顯示：檢查成本

「检查占用时间会带来时机取舍；免费检查更适合慢节奏诊断。」
出處：`sources/text/survival-body-inspection.json` 字元 1531-1558 `parameters[1].effect.zh`
顯示：檢查佔用時間會帶來時機取捨；免費檢查更適合慢節奏診斷。

## 原型

「先用一张二维身体图、四个检查区域和两种异常实现完整循环。」
出處：`sources/text/survival-body-inspection.json` 字元 2905-2933 `prototype.firstStep.zh`
顯示：先用一張二維身體圖、四個檢查區域和兩種異常實現完整循環。

「不给答案提示，看玩家能否通过检查找到并处理异常。」
出處：`sources/text/survival-body-inspection.json` 字元 3220-3244 `prototype.test.zh`
顯示：不給答案提示，看玩家能否通過檢查找到並處理異常。

「第一版无需可旋转三维人体；关键是线索、位置和处理动作对应清楚。」
出處：`sources/text/survival-body-inspection.json` 字元 3056-3087 `prototype.pitfall.zh`
顯示：第一版無需可旋轉三維人體；關鍵是線索、位置和處理動作對應清楚。

## 相關模式

- [語言解碼](puzzles-language-decoding.md)
- [現場推理](puzzles-scene-deduction.md)
- [視覺規則學習](puzzles-visual-rule-learning.md)
- [傳染控制](survival-contagion-control.md)

## 參考來源

- [Inspecting the body to find problems — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/survival-body-inspection/) — 查閱：2026-11-02；取得方式：page-text。
