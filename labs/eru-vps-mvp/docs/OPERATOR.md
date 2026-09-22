# Controller B 操作器

入口：[scripts/labctl.py](../scripts/labctl.py)。目前提供實際可執行的 plan、execute、status、reconcile；execute 支援 nginx smoke、同版本 reapply、依原 smoke evidence 精確清理。`rebuild-node` 只能產生計畫，沒有 OS 重灌或下線節點的執行入口。

最新本機進度與健康诊斷命令見 [接續紀錄](M2-CONTINUATION-2026-09-22.md)。重裝底層與原型已加入測試，但 rebuild execute 繼續阻擋，尚未進行實機元件重裝。

## 使用方式

在 B 的專案根執行：

```bash
cd /home/ckc/test/newclear/labs/eru-vps-mvp
python3 scripts/labctl.py plan --operation smoke --node worker-4
```

plan 會透過四個 `ckc-disposable-*` aliases 讀取主機／runtime／Eru 狀態，另做 etcd 健康檢查。輸出實際受影響主機、步驟、blockers、計畫 ID、SHA256 及私有計畫檔位置。不會建立／刪除 workload 或重灌主機；會在 B 寫入私有計畫及觀測紀錄。

審閱計畫後，把輸出的 ID 與 hash 帶入：

```bash
python3 scripts/labctl.py execute --plan PLAN_ID --sha256 PLAN_SHA256
python3 scripts/labctl.py status
python3 scripts/labctl.py status --run PLAN_ID
```

同一 plan 只能嘗試執行一次；成功或失敗都不能直接重播。plan hash 是內容與範圍的綁定，不是使用者授權的替代品。新版本、inventory、generation、主機身分、runtime 或 workload 清單改變時，必須重新 plan。

reapply 計畫：

```bash
python3 scripts/labctl.py plan --operation reapply
```

此操作影響四台，執行已驗證的 worker-2 nginx canary + `deploy-lab.py --apply` 流程，核對容器、HTTP、pod／node、配額和服務重啟紀錄後清理。它是同版本部署驗證，不是宣告式應用 desired-state controller，也不會升級 OS。

依既有 smoke run 清理：

```bash
python3 scripts/labctl.py plan --operation cleanup --smoke-run SMOKE_RUN_ID
```

SMOKE_RUN_ID 是 `private/smoke/*.json` 的 run ID，不是外層 plan ID。操作器從該紀錄取得唯一 appname／node，再和 live workload 的 owner、run、node labels 對照，將精確 ID 清單固定在計畫中。建立成功但回覆遺失、原 evidence 沒來得及記住 ID 的情況，可透過唯一 appname + labels 找回；不是依名稱前綴直接刪除。來源 evidence 改變、出現陌生 owner 或新 workload 都會停止。每次 remove 前再核對一次；runtime／metadata 不一致或空節點仍占配額時不執行清理。

不提供全群 workload reset、盲目 `resource --fix`、刪 namespace 或刪 containerd data 的捷徑。

## 失敗後對帳

```bash
python3 scripts/labctl.py reconcile --run PLAN_ID
```

reconcile 只讀遠端，不重播部署、不自動清理。若原控制程序中斷而 journal 停在 running，取得鎖後會標成 interrupted，保留 failed_at 與目前觀測。SSH 無法連線時亦保存部分命令紀錄與 error，不把無法讀取當成空集合。

先檢查私有 run log、smoke evidence、runtime 與配額，再建立新的計畫處理明確範圍。timeout 代表結果不確定，不能以 timeout 直接推論遠端沒執行。

## 鎖、紀錄與適用邊界

- `private/controller.lock` 使用 flock，計畫／執行／reconcile 與直接呼叫的 deploy／smoke 腳本共用。子程序繼承同一 FD；父程序離開後，仍執行中的合作子程序會繼續持鎖。不要刪除 lock file 來解鎖。
- 這是 B 同一 checkout 的合作鎖；不能阻止 controller A、其他 checkout 或直接執行 eru-cli 的操作者。多 controller 協作鎖尚未實作，操作期間應維持 B 為唯一 mutation writer。
- `private/operations/cluster.json` 採納現有 basic 叢集為 generation 1；沒有建立新叢集。generation 不可當作已完成重灌的證明。
- 計畫固定 inventory、artifact/source files 的 SHA256、SSH effective config／trusted host keys、machine ID／boot ID、角色與現有工作負載。Git HEAD 另記為來源參考；未提交腳本以內容 hash 綁定。
- `plans/` 放不可直接重播的計畫；`runs/` 放每階段 journal 與子程序 log；`observations/` 放 plan／reconcile 的私有證據。JSON 以同目錄暫存檔、fsync、atomic replace 寫入，權限 0600。
- 執行前再次檢查 etcd 健康、runtime／metadata IDs、空節點配額與 node availability。檢查是當下的觀測，不能保證下一秒不發生磁碟延遲或網路故障。
- 仍依賴本機 `private/preflight`、已驗證 host public keys 及既有 Debian 環境，尚非新 controller／新 OS 的 bootstrap 工具。

## worker-4 重建計畫

```bash
# 日常預設：我們自己的元件清理重裝；保留 OS 和共享 runtime。
python3 scripts/labctl.py plan --operation rebuild-node --node worker-4
# 後備：人工 provider 控制台重灌，不要求 API。
python3 scripts/labctl.py plan --operation rebuild-node --node worker-4 --mode provider-reimage
```

預設 `component-reinstall` 模式會額外在 worker-4 唯讀核對 ownership、SHA256、symlink／hardlink／mount 邊界，列出六個專用檔案、三個本機狀態根與保留項目。第一版只接受空 worker-4；不自動搬移應用、不重建 core／etcd。兩種模式現階段都 `executable: false`，清理／worker-only 安裝／恢復執行器仍待實作。

日常路徑不需要供應商或重灌工具資訊。只有啟用後備 OS 重灌時才需確認 provider 主機身分、OS image、磁碟／volume 範圍、新 host key 與 OneVPS bootstrap。詳細語意、範圍及验收見 [自控重裝](CONTROLLED-REINSTALL.md)。

## 驗證

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
```

測試使用暫存目錄和假的遠端介面，覆蓋跨程序互斥、子程序持鎖、檔案權限、漂移拒絕、精確清理、不確定結果與禁止重播；不會刪遠端容器。實機結果與已遇到的 etcd 故障見 [開發紀錄](M2-2026-09-22.md)。
