---
{
  "schema_version": 2,
  "id": "projectiles-graze-reward",
  "title": "擦彈獎勵",
  "title_en": "Graze danger to earn a resource",
  "category": "projectiles",
  "source_category": "projectiles",
  "tags": [
    "dexterity",
    "risk",
    "precision"
  ],
  "summary": "安全躲开不再是唯一目标，靠近但不碰到也有收益。",
  "note_status": "draft",
  "related": [
    "projectiles-active-reload",
    "projectiles-charged-release",
    "projectiles-independent-aim",
    "projectiles-maintain-lock"
  ],
  "sources": [
    {
      "title": "Graze danger to earn a resource — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/projectiles-graze-reward/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「安全躲开不再是唯一目标，靠近但不碰到也有收益。」
出處：`sources/text/projectiles-graze-reward.json` 字元 194-217 `summary.zh`
顯示：安全躲開不再是唯一目標，靠近但不碰到也有收益。

## 規則

「角色外侧有一圈比受伤判定更大的擦弹区域。危险物进入这一区域而未真正命中时给予能量或其他资源，玩家再花掉资源获得反击或续航；需要清楚区分擦过、受伤和已领取奖励。」
出處：`sources/text/projectiles-graze-reward.json` 字元 336-415 `rules.zh`
顯示：角色外側有一圈比受傷判定更大的擦彈區域。危險物進入這一區域而未真正命中時給予能量或其他資源，玩家再花掉資源獲得反擊或續航；需要清楚區分擦過、受傷和已領取獎勵。

## 核心循環

「看清弹道与安全空隙」
出處：`sources/text/projectiles-graze-reward.json` 字元 701-710 `loop[0].zh`
顯示：看清彈道與安全空隙

「靠近边缘而不碰到中心」
出處：`sources/text/projectiles-graze-reward.json` 字元 785-795 `loop[1].zh`
顯示：靠近邊緣而不碰到中心

「取得擦弹资源」
出處：`sources/text/projectiles-graze-reward.json` 字元 884-890 `loop[2].zh`
顯示：取得擦彈資源

「使用资源后寻找下一次机会」
出處：`sources/text/projectiles-graze-reward.json` 字元 957-969 `loop[3].zh`
顯示：使用資源後尋找下一次機會

## 玩家取捨

「远离弹幕更稳，贴近弹幕能加快反击，但自己是否有足够容错？」
出處：`sources/text/projectiles-graze-reward.json` 字元 1075-1103 `decisions[0].zh`
顯示：遠離彈幕更穩，貼近彈幕能加快反擊，但自己是否有足夠容錯？

「资源已经够用时，继续贴近是否还值得？」
出處：`sources/text/projectiles-graze-reward.json` 字元 1231-1249 `decisions[1].zh`
顯示：資源已經夠用時，繼續貼近是否還值得？

## 可調參數

「受伤区与擦弹区间距」
出處：`sources/text/projectiles-graze-reward.json` 字元 1404-1413 `parameters[0].name.zh`
顯示：受傷區與擦彈區間距

「间距越宽越容易学会；过窄时视觉误差会让失败难以理解。」
出處：`sources/text/projectiles-graze-reward.json` 字元 1509-1535 `parameters[0].effect.zh`
顯示：間距越寬越容易學會；過窄時視覺誤差會讓失敗難以理解。

「重复计奖规则」
出處：`sources/text/projectiles-graze-reward.json` 字元 1692-1698 `parameters[1].name.zh`
顯示：重複計獎規則

「同一危险只给一次奖励能避免原地刷取；持续计奖则需额外限制停留风险。」
出處：`sources/text/projectiles-graze-reward.json` 字元 1778-1811 `parameters[1].effect.zh`
顯示：同一危險只給一次獎勵能避免原地刷取；持續計獎則需額外限制停留風險。

## 原型

「先做一种慢速弹、清楚可见的两圈判定，以及每颗弹只能给一次能量的规则。」
出處：`sources/text/projectiles-graze-reward.json` 字元 3333-3367 `prototype.firstStep.zh`
顯示：先做一種慢速彈、清楚可見的兩圈判定，以及每顆彈只能給一次能量的規則。

「玩家能否主动选择安全躲避或擦弹，并解释什么时候收益不值得风险？」
出處：`sources/text/projectiles-graze-reward.json` 字元 3699-3730 `prototype.test.zh`
顯示：玩家能否主動選擇安全躲避或擦彈，並解釋什麼時候收益不值得風險？

「不能把大角色图像当作受伤范围；判定与提示不清会让擦弹显得像随机受伤。」
出處：`sources/text/projectiles-graze-reward.json` 字元 3510-3544 `prototype.pitfall.zh`
顯示：不能把大角色圖像當作受傷範圍；判定與提示不清會讓擦彈顯得像隨機受傷。

## 相關模式

- [主動裝填](projectiles-active-reload.md)
- [蓄力後釋放](projectiles-charged-release.md)
- [分離瞄準](projectiles-independent-aim.md)
- [維持鎖定](projectiles-maintain-lock.md)

## 參考來源

- [Graze danger to earn a resource — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/projectiles-graze-reward/) — 查閱：2026-11-02；取得方式：page-text。
