---
{
  "schema_version": 2,
  "id": "projectiles-active-reload",
  "title": "主動裝填",
  "title_en": "Press again inside the reload window",
  "category": "projectiles",
  "source_category": "projectiles",
  "tags": [
    "timing",
    "dexterity",
    "risk"
  ],
  "summary": "把等待装填的时间，变成一次可以争取额外收益的小判断。",
  "note_status": "draft",
  "related": [
    "projectiles-charged-release",
    "projectiles-graze-reward",
    "projectiles-heat-pacing",
    "projectiles-spread-recovery"
  ],
  "sources": [
    {
      "title": "Press again inside the reload window — Gameplay Atlas",
      "url": "https://gameplayatlas.loopyhop.com/mechanic/projectiles-active-reload/",
      "accessed": "2026-11-02",
      "access_method": "page-text"
    }
  ]
}
---

## 摘要

「把等待装填的时间，变成一次可以争取额外收益的小判断。」
出處：`sources/text/projectiles-active-reload.json` 字元 198-224 `summary.zh`
顯示：把等待裝填的時間，變成一次可以爭取額外收益的小判斷。

## 規則

「装填开始后，指针经过一个可见的成功区。玩家可在窗口内再次按键，缩短等待或强化下一轮射击；错过时按普通装填完成，或承受事先说明的惩罚。玩家要在看进度条和观察战场之间分配注意力。」
出處：`sources/text/projectiles-active-reload.json` 字元 340-427 `rules.zh`
顯示：裝填開始後，指針經過一個可見的成功區。玩家可在窗口內再次按鍵，縮短等待或強化下一輪射擊；錯過時按普通裝填完成，或承受事先說明的懲罰。玩家要在看進度條和觀察戰場之間分配注意力。

## 核心循環

「选择开始装填的空当」
出處：`sources/text/projectiles-active-reload.json` 字元 725-734 `loop[0].zh`
顯示：選擇開始裝填的空當

「跟随进度条找窗口」
出處：`sources/text/projectiles-active-reload.json` 字元 808-816 `loop[1].zh`
顯示：跟隨進度條找窗口

「再次按键争取奖励」
出處：`sources/text/projectiles-active-reload.json` 字元 884-892 `loop[2].zh`
顯示：再次按鍵爭取獎勵

「利用新弹匣继续行动」
出處：`sources/text/projectiles-active-reload.json` 字元 962-971 `loop[3].zh`
顯示：利用新彈匣繼續行動

## 玩家取捨

「周围安全时争取强化，还是在被追赶时把注意力全留给走位？」
出處：`sources/text/projectiles-active-reload.json` 字元 1070-1097 `decisions[0].zh`
顯示：周圍安全時爭取強化，還是在被追趕時把注意力全留給走位？

「提前装填以准备下一次交战，是否会浪费剩余弹药或当前攻击机会？」
出處：`sources/text/projectiles-active-reload.json` 字元 1216-1246 `decisions[1].zh`
顯示：提前裝填以準備下一次交戰，是否會浪費剩餘彈藥或當前攻擊機會？

## 可調參數

「成功区宽度」
出處：`sources/text/projectiles-active-reload.json` 字元 1409-1414 `parameters[0].name.zh`
顯示：成功區寬度

「宽窗口易学；窄窗口更强调熟练，但要有清楚的音画提示。」
出處：`sources/text/projectiles-active-reload.json` 字元 1496-1522 `parameters[0].effect.zh`
顯示：寬窗口易學；窄窗口更強調熟練，但要有清楚的音畫提示。

「失败后果」
出處：`sources/text/projectiles-active-reload.json` 字元 1694-1698 `parameters[1].name.zh`
顯示：失敗後果

「只失去奖励适合初学者；延长停顿会让冒险装填更紧张。」
出處：`sources/text/projectiles-active-reload.json` 字元 1776-1801 `parameters[1].effect.zh`
顯示：只失去獎勵適合初學者；延長停頓會讓冒險裝填更緊張。

## 原型

「先做一把武器、一个装填条和一个成功奖励，不做随机卡壳。」
出處：`sources/text/projectiles-active-reload.json` 字元 3250-3277 `prototype.firstStep.zh`
顯示：先做一把武器、一個裝填條和一個成功獎勵，不做隨機卡殼。

「玩家能否说明自己为何成功或失败，并在压力下决定放弃奖励？」
出處：`sources/text/projectiles-active-reload.json` 字元 3584-3612 `prototype.test.zh`
顯示：玩家能否說明自己爲何成功或失敗，並在壓力下決定放棄獎勵？

「成功区若与动画或输入延迟不一致，会让玩家觉得判定不可信。」
出處：`sources/text/projectiles-active-reload.json` 字元 3414-3442 `prototype.pitfall.zh`
顯示：成功區若與動畫或輸入延遲不一致，會讓玩家覺得判定不可信。

## 相關模式

- [蓄力後釋放](projectiles-charged-release.md)
- [擦彈獎勵](projectiles-graze-reward.md)
- [熱度節奏](projectiles-heat-pacing.md)
- [停火以收回彈道散布](projectiles-spread-recovery.md)

## 參考來源

- [Press again inside the reload window — Gameplay Atlas](https://gameplayatlas.loopyhop.com/mechanic/projectiles-active-reload/) — 查閱：2026-11-02；取得方式：page-text。
