---
{
  "schema_version": 2,
  "id": "exploration-air-action-refill",
  "title": "空中行動回補",
  "title_en": "Air movement and refill nodes",
  "category": "movement",
  "source_category": "movement",
  "tags": [
    "dexterity",
    "planning",
    "spatial"
  ],
  "summary": "让一次跳跃通过有限位移资源，串成一整条空中路线。",
  "note_status": "draft",
  "related": [
    "exploration-climbing-rest-route",
    "exploration-gliding-descent",
    "exploration-grapple-swing",
    "exploration-wall-jump"
  ],
  "sources": [
    {
      "title": "Air movement and refill nodes — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/exploration-air-action-refill/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「让一次跳跃通过有限位移资源，串成一整条空中路线。」
出處：`sources/text/exploration-air-action-refill.json` 字元 191-215 `summary.zh`
顯示：讓一次跳躍通過有限位移資源，串成一整條空中路線。

## 規則

「空中位移只有有限次数或依赖消耗物，玩家必须在耗尽前接触补充点或安全落地。资源状态清楚反馈还剩几次修正机会，关卡通过补充点的位置塑造路线。」
出處：`sources/text/exploration-air-action-refill.json` 字元 320-388 `rules.zh`
顯示：空中位移只有有限次數或依賴消耗物，玩家必須在耗盡前接觸補充點或安全落地。資源狀態清楚反饋還剩幾次修正機會，關卡通過補充點的位置塑造路線。

## 核心循環

「辨认落点与补充点」
出處：`sources/text/exploration-air-action-refill.json` 字元 644-652 `loop[0].zh`
顯示：辨認落點與補充點

「消耗空中位移」
出處：`sources/text/exploration-air-action-refill.json` 字元 723-729 `loop[1].zh`

「接触补充节点」
出處：`sources/text/exploration-air-action-refill.json` 字元 796-802 `loop[2].zh`
顯示：接觸補充節點

「重新规划下一段」
出處：`sources/text/exploration-air-action-refill.json` 字元 862-869 `loop[3].zh`
顯示：重新規劃下一段

## 玩家取捨

「现在用掉位移纠正失误，还是留下来跨越最后的缺口？」
出處：`sources/text/exploration-air-action-refill.json` 字元 955-979 `decisions[0].zh`
顯示：現在用掉位移糾正失誤，還是留下來跨越最後的缺口？

「直线更短，但绕到补充点可能开辟更长的连续路线。」
出處：`sources/text/exploration-air-action-refill.json` 字元 1088-1111 `decisions[1].zh`
顯示：直線更短，但繞到補充點可能開闢更長的連續路線。

## 可調參數

「可储存次数」
出處：`sources/text/exploration-air-action-refill.json` 字元 1280-1285 `parameters[0].name.zh`
顯示：可儲存次數

「多次储存允许补救，单次储存会突出节点顺序。」
出處：`sources/text/exploration-air-action-refill.json` 字元 1361-1382 `parameters[0].effect.zh`
顯示：多次儲存允許補救，單次儲存會突出節點順序。

「补充点位置」
出處：`sources/text/exploration-air-action-refill.json` 字元 1523-1528 `parameters[1].name.zh`
顯示：補充點位置

「放在危险边缘会鼓励冒险，放在安全处则适合学习。」
出處：`sources/text/exploration-air-action-refill.json` 字元 1606-1629 `parameters[1].effect.zh`
顯示：放在危險邊緣會鼓勵冒險，放在安全處則適合學習。

## 原型

「做一次冲刺、一种空中补充物和一个需要连续使用两次冲刺的房间。」
出處：`sources/text/exploration-air-action-refill.json` 字元 3136-3166 `prototype.firstStep.zh`
顯示：做一次衝刺、一種空中補充物和一個需要連續使用兩次衝刺的房間。

「观察玩家失败后是否调整先碰哪个补充点，而不是只改变按键速度。」
出處：`sources/text/exploration-air-action-refill.json` 字元 3465-3495 `prototype.test.zh`
顯示：觀察玩家失敗後是否調整先碰哪個補充點，而不是隻改變按鍵速度。

「补充必须可见可感知；玩家不知道是否恢复时，路线规划会变成猜测。」
出處：`sources/text/exploration-air-action-refill.json` 字元 3295-3326 `prototype.pitfall.zh`
顯示：補充必須可見可感知；玩家不知道是否恢復時，路線規劃會變成猜測。

## 相關模式

- [攀爬休息點路線](exploration-climbing-rest-route.md)
- [滑翔下降](exploration-gliding-descent.md)
- [鉤索擺盪決策](exploration-grapple-swing.md)
- [牆面跳躍](exploration-wall-jump.md)

## 參考來源

- [Air movement and refill nodes — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/exploration-air-action-refill/) — 查閱：2026-11-02；取得方式：page-text。
