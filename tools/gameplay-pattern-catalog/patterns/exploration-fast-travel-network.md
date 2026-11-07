---
{
  "schema_version": 2,
  "id": "exploration-fast-travel-network",
  "title": "快速旅行網路",
  "title_en": "Unlockable fast-travel networks",
  "category": "exploration",
  "source_category": "exploration",
  "tags": [
    "progression",
    "planning",
    "discovery"
  ],
  "summary": "第一次路程保留探索，重复路程逐渐转化为网络选择。",
  "note_status": "draft",
  "related": [
    "exploration-ability-gates",
    "exploration-earned-map",
    "exploration-procedural-route-reading",
    "allocation-shop-reservation"
  ],
  "sources": [
    {
      "title": "Unlockable fast-travel networks — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/exploration-fast-travel-network/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「第一次路程保留探索，重复路程逐渐转化为网络选择。」
出處：`sources/text/exploration-fast-travel-network.json` 字元 198-222 `summary.zh`
顯示：第一次路程保留探索，重複路程逐漸轉化爲網絡選擇。

## 規則

「先实际抵达并激活旅行节点，再从已知网络选择目的地。危险状态或特殊区域可限制使用；新节点的反馈是后续路程变短，而不只是地图上多一个图标。」
出處：`sources/text/exploration-fast-travel-network.json` 字元 343-410 `rules.zh`
顯示：先實際抵達並激活旅行節點，再從已知網絡選擇目的地。危險狀態或特殊區域可限制使用；新節點的反饋是後續路程變短，而不只是地圖上多一個圖標。

## 核心循環

「探索抵达新节点」
出處：`sources/text/exploration-fast-travel-network.json` 字元 663-670 `loop[0].zh`
顯示：探索抵達新節點

「解锁网络连接」
出處：`sources/text/exploration-fast-travel-network.json` 字元 730-736 `loop[1].zh`
顯示：解鎖網絡連接

「选择后续目的地」
出處：`sources/text/exploration-fast-travel-network.json` 字元 803-810 `loop[2].zh`
顯示：選擇後續目的地

「跳过重复路段」
出處：`sources/text/exploration-fast-travel-network.json` 字元 880-886 `loop[3].zh`
顯示：跳過重複路段

## 玩家取捨

「冒险深入解锁节点，可能大幅降低今后的回访成本。」
出處：`sources/text/exploration-fast-travel-network.json` 字元 976-999 `decisions[0].zh`
顯示：冒險深入解鎖節點，可能大幅降低今後的回訪成本。

「现在回基地补给，还是先走到下一个节点，避免下次重复这段路？」
出處：`sources/text/exploration-fast-travel-network.json` 字元 1118-1147 `decisions[1].zh`
顯示：現在回基地補給，還是先走到下一個節點，避免下次重複這段路？

## 可調參數

「可用条件」
出處：`sources/text/exploration-fast-travel-network.json` 字元 1317-1321 `parameters[0].name.zh`
顯示：可用條件

「战斗中禁用可避免把传送变成无代价逃生按钮。」
出處：`sources/text/exploration-fast-travel-network.json` 字元 1406-1427 `parameters[0].effect.zh`
顯示：戰鬥中禁用可避免把傳送變成無代價逃生按鈕。

「节点密度」
出處：`sources/text/exploration-fast-travel-network.json` 字元 1573-1577 `parameters[1].name.zh`
顯示：節點密度

「密度高适合内容回收，密度低保留路途的重量。」
出處：`sources/text/exploration-fast-travel-network.json` 字元 1651-1672 `parameters[1].effect.zh`
顯示：密度高適合內容回收，密度低保留路途的重量。

## 原型

「做三个区域、三个可激活节点和一张只显示已解锁目的地的旅行菜单。」
出處：`sources/text/exploration-fast-travel-network.json` 字元 3196-3227 `prototype.firstStep.zh`
顯示：做三個區域、三個可激活節點和一張只顯示已解鎖目的地的旅行菜單。

「观察玩家是否愿意为一个未来有用的节点绕路，而非只把它当免费图标。」
出處：`sources/text/exploration-fast-travel-network.json` 字元 3536-3568 `prototype.test.zh`
顯示：觀察玩家是否願意爲一個未來有用的節點繞路，而非只把它當免費圖標。

「节点过密会消除区域之间的体验；先验证首次抵达是否仍值得玩家记住。」
出處：`sources/text/exploration-fast-travel-network.json` 字元 3362-3394 `prototype.pitfall.zh`
顯示：節點過密會消除區域之間的體驗；先驗證首次抵達是否仍值得玩家記住。

## 相關模式

- [能力解鎖與回訪](exploration-ability-gates.md)
- [掙得地圖](exploration-earned-map.md)
- [程序路線判讀](exploration-procedural-route-reading.md)
- [商店保留與選項成本](allocation-shop-reservation.md)

## 參考來源

- [Unlockable fast-travel networks — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/exploration-fast-travel-network/) — 查閱：2026-11-02；取得方式：page-text。
