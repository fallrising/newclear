---
{
  "schema_version": 2,
  "id": "cooperation-downed-revival",
  "title": "倒地救起",
  "title_en": "Reviving a downed teammate",
  "category": "cooperation",
  "source_category": "cooperation",
  "tags": [
    "cooperation",
    "risk",
    "timing"
  ],
  "summary": "伙伴失去行动力后，队伍要拿眼前的安全换回一名战力。",
  "note_status": "draft",
  "related": [
    "cooperation-hidden-role",
    "cooperation-shared-vehicle",
    "cooperation-split-information",
    "cooperation-synchronized-triggers"
  ],
  "sources": [
    {
      "title": "Reviving a downed teammate — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooperation-downed-revival/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「伙伴失去行动力后，队伍要拿眼前的安全换回一名战力。」
出處：`sources/text/cooperation-downed-revival.json` 字元 186-211 `summary.zh`
顯示：夥伴失去行動力後，隊伍要拿眼前的安全換回一名戰力。

## 規則

「生命耗尽先进入倒地状态，伙伴靠近并持续救援才能让其重新行动。救援会占用时间和位置，周围威胁仍在；救回的人恢复队伍能力，救援者倒下则会扩大危机。」
出處：`sources/text/cooperation-downed-revival.json` 字元 324-395 `rules.zh`
顯示：生命耗盡先進入倒地狀態，夥伴靠近並持續救援才能讓其重新行動。救援會佔用時間和位置，周圍威脅仍在；救回的人恢復隊伍能力，救援者倒下則會擴大危機。

## 核心循環

「伙伴倒地并发出提示」
出處：`sources/text/cooperation-downed-revival.json` 字元 660-669 `loop[0].zh`
顯示：夥伴倒地併發出提示

「清理威胁或安排掩护」
出處：`sources/text/cooperation-downed-revival.json` 字元 738-747 `loop[1].zh`
顯示：清理威脅或安排掩護

「靠近并完成救援」
出處：`sources/text/cooperation-downed-revival.json` 字元 821-828 `loop[2].zh`
顯示：靠近並完成救援

「重整位置继续目标」
出處：`sources/text/cooperation-downed-revival.json` 字元 899-907 `loop[3].zh`
顯示：重整位置繼續目標

## 玩家取捨

「先救人，还是先处理会打断救援的敌人？」
出處：`sources/text/cooperation-downed-revival.json` 字元 1006-1024 `decisions[0].zh`
顯示：先救人，還是先處理會打斷救援的敵人？

「把防御资源留给自己，还是现在花掉为救援争取时间？」
出處：`sources/text/cooperation-downed-revival.json` 字元 1136-1160 `decisions[1].zh`
顯示：把防禦資源留給自己，還是現在花掉爲救援爭取時間？

## 可調參數

「救援耗时」
出處：`sources/text/cooperation-downed-revival.json` 字元 1308-1312 `parameters[0].name.zh`
顯示：救援耗時

「时间越长，掩护和选位置越重要。」
出處：`sources/text/cooperation-downed-revival.json` 字元 1389-1404 `parameters[0].effect.zh`
顯示：時間越長，掩護和選位置越重要。

「倒地后的等待限制」
出處：`sources/text/cooperation-downed-revival.json` 字元 1537-1545 `parameters[1].name.zh`
顯示：倒地後的等待限制

「有时限会催促救援，没有时限则允许先稳定局面。」
出處：`sources/text/cooperation-downed-revival.json` 字元 1627-1649 `parameters[1].effect.zh`
顯示：有時限會催促救援，沒有時限則允許先穩定局面。

## 原型

「先做同屏两人、一个移动威胁、倒地状态和可中断的两秒救援条。」
出處：`sources/text/cooperation-downed-revival.json` 字元 3125-3154 `prototype.firstStep.zh`
顯示：先做同屏兩人、一個移動威脅、倒地狀態和可中斷的兩秒救援條。

「试玩者遇到危险救援时会先制造安全窗口，而不是每次无脑按住救援键。」
出處：`sources/text/cooperation-downed-revival.json` 字元 3485-3517 `prototype.test.zh`
顯示：試玩者遇到危險救援時會先製造安全窗口，而不是每次無腦按住救援鍵。

「不要一开始就做完整射击和职业体系；先确保救援失败的原因能被看懂。」
出處：`sources/text/cooperation-downed-revival.json` 字元 3311-3343 `prototype.pitfall.zh`
顯示：不要一開始就做完整射擊和職業體系；先確保救援失敗的原因能被看懂。

## 相關模式

- [隱藏角色](cooperation-hidden-role.md)
- [共享載具](cooperation-shared-vehicle.md)
- [分工資訊](cooperation-split-information.md)
- [同步觸發組](cooperation-synchronized-triggers.md)

## 參考來源

- [Reviving a downed teammate — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooperation-downed-revival/) — 查閱：2026-11-02；取得方式：page-text。
