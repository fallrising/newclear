# Fresh network-access：四機設定與不可覆寫計畫

## 目標與範圍

依 [fresh executor](M3-FRESH-EXECUTOR-DESIGN-2026-10-03.md)、[SDD 網路](SDD.md) 與 [當次前置檢查](M3-FRESH-NETWORK-ADMISSION-2026-10-04.md)，新增四機deterministic設定產生器及immutable private plan。這是network-and-access-ready的設定準備，不是executor或網路驗收；不呼叫SSH/nft、不更新live firewall/trust/inventory、不啟動etcd/core/agent、不變更pending。測試只用synthetic fixtures。

固定Profile A、四機alias/node順序與replacement身份；端點只能從已驗replacement request取得，禁止另填覆蓋。保存私有內容但stdout只有ID/digest/count/status与false flags。此里程碑先提供可重導出、可review的固定payload；durable action intent、實際adapter/dispatch與read-only reconcile仍是後續交付，不能把plan標為stage accepted。

## Request與API

Request精確欄位：`schema_version:1`、`binding`、`admission_request`（canonical private path/raw sha256）、`admission_sha256`、`controller_ip`、`private_interface`、`core_client_key`（canonical private path/raw sha256）。binding與已驗network admission完全相同。core_client_key JSON精確為`{public_key: canonical Ed25519 key}`；禁止options/comment/private-key格式，且不得等於任一replacement host key。只讀公鑰，不讀或產生私鑰，不宣稱私鑰持有已證明。

Controller與四host IP必須canonical IPv4且互異，屬明列10/8、172.16/12、192.168/16或100.64/10；loopback/link-local/multicast/unspecified/public/TEST-NET拒絕。Interface固定只接受tailscale0或wg0；此選擇不安裝、啟動或驗證tunnel。既有replacement collector較寬的IPv4契約不改，本planner限制不回灌到舊功能。

凍結API：`prepare_network_access(project, run_id, execution_sha, input_file, input_sha, plan_id, *, now=None, source_state=None)`；`inspect_network_access(project, plan_id, expected_sha, *, now=None, source_state=None)`。回傳publicsafe dict，成功status `planned`，失敗`blocked`；invalid publicID/SHA可raise。成功含id/sha256/execution_sha256/host_count/file_count及固定stage；stage_accepted/executable/remote_mutation_performed/generation_changed/external_fence_verified全false。

## 固定輸出政策

每host firewall只定義專用`inet eru_fresh_access`的input base chain（priority -20、policy accept），不含flush/delete、forward/output規則或全域ruleset替換。loopback先允許。其餘限定明列private interface、該host目的IPv4與source allowlist，再對TCP管理集合22/80/2375/2376/2379/2380/5001/12345全部drop；因此不符合allowlist的IPv4/IPv6均拒絕，不用established全域放行繞過限制。未列流量維持既有OS政策，不能宣稱完整host firewall。產生器的allow只描述此專用table；其他OS rules仍可能拒絕，不能由渲染結果推論實際可達。

- 22：controller→四機；core→三workers，無其他來源。
- 5001：只在core允許controller及四台已驗private endpoints；worker一律drop。
- 80：只在worker允許controller/core供後續demo驗證；core不開放。
- 2379/2380（Profile A etcd）、2375/2376（runtime TCP API）、12345（agent）：非loopback一律drop。IPv6無管理allowlist。

固定file payload每筆含path/mode/content/sha256：四機 `/etc/eru/fresh-access.nft`；core `/etc/eru/known_hosts`（三worker IP與已核對host key）；worker `/etc/eru/fresh-core-authorized-key` 僅是staged candidate，不是effective AuthorizedKeysFile。所有mode0600，固定path不得由輸入覆寫。Plan另含controller_known_hosts四機IP/key內容，不寫入controller目前trust。

Worker candidate限制為`from="CORE_IP",command="/usr/local/libexec/eru-ssh-command",no-agent-forwarding,no-X11-forwarding,no-pty,no-port-forwarding,no-user-rc KEY`。禁止互動式終端，也不修改sshd/sudoers。forced-command path沿用既有worker契約；既有helper仍可執行可信core送來的特權命令，不是命令allowlist。本輪不安裝helper或將key加入active檔案。未來installer必須另核對helper內容、effective AuthorizedKeysFile、forwarding限制與runtime transport的相容性及before hashes；不可直接當作一般authorized_keys覆寫。

所有files、專用table與配置目錄的ownership／absence、OS工具、tunnel身份及controller/core可達性都必須由未來adapter當下檢查；renderer不將absence或可达性當作已觀測事實。未來執行授權必須另綁exact plan digest，不能只憑prerequisites-reviewed摘要套用。不得因port沒listener而宣稱firewall拒絕已證實。

## Immutable plan與重新驗證

固定區域 `private/operations/fresh-rebuild/network-access-plans/PLAN_ID/plan.json`，先no-clobber claim再發布，fsync/late failure保留claim並盡力加failure marker；不重用ID或覆寫既有bytes。Envelope `{plan:record,sha256:canonical record digest}`；record保存ID/created_at/execution/binding/input refs/admission digest/private identity及完整deterministic render。完成目錄只可有plan.json。

開始與末端都重核當次admission（不是信任cached摘要），outer PrivateFiles pin所有rawrefs/current source/root、精確pending與三個原publication identity/entries；加入新plan目錄的identity/complete檢查。發布後仍需重核時間／evidence，失敗poison而非回成功。Inspect零writes/零transport，重新載入原request、完整重算payload並比對record，即使攻擊者重算envelope SHA也不能改policy/source/hosts。plan不接受future或超過15分鐘；admission原本較早到期時同樣阻擋。歷史preparation不刷新，當次auth/fence/replacement期限全部保持。

## 必要測試與交付

RED→GREEN：四機成功/重導出、OOB keys与source/controller/interface拒絕、IPv6與non-allowlist管理流量drop、精確role policy、不可輸入command/path/options、staged而非active key、無runtime units/remote calls、request/rawrefs/admission drift、pending/root/publication races、sameID不可重用、latefsync failure、末端expiry、rehashed policy forgery、offline no writes、CLI redaction。獨立審查與完整native suite／原workflow／evidence gate通過才交付。nft kernel apply、SSH/tunnel、真實external fence及E2E未做；正式剩餘12不變。

## 凍結紀錄與CLI

Record精確為schema_version/operation/id/run_id/execution_sha256/created_at/binding/input/admission_sha256/private_identity/render；operation固定fresh-network-access-plan。render精確含profile:A、private_interface、controller_ip、controller_known_hosts、hosts。每host保存alias/node/ip/machine_id/boot_id/host_key_sha256/files；file mode使用字串0600。共8份host file payload，controller_known_hosts字串另列不计file_count。

```sh
python3 scripts/labctl.py prepare-fresh-network-access \
  --run RUN --sha256 EXECUTION_SHA \
  --input private/network-access-request.json --input-sha256 REQUEST_RAW_SHA \
  --plan-id PLAN
python3 scripts/labctl.py inspect-fresh-network-access \
  --plan PLAN --sha256 PLAN_SHA
```

兩個CLI都不進入Operator或ClusterLock。prepare只在專用區保存新計畫；inspect完全只讀。公開摘要不包含render、IP、公鑰、host identity、private path或proof。

## 本輪驗證與後續入口

T-234實作與T-235獨立審查已接受，T-236記錄整體PARTIAL。root整合30 tests／35.314秒、worker指定60 tests／32.348秒、獨立79 tests／55.530秒、完整705 tests／120.177秒全部通過；compileall及原CI驗證通過。獨立9項測試涵蓋2,304組管理流量判斷及真CLI生命週期。發布後僅追加空白的raw bytes漂移曾重現錯誤成功；改用publisher回傳的原始SHA綁定後拒絕並保留失敗claim。

下一個本機入口是plan-bound durable action intent、固定adapter／dispatch與未知結果唯讀reconcile：先核對before state、current authorization／fence與exact plan digest，再建立不可重播的操作紀錄。完整network observations、fresh bootstrap、generation commit/seal及barrier completion仍待實作；真SSH／nft kernel與三次fresh generation驗收另行執行。本輪未操作VPS，不降低正式剩餘12項。
