---
{
  "schema_version": 2,
  "id": "matching-trace-color-chain",
  "title": "沿同色路徑連線",
  "title_en": "Trace a path through matching pieces",
  "category": "matching",
  "source_category": "matching",
  "tags": [
    "planning",
    "spatial",
    "precision"
  ],
  "summary": "一次拖动选择整条路线，长度和终点都影响收益。",
  "note_status": "draft",
  "related": [
    "matching-clear-under-cargo",
    "matching-complete-lines",
    "matching-gravity-cascade",
    "matching-merge-three-upgrade"
  ],
  "sources": [
    {
      "title": "Trace a path through matching pieces — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/matching-trace-color-chain/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「一次拖动选择整条路线，长度和终点都影响收益。」
出處：`sources/text/matching-trace-color-chain.json` 字元 196-218 `summary.zh`
顯示：一次拖動選擇整條路線，長度和終點都影響收益。

## 規則

「玩家沿允许的相邻方向，连续选中同类物件，松手后整条链一起结算。路线不能随意跨越空格或不匹配物件，因此玩家要在当前可达范围里比较长链、目标位置和结束位置。」
出處：`sources/text/matching-trace-color-chain.json` 字元 331-407 `rules.zh`
顯示：玩家沿允許的相鄰方向，連續選中同類物件，鬆手後整條鏈一起結算。路線不能隨意跨越空格或不匹配物件，因此玩家要在當前可達範圍裏比較長鏈、目標位置和結束位置。

## 核心循環

「看清可连接的物件」
出處：`sources/text/matching-trace-color-chain.json` 字元 701-709 `loop[0].zh`
顯示：看清可連接的物件

「拖出一条可行路径」
出處：`sources/text/matching-trace-color-chain.json` 字元 777-785 `loop[1].zh`
顯示：拖出一條可行路徑

「确认并结算整条链」
出處：`sources/text/matching-trace-color-chain.json` 字元 848-856 `loop[2].zh`
顯示：確認並結算整條鏈

「读取补位后的新路线」
出處：`sources/text/matching-trace-color-chain.json` 字元 929-938 `loop[3].zh`
顯示：讀取補位後的新路線

## 玩家取捨

「走最长的链，还是选择较短但能到达目标位置的链？」
出處：`sources/text/matching-trace-color-chain.json` 字元 1036-1059 `decisions[0].zh`
顯示：走最長的鏈，還是選擇較短但能到達目標位置的鏈？

「现在清掉连接桥，是否会把下一轮的一大片同类物件分开？」
出處：`sources/text/matching-trace-color-chain.json` 字元 1173-1199 `decisions[1].zh`
顯示：現在清掉連接橋，是否會把下一輪的一大片同類物件分開？

## 可調參數

「允许的相邻方向」
出處：`sources/text/matching-trace-color-chain.json` 字元 1348-1355 `parameters[0].name.zh`
顯示：允許的相鄰方向

「只允许横纵相邻容易读图；允许斜线会增加路线数量。」
出處：`sources/text/matching-trace-color-chain.json` 字元 1434-1458 `parameters[0].effect.zh`
顯示：只允許橫縱相鄰容易讀圖；允許斜線會增加路線數量。

「跨色连接点」
出處：`sources/text/matching-trace-color-chain.json` 字元 1616-1621 `parameters[1].name.zh`
顯示：跨色連接點

「少量连接点能打通被颜色分隔的区域，但必须显示切换后的合法路径。」
出處：`sources/text/matching-trace-color-chain.json` 字元 1701-1732 `parameters[1].effect.zh`
顯示：少量連接點能打通被顏色分隔的區域，但必須顯示切換後的合法路徑。

## 原型

「做五乘五棋盘和可回退的连线预览，先只允许横纵相邻。」
出處：`sources/text/matching-trace-color-chain.json` 字元 3222-3247 `prototype.firstStep.zh`
顯示：做五乘五棋盤和可回退的連線預覽，先只允許橫縱相鄰。

「玩家会不会主动缩短链来换取更好的终点或目标位置？」
出處：`sources/text/matching-trace-color-chain.json` 字元 3552-3576 `prototype.test.zh`
顯示：玩家會不會主動縮短鏈來換取更好的終點或目標位置？

「手指滑过拐角时容易误选；路径预览和退回上一格必须可靠。」
出處：`sources/text/matching-trace-color-chain.json` 字元 3385-3412 `prototype.pitfall.zh`
顯示：手指滑過拐角時容易誤選；路徑預覽和退回上一格必須可靠。

## 相關模式

- [清除下方貨物](matching-clear-under-cargo.md)
- [完成整行](matching-complete-lines.md)
- [重力連鎖](matching-gravity-cascade.md)
- [合成三消升級](matching-merge-three-upgrade.md)

## 參考來源

- [Trace a path through matching pieces — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/matching-trace-color-chain/) — 查閱：2026-11-02；取得方式：page-text。
