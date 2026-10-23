# mkfk 可用版本資格

RESULT: PASS
Project: systems/mkfk
Tag: usable/mkfk/v0.1.0
Source: fdc534bca955fb30cc21d87b2d849b8c4aa05d77
Startup: 原生三 broker 程序與三 broker Compose demo — passed
Core: leader failover、冪等 producer dedup、rebalance fencing、coordinator restart、short chaos 7 faults 與 full chaos 28 faults 零違例 — passed
Checks: fmt-check、vet、unit、race、model、integration、chaos short/full、demo — passed

範圍：M0–M7 教學 distributed log；不提供 Kafka wire 相容、TLS/auth、retention、動態 membership 或 production hardening。

2026-10-21 候選曾因 CI short chaos 失敗撤回。2026-10-23 重現並定位為 Raft follower catch-up livelock，於 Source 修復；修復後 short chaos 30/30（含失敗 seed 5 次重播）。診斷與實跑證據：[mkfk-livelock-20261023](../evidence/mkfk-livelock-20261023/README.md)。舊的 [2026-10-21 證據](../evidence/newclear-qualification/mkfk-commands.json)保留為歷史。

合併前 PR CI（含新的隨機 seed short chaos）是建立上述 tag 的 gate。
