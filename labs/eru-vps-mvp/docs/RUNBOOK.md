# 操作手冊：Eru VPS MVP

現有四台已走 Debian／OneVPS 適配路徑，見 [部署結果](DEPLOYMENT-RESULT-2026-09-22.md)。下方第 1 節起保留最初 Ubuntu／空白主機的設計，**不可直接對現有四台執行原版 make up**。單 worker 人工 console reimage 的本機 stages 已有 fake-fixture 前置，全群 fresh 只有不可執行 review planner；provider／VPS 實機驗收、全群 executor 與 etcd restore overlay 仍未完成。

## 現有 Debian 叢集：從 controller B 操作

SSH 入口 `~/.ssh/config` 匯入 `~/.ssh/hzd-vps/config`。使用 `ckc-disposable-01`～`04`，不是替換原 g1ops 帳號；B 管理與收集結果，01 承載 etcd／core，02–04 承載 worker。安裝腳本不修改既有 sshd／sudoers／Docker／containerd 配置。

```bash
cd /home/ckc/test/newclear/labs/eru-vps-mvp
python3 scripts/deploy-lab.py
python3 scripts/smoke-lab.py
# 僅驗證其中一台：
python3 scripts/smoke-lab.py --node worker-2
```

`deploy-lab.py` 預設只渲染私有 plan；`--apply` 才安裝。首次 apply 已完成。`smoke-lab.py` 會建立唯一 app、測試 nginx HTTP／lifecycle／超額資源拒絕，最後只刪除此 run 的 workload 並核對資源回收。它會改變測試容器狀態；不是唯讀 health check。正常成功後保留下載的 images 與 ERU 服務。異常中止須按私有 evidence 中的 app／workload ID 檢查殘留。

目前部署工具需要 `private/preflight/`、`private/verified-host-public-keys.json` 與可信的 B SSH host keys。後者是在已認證的 admin SSH 上讀取 worker 的各類 host public keys，並比對現有 Ed25519 anchor 後產生；不是未驗證的 keyscan，也不含私鑰。重灌後必須重新驗證新 host keys 與位址，不能照抄舊資料。

下列 V05 命令已在 owner 再次批准後執行，2026-09-22 通過：

```bash
python3 scripts/smoke-lab.py --node worker-2 --verify-reapply
```

此選項先建立 worker-2 nginx，然後在四台重跑現有 `deploy-lab.py --apply`，檢查相同 workload ID／runtime PID 與 HTTP，並比對 pod／node／容量及四台服務的 MainPID、InvocationID、啟動時間、NRestarts，最後完成 stop／start／清理。本次全部通過，沒有重置 etcd 或重灌 OS。安裝器會執行 root 檔案核對、systemd daemon-reload／enable 及權限與服務設定的安裝邏輯；本次已取得明確批准。HTTP 僅在重跑前後取樣，不宣稱已測得連續零中斷。

新的 [操作器](OPERATOR.md) 已提供 B 本機執行鎖、hash-bound plan、journal 與唯讀 reconcile。現有安裝器以 owner manifest 拒絕覆寫外部檔案；發生中斷時可能需要檢查 manifest／檔案差異後修復，不能保證自動恢復。它仍沒有 config 變更後重啟服務的完整收斂邏輯、跨 controller 鎖、回復或 provider reimage；不能宣稱通用重裝管理已完成。

## 1. 首次部署前

1. 確認四台是可供實驗的 Ubuntu 主機，盤點既有服務／磁碟。依 [SDD](SDD.md) 建好管理私網及 firewall，runner 位於同一私網。
2. 準備 root key SSH；若用 sudo 帳號執行 Ansible，也要允許 core 以 key 登入 worker 的 root。透過 provider console 或可信的 provisioning 結果核對 host key；`ssh-keyscan` 本身不提供身分驗證，不用全域關閉 StrictHostKeyChecking。
3. 固定 Ubuntu image、Python／Ansible 版本、binary checksum、nginx digest。當前 lock 只固定研究來源，實際下載可取得性／相容性待 M0。
4. 檢查磁碟、cgroup、sshd socket forwarding、DNS、時間同步、GitHub／registry 出站。非 x86_64／aarch64 不在範例支持範圍。
5. 操作電腦與備份儲存在叢集外；private inventory 權限為 0600，建立 cluster ID 與 generation。etcd token 每次 fresh generation 更新。

## 2. 用固定 quickstart 建 Profile A

以下在操作電腦執行；`/path/to/...` 全部替換成實際本機路徑。**先完成 private inventory 與網路前置條件，再執行最後一行 `make up`。** 確認使用的 Ansible 版本已寫入私有部署鎖檔。

```bash
export ERU_PROJECT=/path/to/newclear/labs/eru-vps-mvp
export ERU_UPSTREAM=/path/to/private-work/quickstart
export ERU_INVENTORY=/path/to/private-work/inventory.yml

git clone https://github.com/projecteru2/quickstart.git "$ERU_UPSTREAM"
git -C "$ERU_UPSTREAM" checkout --detach 023412becd4202b5b8c5d992552310512a2d6790
cp "$ERU_PROJECT/examples/inventory.basic.yml" "$ERU_INVENTORY"
chmod 600 "$ERU_INVENTORY"
# 編輯 ERU_INVENTORY：真實私網位址、主機角色、容量與 generation token。
# 編輯後另存版本／inventory hash；不可把範例位址直接用於真實部署。
ansible-inventory -i "$ERU_INVENTORY" --graph
ansible all -i "$ERU_INVENTORY" -m ansible.builtin.ping
make -C "$ERU_UPSTREAM" check INVENTORY="$ERU_INVENTORY"
make -C "$ERU_UPSTREAM" up INVENTORY="$ERU_INVENTORY"
```

`make check` 是 syntax check；`ping` 是 Ansible 模組執行檢查，兩者不代表服務部署成功。上游 `make lint` 另需 ansible-lint。Ansible check mode 不能完整模擬 download、command 與 delegate registration 的結果。

範例以 private IP 作 inventory key，因上游把 inventory hostname 寫入 etcd peers、core endpoints。若只改 `ansible_host` 卻保留不可解析的 alias，Ansible 可能通而服務彼此不通。

將固定 commit 的 `verify.sh` 和本專案 nginx spec 複製至 core 的操作目錄，再在 core 上執行。不要未固定版本就從 master 再下載一份腳本。

```bash
export ERU=127.0.0.1:5001
export ERU_IMAGE='nginx@sha256:REPLACE_WITH_VERIFIED_DIGEST'
# 先把 ERU_IMAGE 換成已解析、核對架構的 digest。
eru-cli pod nodes --filter up eru
eru-cli node resource worker-2
./verify.sh worker-2
./verify.sh worker-3
./verify.sh worker-4
```

core 不是 worker，所以不能省略 verify.sh 的 node 參數；預設 hostname 不會命中節點。`ERU_IMAGE` 是 verify.sh 讀取的變數。上游腳本只會自動清臨時 spec，失敗後可能留下 nginx workload；先列出本次 workload ID，檢查後逐筆移除，不能讓下一次測試把殘留當成成功。

## 3. 部署、HTTP 與清理

以下在 core 操作，`nginx.yaml` 指向已複製的 [範例](../examples/nginx.yaml)。

```bash
eru-cli workload deploy \
  --pod eru --node worker-2 --entry web --image "$ERU_IMAGE" \
  --network eru --count 1 --cpu 1 --memory 256M --storage 1G \
  ./nginx.yaml
eru-cli workload list eru-mvp-nginx
```

從部署結果取得本次 ID，再逐筆操作。`ERU_WORKLOAD_ID` 必須是此次建立的精確 ID；不要以模糊 grep 全群輸出作批次刪除。

```bash
export ERU_WORKLOAD_ID=REPLACE_WITH_CREATED_ID
eru-cli workload get "$ERU_WORKLOAD_ID"
eru-cli workload exec "$ERU_WORKLOAD_ID" -- nginx -v
eru-cli workload logs --tail 20 "$ERU_WORKLOAD_ID"
eru-cli workload stop "$ERU_WORKLOAD_ID"
eru-cli workload start "$ERU_WORKLOAD_ID"
```

從 `get` 取 CNI IP，SSH 到 worker-2，執行 `curl --fail --max-time 5 http://<container-ip>/` 並保存 200 response。這一步補足 verify.sh 沒有 HTTP 驗證的缺口。bridge IP 不能直接假設由 runner 跨機存取。

```bash
eru-cli workload remove --force "$ERU_WORKLOAD_ID"
eru-cli node resource worker-2
```

清理後，確認 worker-2 的 host TCP 80 無衝突，將 deploy 的 `--network eru` 換為 `--network host` 重跑一次，再從管理私網 `curl --fail --max-time 5 http://10.77.0.12/`（換成實際私網 IP）。測完以新的 ID 清理。此模式不使用 container bridge IP；firewall 必須避免 demo 同時暴露到公網。

若要測多節點，先分別指定 worker-2／3／4 各部署一次並記錄 ID。`--count 3` 的預設 AUTO 策略不是「每台一個」保證。第二階段再評估策略旗標。

## 4. 計畫性單 worker OS 重裝（後備）

日常改走 [自控元件清理重裝](CONTROLLED-REINSTALL.md)，不需要 provider API。以下保留真正 OS 重灌的後備流程，由 owner 在 provider 控制台操作；它不是日常元件重裝腳本。

Profile A 優先選 worker-4。Profile B 中 worker-2／3 兼任 etcd，不能直接套此流程。每次只處理一台。ERU-014 的 [重灌前摘除器](M3-REIMAGE-PREPARE-2026-09-26.md) 目前只經 fake operator 驗證；實機使用須等本機開發完成並另行驗收。

1. 在 B 的私有 `labctl` plan 綁定 owner-reviewed provider intent、machine ID、provider ID、OS image、generation、精確 volumes 與 workload 狀態；檢查準備 blockers、替代容量與可恢復資料。取得 cluster mutation lock。
2. 在 core 執行 `eru-cli node down worker-4`，再 `eru-cli node get worker-4` 確認 Bypass。這不是 drain，既有 workload 還在。
3. `eru-cli node workloads worker-4` 列出實際 workload。在健康 worker 依原 spec／digest 部署替代實例，HTTP 通過後切換 caller／proxy。無外部路由的 smoke 可直接停止。
4. 逐筆移除舊 workload，確認列表為空。在 worker-4 停止 `eru-agent`，避免移除註冊期間持續回報；在 core 執行 `eru-cli node remove worker-4`。此 API 拒絕移除非空 node，並清理 resource manager 的 node 狀態。
5. 依 provider ID 重灌 Ubuntu。只有專案指定磁碟可以清除；不能把 SSH 不通當成已經重灌成功。
6. bootstrap 私網／firewall／SSH，依可信 provider 資訊核對新 host fingerprint，更新 private known_hosts 與 generation。保留相同 Eru node 名稱，但先確認舊紀錄確實不存在。
7. 重跑 node role。使用完整 inventory，保留 delegate 的 core 主機；可用以下命令把執行範圍限制在 node role 的 core 與目標 worker。core 不在 node group，因此不會安裝 worker role。

```bash
ansible-playbook -i "$ERU_INVENTORY" "$ERU_UPSTREAM/cluster.yml" \
  --tags node_containerd --limit '10.77.0.11,10.77.0.14'
```

8. 位址須換成實際 inventory host key。core 的既有 key 必須可讀；本命令不做 OS reimage，也不修復 etcd。重新註冊後 agent 應啟動，確認 node 狀態／endpoint／capacity／labels。受影響 node 在驗收前不要交給其他 deploy writer。
9. 跑該 node 的 verify 與 HTTP，確認健康後才恢復應用部署、釋放 lock。若保留的既有 node 仍處於 Bypass，核對後用 `eru-cli node up worker-4` 開放排程。

重灌失敗停在 `failed_at=reimage`；新 node smoke 失敗停在 `failed_at=verify`。都不繼續重裝其他節點。已重灌 OS 的回滾需要再次從已知版本重建，不宣稱能復原舊 runtime。

## 5. 非計畫失聯

先確認不是短暫網路分割，並從 provider 停機或網路層 fence 原主機，記錄證據。只停止 agent 不算 fence 工作負載。

確認舊 runtime 不會復活後，針對該節點的已核對 workload ID 使用 `eru-cli workload dissociate <id>` 清除無法正常 remove 的 metadata，再移除空 node、重建替代機並部署。dissociate 不會停止／刪除遠端容器，因此不能在舊主機可能繼續寫資料時使用。健康節點上的 workload 一律不套用此操作。

本機 `labctl plan-worker-loss` 可先把 detection、外部 fence proof digest、exact stale IDs／quota 與 replacement destinations 固定成不可執行的 review plan；另有不連 target SSH 的 `prepare-worker-loss`、單次 exact dissociation executor、唯讀 recovery、partial run 的 fresh exact-ID subset cleanup，以及重新驗證原 private specs 後依序執行 ERU-012 的 replacement wrapper，見 [ERU-010 前置](M3-WORKER-LOSS-PREP-2026-09-27.md)。所有 mutation 都需要新的 hash-bound plan/journal；不重播舊 cleanup、child 或 wrapper plan。replacement 必須在 stale IDs 全 absent、quota zero、fence／健康 workers／雙 snapshot 穩定後才建立，且全部 exact replicas 與 HTTP-ready 才完成。本 slice 不做 provider fence 驗證、quota repair、lost node remove 或 target resume。這些路徑目前只有 fake fixture 驗證，尚未執行 VPS 演練；不得把本機程式或 review plan 當成 V07 已通過。

## 6. 全群 fresh 重建：推薦 MVP 主路徑

先在 B 本機依 [ERU-015 review-plan 契約](M3-FRESH-REBUILD-PREP-2026-09-27.md) 建立並審閱私有 plan：

```bash
python3 scripts/labctl.py plan-fresh-rebuild \
  --input private/fresh-rebuild-intents/ITERATION.json \
  --plan-id FRESH_REVIEW_ID
```

只可核對公開 summary 的 `fresh`、`G → G+1`、iteration、四台／磁碟／app 計數、decision 與 hash，再到 private record 審閱精確 provider／volume／host／spec 範圍。這個命令不連 VPS、不停止 writer、不重灌、不建立 etcd、不重播 app、不更新 generation；本版也沒有對應 executor。未另行完成 destructive executor／recovery 審閱及明確操作授權前，停在 review plan，不執行下列人工流程。

1. 外部保存 run plan、Git／image digest、private inventory、keys、provider IDs、上次驗收。確認沒有不可丟棄的本機資料；需保留的 app data 另行備份。
2. 停止 deploy writer／定時任務，停止或 fence 舊 workloads。列出將移除的 4 台與磁碟，進入本次 fresh generation。
3. 透過 provider 重灌指定 OS；確認附加 volume 沒有意外帶回舊 etcd／runtime 資料。重建 SSH／私網／firewall；每個 host key 重新核對。
4. 選 Profile A 或 B 的 private inventory，指定新 token；etcd 從空目錄建立。同一個 fresh 操作不得混入 snapshot restore。
5. 固定 upstream checkout → `make check` → `make up` → 逐 node verify → 重播 app spec／digest → HTTP。
6. 核對 node 數、pod、endpoint、資源總量、plugin 帳目與 workload ID 清單。不以容器 ID 相同為目標，服務行為與資源配置相同即可。
7. 連續 3 次重建，各自保留 generation、總時間／安裝時間、異常與人工介入次數。中途手改主機的修復必須回寫 automation，再從空環境重跑才算通過。

## 7. 備份與控制面還原

### 7.1 快照工具與一致性

上游 etcd role 安裝 `etcd` 與 `etcdctl`，**沒有把 `etcdutl` 複製到 PATH**。本案 M3 overlay 必須從相同且已驗 checksum 的 etcd release 安裝 `etcdutl`；完成前不可把 restore 標為可執行功能。

etcd 3.6 用 `etcdctl snapshot save` 取快照，以 `etcdutl snapshot status` 檢查及 `etcdutl snapshot restore` 還原。單份完整快照供新叢集所有成員還原；需新 member／cluster 身分與共同設定。不要用舊式 `etcdctl snapshot restore`。[etcd 3.6 recovery](https://etcd.io/docs/v3.6/op-guide/recovery/)

以下為工具安裝完成後的備份命令範例，在可達私網 etcd 的授權操作端執行，path 位於私有備份目錄：

```bash
export ERU_BACKUP=/path/to/private-backups/run-id
install -d -m 700 "$ERU_BACKUP"
etcdctl --endpoints=http://10.77.0.11:2379 snapshot save "$ERU_BACKUP/snapshot.db"
etcdutl snapshot status "$ERU_BACKUP/snapshot.db" -w table
sha256sum "$ERU_BACKUP/snapshot.db"
```

確認備份已加密上傳到叢集外、可下載解密並核對 hash，再算成功。加密方式／儲存服務於 M0 選定。不要把備份只留在 core。

V10 先停止應用管理 mutation，待 in-flight deploy 完成，停止 core（及其發起的 plugin 呼叫），worker runtime 保留；agent 寫入暫不可用。此時取快照並保存 node／workload 清單、版本與 core key 的加密備份。一般每 15 分鐘的線上快照是另一種備份，其 in-flight／revision 恢復行為須另驗。

### 7.2 本機 restore-control review plan

已具備的 ERU-016 入口只審查既有外部 snapshot evidence，不擷取或還原 snapshot：

```bash
python3 scripts/labctl.py plan-control-restore \
  --input private/restore-control-intents/ITERATION.json \
  --plan-id RESTORE_REVIEW_ID
```

輸入必須固定現行 inventory／cluster record／controller report、來源 generation snapshot、`private/control-metadata-snapshots/` 下的 regular `.db` bytes 與串流 SHA256、獨立 status JSON、外部加密 catalog receipt、相同已鎖定 v3.6 release 的 `etcd`／`etcdctl`／`etcdutl` digests、writer quiescence、舊控制面隔離、Profile A core host 上的新 token／data-dir membership、依 snapshot revision／write rate／restore window 算出的 revision bump、涵蓋 core／agent／plugins 的完整 restart set、三台 workers 的 exact node/workload/runtime/plugin records、core key availability／revoke set、evidence store 及候選 RPO 900 秒／RTO 1800 秒。snapshot/status/source、catalog、toolchain 與 available core-key record 必須另由 `control-restore-trust.json` allowlist，且檔案 bytes 必須和目前 Git HEAD 相同；預設空清單不信任任何真實備份。copied DB、prefix export、fresh mode、應用 volume claim、舊 token／data-dir、Profile B membership、path escape／任何 descendant symlink、duplicate JSON、hash／generation／tool drift 均 fail closed。外部 prerequisite 明確為 false 時只保存 `decision: blocked`。

stdout 只有 plan/status/count/digest 與相對 private path，不列 endpoint、host/member identity、token、data-dir、workload ID、raw status 或 spec。plan 永久不可執行；沒有 `execute-control-restore`，generic `execute` 也不能消費它。本入口不呼叫 `etcdutl`，status record 是預先取得且 hash-bound 的證據，不是 planner 自行重跑的驗證。實際 snapshot capture／restore、old-control isolation、服務啟停、worker reconciliation、HTTP、generation commit 與 RPO／RTO 計時仍未執行。詳見 [本機前置](M3-CONTROL-RESTORE-PREP-2026-09-27.md)。

### 7.3 restore-control 實機設計流程（尚未實作）

1. 隔離舊控制面，保留 worker runtime；確認沒有另一組 core 繼續寫入。若 workers 也全消失，改採 fresh + app replay。
2. 從外部下載同一份完整快照，核對 SHA256／snapshot status。不能只還原 `/eru` 而遺漏 plugin prefix。
3. 使用 `etcdutl snapshot restore` 在每個新成員建立新的 data-dir；依計畫明確提供 name、initial-cluster、peer URL、token。評估已知 watch consumer 的 revision bump／mark-compacted，並重啟客戶端使快取失效。
4. 先寫好恢復後的 systemd／etcd 設定，再啟動 members；檢查 member list、endpoint health／status、quorum。**不能先 `make up` 啟動空 etcd，再覆蓋 live data-dir。**
5. quickstart 缺少 restore 模式，M3 overlay 必須把 binary install、restore、config、launch 拆開；此階段不得讓預設模板把恢復設定覆蓋掉。
6. 還原 core 私鑰，或輪換到新公鑰並授權到每一 worker，撤銷舊 key；更新 inventory 與 core／plugin etcd endpoints。啟動 core，再恢復 agents。
7. 對帳 snapshot 中的 node／workload 與每個 worker runtime、plugin 配額；保留差異證據，清除或重建經確認的 stale records。HTTP 與資源檢查通過後才恢復 mutation writer。

### 7.4 尚有 quorum 的 etcd 單成員替換

依 [etcd runtime reconfiguration](https://etcd.io/docs/v3.6/op-guide/runtime-configuration/) 先確認健康 quorum，隔離故障成員並移除其 member ID；新主機以 learner 加入，用回傳 membership 與 `initial-cluster-state: existing` 啟動，追上後 promote，檢查健康再做下一個變更。新主機不可攜帶已移除 member 的舊 data-dir。若 quorum 已失去，停止此流程，走完整 snapshot restore。

上游模板固定 `initial-cluster-state: new`；本案需要 membership overlay／受控 fork 才能自動做這段。Profile A → B 的初期路徑仍選 fresh rebuild。
