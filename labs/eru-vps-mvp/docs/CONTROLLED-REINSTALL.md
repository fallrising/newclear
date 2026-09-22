# 自控清理重裝：日常路徑與最後手段

依 owner 的操作習慣，日常以我們的腳本清理／重裝 ERU；只有 OS 或主機狀態已無法可信恢復時，才由 owner 在 provider 控制台重裝。**不需要先接供應商 API。**

更新：quarantine／六檔安裝／checksum 恢復底層及狀態機原型已完成本機測試；尚未接線至 live execute，沒有在 VPS 停服務或清理元件。62 項測試與控制面阻擋詳見 [接續紀錄](M2-CONTINUATION-2026-09-22.md)。以下執行契約仍需實機驗收。控制面先前的 etcd 延遲／core panic 仍須驗證修復；一次 health 通過不足以解除這個問題。

## 分清四種操作

| 操作 | 清理範圍 | 保留 | 驗證意義 |
| --- | --- | --- | --- |
| 應用清理／重播 | 某一 smoke run 的精確 workload IDs | OS、元件、etcd、其他 app | 應用生命週期 |
| worker 元件重裝（預設） | 指定 worker 的 ERU 專用檔案與本機狀態 | OS、SSH、Tailscale、既有 runtime、控制面與 node 身分 | 在相同 OS 上重建 ERU 元件 |
| provider 控制台重灌（後備） | 人工確認的主機 OS／磁碟 | B 的 plan、journal、外部備份 | 乾淨 OS bootstrap 與主機替換 |
| 全群 fresh | 另行審閱的四台及全新控制 metadata | 外部版本、keys、備份、紀錄 | 原 SDD 的三次乾淨全群重建 |

元件重裝會保留 caches、packages、kernel、共享 runtime 及其他系統狀態，不能拿它冒充全新 OS 驗收。

## worker-4 的具體範圍

第一版要求 worker-4 沒有 workload、runtime container／task 或殘留配額；不自動搬移業務應用。01 僅負責禁止／恢復該節點排程與驗證，02／03 不做安裝或清理。

計画中的六個重裝檔案：

- `/usr/local/bin/eru-agent`
- `/etc/eru/agent.yaml`
- `/etc/cni/net.d/10-eru.conflist`
- `/etc/systemd/system/eru-agent.service`
- `/etc/systemd/system/eru-containerd-proxy.service`
- `/etc/systemd/system/eru-containerd-proxy.socket`

三個候選本機狀態根目錄：`/var/lib/eru-agent`、`/run/eru/workloads`、`/var/lib/cni/networks/eru`。不存在的路徑明確記錄為 absent。agent 運行期間 journal cursor 會變動，因此正式執行器需在停服務後重新審核並計算備份 checksum；目前列出的內容不是一致性備份。

保留 SSH／authorized_keys／core 專用公鑰與 forced-command helper、Tailscale、Docker／containerd binaries／units／socket／data roots、moby namespace、image cache／snapshots、共享 `/opt/cni/bin/*`、`eru0` bridge、etcd 與 plugin metadata、既有 node 註冊與容量。PID／Unix socket 應由對應服務停止／啟動處理，不以整個 `/run` 清除代替。

[worker_scope.py](../scripts/worker_scope.py) 唯讀比對 worker ownership manifest、十個既有 owned files 的 SHA256、路徑型態／owner／權限，從中選出六個元件檔案。manifest 出現額外路徑、外部修改、hardlink、symlink、候選資料根或其子項有 mount、未知控制面資料時會阻擋。共享父檔案系統（例如 `/run` tmpfs）不是要清除的 mount，允許正常使用。

實際 worker-4 審核結果：六個檔案皆符合 manifest；agent 狀態為一個 journal cursor，CNI 狀態為 last-reserved IP 與 lock，`/run/eru/workloads` 不存在。完整 hash-bound plan 位於 `private/operations/plans/20260922T122547Z-fc1e697c.json`；只表示當次範圍核對通過，不表示已清理。

## 計畫命令

```bash
python3 scripts/labctl.py plan --operation rebuild-node --node worker-4
# 明確指定相同的預設模式：
python3 scripts/labctl.py plan --operation rebuild-node --node worker-4 --mode component-reinstall
# 最後手段：人工 provider 控制台重灌的計畫：
python3 scripts/labctl.py plan --operation rebuild-node --node worker-4 --mode provider-reimage
```

兩種模式目前都 `executable: false`。`execute` 會拒絕，沒有藏在選項後面的 stop／rm／reimage 指令。

## 執行器要完成的契約

1. 在 B 取得 mutation lock，核對 plan hash／主機身分／角色／健康／空節點／ownership，記錄其他 worker 與共享服務基線。
2. 禁止 worker-4 排程；只停止本台 agent、ERU socket proxy。再讀 metadata／runtime，避免把下線視為自動 drain。
3. 再驗一次檔案及資料樹；先寫 recovery journal，對清單項目做可追蹤 quarantine，保留備份，不立即永久刪除。拒絕未知 mount／link，不全域 `rm -rf`、prune 或 firewall flush。
4. 僅在 worker-4 安裝固定 artifact／配置，重建 agent 與 CNI 本機狀態。不能拿四台 `deploy-lab.py --apply` 當作 worker-only installer。
5. nginx lifecycle／HTTP／資源回收通過，確認其他 workers 和原 Docker／containerd 沒有重啟或變更，才恢復排程；記錄 worker 元件 revision，不增加 OS incarnation 或全群 generation。
6. 每一階段先保存意圖、再保存觀測。中途失敗保留 target 不可排程及 recovery evidence；先對帳，不自動跳過失敗或清理另一台。quarantine 後的恢復必須驗 checksum，不能覆蓋後來產生的新資料。

這些是待實作／驗證的執行契約；現有程式只產生計畫與唯讀 audit。

## 驗收與順序

先完成控制面修補與穩定性驗證，再完成 worker-only installer、quarantine／恢復及上述狀態機。第一輪只跑空的 worker-4；連續三次元件重裝都成功，且其他 worker HTTP／原服務不受影響，才擴大範圍。這組結果另外記錄為「元件重裝」，原 V06／V08 的 OS 重灌與全群 fresh 條件仍未通過。

本輪 34 項本機測試通過，包括既有 21 項操作器測試、新的模式選擇／scope 阻擋及檔案系統邊界測試。VPS 只做了唯讀 audit 與 plan，沒有進行清理或重裝。
