---
{
  "schema_version": 2,
  "id": "driving-air-stunt",
  "title": "空中特技",
  "title_en": "Perform an airborne trick for a boost",
  "category": "driving",
  "source_category": "driving",
  "tags": [
    "timing",
    "risk",
    "dexterity"
  ],
  "summary": "把跳台提供的短暂腾空时间，变成额外动作和速度奖励。",
  "note_status": "draft",
  "related": [
    "driving-air-balance",
    "driving-drift-boost",
    "driving-slipstream",
    "driving-start-charge"
  ],
  "sources": [
    {
      "title": "Perform an airborne trick for a boost — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/driving-air-stunt/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把跳台提供的短暂腾空时间，变成额外动作和速度奖励。」
出處：`sources/text/driving-air-stunt.json` 字元 186-211 `summary.zh`
顯示：把跳臺提供的短暫騰空時間，變成額外動作和速度獎勵。

## 規則

「玩家经过跳台或落差时获得动作窗口，在起跳时或空中输入特技，成功后获得加速奖励。窗口的位置和可连续动作次数由规则决定；玩家既要找到可利用的地形，也要判断剩余时间能否完成动作。」
出處：`sources/text/driving-air-stunt.json` 字元 324-410 `rules.zh`
顯示：玩家經過跳臺或落差時獲得動作窗口，在起跳時或空中輸入特技，成功後獲得加速獎勵。窗口的位置和可連續動作次數由規則決定；玩家既要找到可利用的地形，也要判斷剩餘時間能否完成動作。

## 核心循環

「发现跳台或落差」
出處：`sources/text/driving-air-stunt.json` 字元 704-711 `loop[0].zh`
顯示：發現跳臺或落差

「判断可用动作时间」
出處：`sources/text/driving-air-stunt.json` 字元 774-782 `loop[1].zh`
顯示：判斷可用動作時間

「输入特技并完成落地」
出處：`sources/text/driving-air-stunt.json` 字元 858-867 `loop[2].zh`
顯示：輸入特技並完成落地

「利用奖励准备下个路段」
出處：`sources/text/driving-air-stunt.json` 字元 937-947 `loop[3].zh`
顯示：利用獎勵準備下個路段

## 玩家取捨

「走平稳路线还是利用有特技机会的落差？」
出處：`sources/text/driving-air-stunt.json` 字元 1047-1065 `decisions[0].zh`
顯示：走平穩路線還是利用有特技機會的落差？

「剩余腾空时间够再做一次，还是应准备落地？」
出處：`sources/text/driving-air-stunt.json` 字元 1161-1181 `decisions[1].zh`
顯示：剩餘騰空時間夠再做一次，還是應準備落地？

## 可調參數

「动作窗口位置」
出處：`sources/text/driving-air-stunt.json` 字元 1328-1334 `parameters[0].name.zh`
顯示：動作窗口位置

「起跳瞬间输入强调地形预判；空中输入更强调剩余时间判断。」
出處：`sources/text/driving-air-stunt.json` 字元 1419-1446 `parameters[0].effect.zh`
顯示：起跳瞬間輸入強調地形預判；空中輸入更強調剩餘時間判斷。

「连续动作奖励」
出處：`sources/text/driving-air-stunt.json` 字元 1603-1609 `parameters[1].name.zh`
顯示：連續動作獎勵

「递增奖励鼓励多做一次，但必须让失败原因清楚可见。」
出處：`sources/text/driving-air-stunt.json` 字元 1691-1715 `parameters[1].effect.zh`
顯示：遞增獎勵鼓勵多做一次，但必須讓失敗原因清楚可見。

## 原型

「先用固定跳跃轨迹、两种滞空时间和一个特技按钮验证时机，无需真实车辆物理。」
出處：`sources/text/driving-air-stunt.json` 字元 3254-3290 `prototype.firstStep.zh`
顯示：先用固定跳躍軌跡、兩種滯空時間和一個特技按鈕驗證時機，無需真實車輛物理。

「玩家是否会根据跳台长度主动减少或增加特技次数？」
出處：`sources/text/driving-air-stunt.json` 字元 3618-3641 `prototype.test.zh`
顯示：玩家是否會根據跳臺長度主動減少或增加特技次數？

「动画时长和判定时长必须一致，否则动作看似完成却失败。」
出處：`sources/text/driving-air-stunt.json` 字元 3460-3486 `prototype.pitfall.zh`
顯示：動畫時長和判定時長必須一致，否則動作看似完成卻失敗。

## 相關模式

- [空中平衡](driving-air-balance.md)
- [漂移加速](driving-drift-boost.md)
- [尾流跟車加速](driving-slipstream.md)
- [起步蓄力](driving-start-charge.md)

## 參考來源

- [Perform an airborne trick for a boost — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/driving-air-stunt/) — 查閱：2026-11-02；取得方式：page-text。
