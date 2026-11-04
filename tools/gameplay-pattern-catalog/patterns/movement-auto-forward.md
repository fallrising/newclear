---
{
  "schema_version": 2,
  "id": "movement-auto-forward",
  "title": "自動推進前進",
  "title_en": "Choose action timing while moving automatically",
  "category": "movement",
  "source_category": "movement",
  "tags": [
    "timing",
    "dexterity",
    "precision"
  ],
  "summary": "方向已经确定，你只负责在对的时间跳、滑或出手。",
  "note_status": "draft",
  "related": [
    "movement-variable-jump",
    "exploration-grapple-swing",
    "exploration-wall-jump",
    "movement-low-slide"
  ],
  "sources": [
    {
      "title": "Choose action timing while moving automatically — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/movement-auto-forward/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「方向已经确定，你只负责在对的时间跳、滑或出手。」
出處：`sources/text/movement-auto-forward.json` 字元 203-226 `summary.zh`
顯示：方向已經確定，你只負責在對的時間跳、滑或出手。

## 規則

「角色持续向前移动，玩家不能靠停在原地消除压力。前方障碍以可辨认的顺序出现，玩家根据距离和速度选择动作时机；成功通过后马上读取下一组障碍，失误则结束或退回一段。」
出處：`sources/text/movement-auto-forward.json` 字元 334-413 `rules.zh`
顯示：角色持續向前移動，玩家不能靠停在原地消除壓力。前方障礙以可辨認的順序出現，玩家根據距離和速度選擇動作時機；成功通過後馬上讀取下一組障礙，失誤則結束或退回一段。

## 核心循環

「读取即将接近的障碍」
出處：`sources/text/movement-auto-forward.json` 字元 738-747 `loop[0].zh`
顯示：讀取即將接近的障礙

「选择动作和触发时机」
出處：`sources/text/movement-auto-forward.json` 字元 817-826 `loop[1].zh`
顯示：選擇動作和觸發時機

「通过或碰撞」
出處：`sources/text/movement-auto-forward.json` 字元 897-902 `loop[2].zh`
顯示：通過或碰撞

「继续读取下一组」
出處：`sources/text/movement-auto-forward.json` 字元 975-982 `loop[3].zh`
顯示：繼續讀取下一組

## 玩家取捨

「提前跳更稳，但会不会太早落进后面的空隙？」
出處：`sources/text/movement-auto-forward.json` 字元 1066-1086 `decisions[0].zh`
顯示：提前跳更穩，但會不會太早落進後面的空隙？

「为奖励使用更冒险的动作时机，还是只保证通过主路线？」
出處：`sources/text/movement-auto-forward.json` 字元 1205-1230 `decisions[1].zh`
顯示：爲獎勵使用更冒險的動作時機，還是隻保證通過主路線？

## 可調參數

「前方可见时间」
出處：`sources/text/movement-auto-forward.json` 字元 1384-1390 `parameters[0].name.zh`
顯示：前方可見時間

「可见时间越长越能计划动作序列；太短则容易变成记忆障碍位置。」
出處：`sources/text/movement-auto-forward.json` 字元 1467-1496 `parameters[0].effect.zh`
顯示：可見時間越長越能計劃動作序列；太短則容易變成記憶障礙位置。

「动作种类」
出處：`sources/text/movement-auto-forward.json` 字元 1671-1675 `parameters[1].name.zh`
顯示：動作種類

「单一跳跃强调时机，多种动作加入识别与切换，但也增加输入负担。」
出處：`sources/text/movement-auto-forward.json` 字元 1754-1784 `parameters[1].effect.zh`
顯示：單一跳躍強調時機，多種動作加入識別與切換，但也增加輸入負擔。

## 原型

「制作 20 秒固定速度路线，只放三种容易辨认的障碍；先用两个按键完成跳与滑。」
出處：`sources/text/movement-auto-forward.json` 字元 3464-3502 `prototype.firstStep.zh`
顯示：製作 20 秒固定速度路線，只放三種容易辨認的障礙；先用兩個按鍵完成跳與滑。

「观察连续失败是否集中在看不清下一障碍的位置；玩家应能说出自己按早了、按晚了还是选错动作。」
出處：`sources/text/movement-auto-forward.json` 字元 3874-3918 `prototype.test.zh`
顯示：觀察連續失敗是否集中在看不清下一障礙的位置；玩家應能說出自己按早了、按晚了還是選錯動作。

「不要一开始同时随机速度、间距与障碍类型，否则失败原因难以读懂。」
出處：`sources/text/movement-auto-forward.json` 字元 3682-3713 `prototype.pitfall.zh`
顯示：不要一開始同時隨機速度、間距與障礙類型，否則失敗原因難以讀懂。

## 相關模式

- [可變跳躍](movement-variable-jump.md)
- [鉤索擺盪決策](exploration-grapple-swing.md)
- [牆面跳躍](exploration-wall-jump.md)
- [低處滑動](movement-low-slide.md)

## 參考來源

- [Choose action timing while moving automatically — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/movement-auto-forward/) — 查閱：2026-11-02；取得方式：page-text。
