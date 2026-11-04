---
{
  "schema_version": 2,
  "id": "cooking-heat-window",
  "title": "熱度窗口",
  "title_en": "Cooking completion windows",
  "category": "cooking",
  "source_category": "cooking",
  "tags": [
    "timing",
    "risk",
    "time"
  ],
  "summary": "熟了不等于完成：必须在过火之前取走。",
  "note_status": "draft",
  "related": [
    "cooking-order-triage",
    "cooking-food-preservation",
    "automation-byproduct-loop",
    "automation-power-budget"
  ],
  "sources": [
    {
      "title": "Cooking completion windows — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooking-heat-window/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「熟了不等于完成：必须在过火之前取走。」
出處：`sources/text/cooking-heat-window.json` 字元 174-192 `summary.zh`
顯示：熟了不等於完成：必須在過火之前取走。

## 規則

「食物放入热源后随时间变化，进入可取出的熟成窗口，继续加热则烧焦或引发事故。玩家需要离开做别的事，同时记住回来的时机；声音、颜色或进度条承担提醒。」
出處：`sources/text/cooking-heat-window.json` 字元 292-364 `rules.zh`
顯示：食物放入熱源後隨時間變化，進入可取出的熟成窗口，繼續加熱則燒焦或引發事故。玩家需要離開做別的事，同時記住回來的時機；聲音、顏色或進度條承擔提醒。

## 核心循環

「放入生食」
出處：`sources/text/cooking-heat-window.json` 字元 619-623 `loop[0].zh`

「等待同时做其他事」
出處：`sources/text/cooking-heat-window.json` 字元 681-689 `loop[1].zh`
顯示：等待同時做其他事

「辨认完成反馈」
出處：`sources/text/cooking-heat-window.json` 字元 753-759 `loop[2].zh`
顯示：辨認完成反饋

「及时取出」
出處：`sources/text/cooking-heat-window.json` 字元 823-827 `loop[3].zh`
顯示：及時取出

## 玩家取捨

「守着炉子保证成功，还是利用等待时间处理其他工作？」
出處：`sources/text/cooking-heat-window.json` 字元 909-933 `decisions[0].zh`
顯示：守着爐子保證成功，還是利用等待時間處理其他工作？

「两锅同时完成时先救哪一锅？」
出處：`sources/text/cooking-heat-window.json` 字元 1030-1043 `decisions[1].zh`
顯示：兩鍋同時完成時先救哪一鍋？

## 可調參數

「安全窗口」
出處：`sources/text/cooking-heat-window.json` 字元 1180-1184 `parameters[0].name.zh`

「窗口更短提高注意切换压力；更长适合轻松的营地节奏。」
出處：`sources/text/cooking-heat-window.json` 字元 1257-1282 `parameters[0].effect.zh`
顯示：窗口更短提高注意切換壓力；更長適合輕鬆的營地節奏。

「烧焦代价」
出處：`sources/text/cooking-heat-window.json` 字元 1434-1438 `parameters[1].name.zh`
顯示：燒焦代價

「损失材料促使谨慎；连锁火灾会把个人失误变成团队危机。」
出處：`sources/text/cooking-heat-window.json` 字元 1512-1538 `parameters[1].effect.zh`
顯示：損失材料促使謹慎；連鎖火災會把個人失誤變成團隊危機。

## 原型

「只做一个炉灶、一道有生／熟／焦三态的菜，再配一个耗时短任务。」
出處：`sources/text/cooking-heat-window.json` 字元 2921-2951 `prototype.firstStep.zh`
顯示：只做一個爐竈、一道有生／熟／焦三態的菜，再配一個耗時短任務。

「玩家能否离开炉灶去做事，并根据提示及时返回，而不是一直原地等？」
出處：`sources/text/cooking-heat-window.json` 字元 3273-3304 `prototype.test.zh`
顯示：玩家能否離開爐竈去做事，並根據提示及時返回，而不是一直原地等？

「过早做复杂物理搬运会掩盖时间取舍；先保证熟成提示可靠且可被发现。」
出處：`sources/text/cooking-heat-window.json` 字元 3085-3117 `prototype.pitfall.zh`
顯示：過早做複雜物理搬運會掩蓋時間取捨；先保證熟成提示可靠且可被發現。

## 相關模式

- [限時訂單的取捨順序](cooking-order-triage.md)
- [食物保存](cooking-food-preservation.md)
- [副產品循環](automation-byproduct-loop.md)
- [電力預算](automation-power-budget.md)

## 參考來源

- [Cooking completion windows — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooking-heat-window/) — 查閱：2026-11-02；取得方式：page-text。
