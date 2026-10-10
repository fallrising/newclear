# Fresh baseline：唯讀 observation 與 preparation 證據

接續 [execution preparation](M3-FRESH-EXECUTION-PREP-2026-10-03.md)，本輪加入四台 review-bound 主機的唯讀基線採集，以及可重新導出的 schema-v2 host evidence。這是舊狀態 inventory，不是 empty/residue acceptance；ERU-015 與固定剩餘 12 項仍未完成。

## 操作與信任邊界

```bash
python3 scripts/labctl.py collect-fresh-baseline \
  --plan REVIEW_ID --sha256 REVIEW_DIGEST \
  --run-id RUN_ID --observation-id OBSERVATION_ID
```

這個入口會呼叫四台主機的固定 SSH probes，因此實機呼叫須在相應操作授權下進行。本輪驗證只使用 synthetic fixtures、fake transports 與本機子程序，沒有執行 VPS／provider／真實 private 操作。它使用一般 controller lock，已有 pending 時拒絕新採集；不建立 pending reservation、不執行 fresh stages、不改 generation、不釋放 barrier。既有 observation 的本機重驗則由 inspection 執行，不重新呼叫 SSH。

觀測必須沿用目前 review、source、inventory、cluster、scope 與 G/G+1；本機資料漂移或任何 probe 失敗都拒絕完整基線。CLI 僅輸出 ID、digest、host count、generation 與固定 false flags，不輸出 host identities、原始 command output 或 private evidence refs。私有 observation 不是可公開的診斷檔。

既有 `verified-host-public-keys.json` 的三 worker 映射仍可供原 preflight 使用；新 collector 要求四台（含 core）的精確映射，且已被 review 綁定。preflight 僅新增接受精確四台映射，缺 worker／額外 alias 仍拒絕。每台必須有一個 canonical Ed25519 public key（類型與 base64 wire bytes，無 comment）；金鑰必須由原信任流程提供，不從本次 SSH 回覆自動採信。

## 固定 probes 與限制

每台讀 machine ID、boot ID、Ed25519 host public key 與 `ctr --namespace eru` 的 container/task IDs。core 另外讀 etcd endpoint status、member list、全 keyspace 的 keys-only range，以及 ERU nodes/workloads。資源 capacity/usage 保留供後續比對；workload 僅保留 ID 與 node，避免採集 environment 等敏感欄位。未知 runtime IDs 可以作為舊狀態保留，不推定為乾淨。

etcd 使用鎖定版本的 [GET range 契約](https://github.com/etcd-io/etcd/blob/v3.6.14/etcdctl/README.md#get-options-key-range_end)：`get --from-key '' --keys-only --limit=4097`，可接受上限為 4096 keys；回傳 more、count、重複 key、非空 value 或 identity 不一致都拒絕；revision 僅比對 status 與 key range，member list 依 [鎖定版 MemberList 契約](https://github.com/etcd-io/etcd/blob/v3.6.14/server/etcdserver/api/v3rpc/member.go) 不提供 revision，只核對 cluster/member identity。status/member/range 的 JSON 形狀依 [v3.6.14 JSON printer](https://github.com/etcd-io/etcd/blob/v3.6.14/etcdctl/ctlv3/command/printer_json.go) 核對。collector 不呼叫 endpoint health 或修復命令。

SSH 關閉 user config、proxy、connection sharing、forwarding、local commands 與 host-key 更新，以 review-bound IP、固定使用者／port 和記憶體中的 pinned known_hosts 連線。只支援 Linux controller 的 memfd 與預設 identity/agent；依賴自訂 SSH config 的環境會失敗，不能自動退回較寬鬆的信任模式。每個子命令最多 512 KiB／10 秒，每台 capture 最多 4 MiB／90 秒，整輪最多 360 秒；stdout/stderr 在讀取期間受限。

## Evidence 與準備介面

Observation 與 host baseline 分別保存在 `private/operations/fresh-rebuild/observations/OBSERVATION_ID/observation.json` 與同目錄的 `host-baseline.json`。準備 request 的 host ref 使用後者相對路徑及原始檔案 bytes SHA-256；CLI 的 observation digest 是 envelope 內 record digest，不能拿來替代 host ref 的檔案 digest。每個 observation ID 只使用一次，失敗或中斷也不自動重用。原始固定 probe 的受限輸出、command provenance 與 review context 保留於私有記錄；這些本機 hash 提供一致性與漂移偵測，不是遠端簽章。

準備 request 本身仍為 schema 1，`host_baseline` ref 可以指向 schema 2：原有 `kind`、`binding`、`observed_at`、`hosts` 欄位，加上恰含 `path`／`sha256` 的 `observation` ref。`prepare-fresh-execution` 和 `inspect-fresh-execution` 都安全讀回 observation，重驗固定命令與結果並重新導出 schema-1 host baseline；與宣告內容不完全相同就拒絕。execution 仍綁定原始 schema-2 evidence 的 bytes digest，不能替換 ref 而沿用 execution hash。

既有 schema-1 手工 host attestation 契約保留。schema-2 並未把 owner authorization、writer fence 或 external materials 變成經實機驗證的事實。每台主機 probe 前後重核 machine／boot／host key；core 的 status 前後檢查只包住 core metadata 採集區間，後續三台 worker 是依序採樣。這些檢查不能證明外部 writer 已隔離或整群取得原子快照。

## 後續驗收

實際 destructive stage dispatch、bootstrap／probes、外部 fencing、generation CAS／accepted-run seal／barrier completion，以及三個獨立 live fresh generations 仍缺。etcd token provenance 與完整 residue acceptance 不能從這份基線推論。既有 [v0.1.7 雙次 build](M3-CORE-V017-VALIDATION-2026-10-03.md) 保留，沒有重建或部署。

## 驗證結果

[Worker](../.team/reports/T-222.md)、[獨立審查](../.team/reports/T-223.md) 與 [root evidence gate](../.team/reports/T-224.md) 分別保存有界證據。獨立審查重現並修復了 process leader 已退出時的子程序清理，以及真實 etcd member header 無 revision 的相容性缺陷；沒有放寬 status/range revision 檢查。

- Root focused：`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tests python3 -m unittest -v test_fresh_observation test_fresh_observation_integration test_fresh_execution test_fresh_execution_cli test_controller_preflight`，57 tests／1.979 秒通過。
- Independent focused：上述範圍加 `test_fresh_observation_review`，68 tests／2.948 秒通過，包含實際 synthetic collector → preparation → inspection 證據鏈及 11 個獨立 adversarial cases。
- Full native：`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v`，586 tests／75.081 秒通過，零 failures／errors／skips。之後 independent test 僅整理 imports，11 tests／0.856 秒重驗通過。
- 原 workflow 的 AST／JSON／Markdown links／whitespace／tracked private exclusion，compileall 與 team task/report contracts 通過。沒有 VPS E2E，沒有把本輪結果當成完整 executor acceptance。
