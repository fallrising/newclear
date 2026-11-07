---
{
  "schema_version": 2,
  "id": "cooperation-physical-tether",
  "title": "身體拘束繫繩",
  "title_en": "Move while physically tethered",
  "category": "cooperation",
  "source_category": "cooperation",
  "tags": [
    "cooperation",
    "spatial",
    "dexterity"
  ],
  "summary": "绳子把两人的移动连在一起，伙伴既能拉你上去，也会被你拖下去。",
  "note_status": "draft",
  "related": [
    "cooperation-synchronized-triggers",
    "cooperation-complementary-abilities",
    "cooperation-discussion-vote",
    "cooperation-downed-revival"
  ],
  "sources": [
    {
      "title": "Move while physically tethered — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/cooperation-physical-tether/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「绳子把两人的移动连在一起，伙伴既能拉你上去，也会被你拖下去。」
出處：`sources/text/cooperation-physical-tether.json` 字元 193-223 `summary.zh`
顯示：繩子把兩人的移動連在一起，夥伴既能拉你上去，也會被你拖下去。

## 規則

「角色之间有长度受限的物理连接，超过距离会产生牵拉。玩家协调站位、起跳和支撑，用连接把一个人的移动传给另一个人；失误也会沿连接影响全队。」
出處：`sources/text/cooperation-physical-tether.json` 字元 351-418 `rules.zh`
顯示：角色之間有長度受限的物理連接，超過距離會產生牽拉。玩家協調站位、起跳和支撐，用連接把一個人的移動傳給另一個人；失誤也會沿連接影響全隊。

## 核心循環

「观察平台与绳长」
出處：`sources/text/cooperation-physical-tether.json` 字元 640-647 `loop[0].zh`
顯示：觀察平臺與繩長

「约定谁固定谁移动」
出處：`sources/text/cooperation-physical-tether.json` 字元 726-734 `loop[1].zh`
顯示：約定誰固定誰移動

「同步起跳或借力摆荡」
出處：`sources/text/cooperation-physical-tether.json` 字元 810-819 `loop[2].zh`
顯示：同步起跳或借力擺盪

「落稳后交换职责」
出處：`sources/text/cooperation-physical-tether.json` 字元 898-905 `loop[3].zh`
顯示：落穩後交換職責

## 玩家取捨

「一起跳容易互相干扰，要不要让一人先站稳当支点？」
出處：`sources/text/cooperation-physical-tether.json` 字元 1002-1025 `decisions[0].zh`
顯示：一起跳容易互相干擾，要不要讓一人先站穩當支點？

「抢救正在掉落的伙伴，还是先稳住自己避免两人一起掉？」
出處：`sources/text/cooperation-physical-tether.json` 字元 1123-1148 `decisions[1].zh`
顯示：搶救正在掉落的夥伴，還是先穩住自己避免兩人一起掉？

## 可調參數

「连接长度」
出處：`sources/text/cooperation-physical-tether.json` 字元 1292-1296 `parameters[0].name.zh`
顯示：連接長度

「短绳要求贴近配合，长绳给摆荡空间也更难预判。」
出處：`sources/text/cooperation-physical-tether.json` 字元 1371-1393 `parameters[0].effect.zh`
顯示：短繩要求貼近配合，長繩給擺盪空間也更難預判。

「失误回退距离」
出處：`sources/text/cooperation-physical-tether.json` 字元 1561-1567 `parameters[1].name.zh`
顯示：失誤回退距離

「回退太远会把练习变成重复赶路，应匹配操作难度。」
出處：`sources/text/cooperation-physical-tether.json` 字元 1652-1675 `parameters[1].effect.zh`
顯示：回退太遠會把練習變成重複趕路，應匹配操作難度。

## 原型

「先做二维两人、三个平台、一条固定长度绳和明确的固定动作，只支持本机双人。」
出處：`sources/text/cooperation-physical-tether.json` 字元 3243-3279 `prototype.firstStep.zh`
顯示：先做二維兩人、三個平臺、一條固定長度繩和明確的固定動作，只支持本機雙人。

「试玩者能预测谁会被拉动，并在失败后主动改变支点或起跳顺序。」
出處：`sources/text/cooperation-physical-tether.json` 字元 3624-3653 `prototype.test.zh`
顯示：試玩者能預測誰會被拉動，並在失敗後主動改變支點或起跳順序。

「先避免绳子缠绕与三维碰撞；物理失控或联网延迟会让失败难以归因。」
出處：`sources/text/cooperation-physical-tether.json` 字元 3432-3463 `prototype.pitfall.zh`
顯示：先避免繩子纏繞與三維碰撞；物理失控或聯網延遲會讓失敗難以歸因。

## 相關模式

- [同步觸發組](cooperation-synchronized-triggers.md)
- [互補能力組](cooperation-complementary-abilities.md)
- [討論投票](cooperation-discussion-vote.md)
- [倒地救起](cooperation-downed-revival.md)

## 參考來源

- [Move while physically tethered — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/cooperation-physical-tether/) — 查閱：2026-11-02；取得方式：page-text。
