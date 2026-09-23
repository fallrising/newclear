# ERU-011：新 controller 接手的本機前置檢查

更新：2026-09-23。**ERU-011 進行中**。本輪交付 `scripts/controller_preflight.py`，只讀 B 本機檔案與 `ssh -G` 配置，不登入或修改 VPS。它把檢查結果存到 `private/controller-preflight/`，stdout 只輸出 blocker 與私有報告相對路徑，不列印 inventory、IP、keys 或原始 evidence。`ready_for_review` 表示接手資料可供下一步審閱，**不是**乾淨 OS 的 bootstrap 或 live 部署驗收。

檢查包含：目前專案 Git commit／是否乾淨、controller 的 OS／架構、Python／OpenSSH／Git 及其 OS package 版本；六份 `linux/amd64` release 的 tag／SHA256、upstream lock、core patch bytes 和已驗證 core binary；外部私有的四台部署 plan、worker 公鑰核對檔、三份操作器狀態及 plans/runs 目錄、四台舊 preflight 記錄；四個 `ckc-disposable-*` alias 的本機 `ckc` principal、目標解析與已信任的 host key 檔。它只檢查舊 preflight 是否存在，不把舊的遠端健康結果當成現在健康。

本台 B 於 2026-09-23 的本機記錄：Ubuntu 24.04.1 LTS x86_64，Python 3.12.3（package `3.12.3-0ubuntu2.1`）、OpenSSH 9.6p1（`1:9.6p1-3ubuntu13.19`）、Git 2.43.0（`1:2.43.0-1ubuntu7.3`）。固定 release 為 core／CLI／resource-extend v0.1.5、agent v0.1.3、etcd v3.6.14、CNI plugins v1.9.1；完整 SHA 在 [artifact lock](../artifacts.amd64.lock.json)。目前外部私有輸入、patch 與本機 alias 檢查均符合；開發工作樹尚未提交時，報告 `20260923T180455Z-ed799989` 僅因 source dirty 而拒絕 `ready_for_review`。提交合併後須重跑，不能引用這份開發中結果當成功。

在新 B 接手既有叢集時，先從可信管道安放同一版本的外部 `private/` 資料，以及 SSH config／known_hosts／key；不可把它們提交 Git。下載相同 Git revision 後執行：

```bash
# [新 B 本機] 只查本機；缺少 private/ 時只顯示 blocker，不建立替代 inventory。
cd labs/eru-vps-mvp
python3 scripts/controller_preflight.py
# [新 B → ckc-disposable-01～04] 前一步可審閱後，重新收集當下遠端唯讀盤點。
python3 scripts/preflight.py --output-dir private/preflight
python3 scripts/labctl.py status
```

接著按 [交接](HANDOFF.md) 查目前 soak／journal、etcd、workloads、配額及服務身分，建立**新** plan／hash；舊失敗 plan 不重播。乾淨 controller／OS 的實際引導、外部私有資料搬運驗證和四台受控 bootstrap 尚未完成，ERU-011 不能關閉。OS 重灌屬 ERU-014／015，與日常元件重裝分開。
