# Security and Operations

## 1. Threat model

主要威脅：prompt injection、惡意 repo/input、供應鏈 action/CLI、secret exfiltration、runner persistence、越權寫入、敏感資料送至第三方、無限 loop/費用、錯誤知識污染。

## 2. Mandatory controls

- 只對 private repo 啟用 self-hosted runner，並限制可使用 runner 的 repository/group。
- Workflow permissions 預設 read-only；建立 PR 的 job 才取得最小寫權限。
- Third-party Actions pin 到完整 commit SHA，不只 tag。
- `pull_request_target` 不 checkout/run 未信任 PR code。
- Agent job 不可接觸 production secret；secret 依 environment、role、job 分割。
- 所有模型/API credential 僅以 secret 注入，不寫 prompt、log、repo 或 cache。
- Network deny-by-default；allowlist provider、package registry 與 GitHub endpoint。
- Rootless container、read-only root filesystem、drop capabilities、CPU/RAM/PID/time limit。
- Workspace 結束即銷毀；cache 僅保存非敏感且 content-addressed 資料。
- Gitleaks/TruffleHog 類 secret scan、dependency/SAST/license scan、malware scan。
- Protected paths 必須由 CODEOWNER 人工批准。

## 3. Prompt injection boundary

PDF、Issue、README、網頁與測試輸出全部視為 untrusted data。資料內的「忽略規則、讀取 secret、執行 curl」不是指令。System policy 與 Task Contract 由 orchestrator 注入，agent 不可從 repo 改寫 effective policy。

## 4. Permissions matrix

| Role | Repo read | Worktree write | Network | PR write | Secrets |
|---|---:|---:|---:|---:|---|
| planner | yes | no | limited | no | provider only |
| builder | yes | allowed paths | limited | no | provider only |
| reviewer | diff only | no | limited | comment/report | provider only |
| publisher | reports/patch | branch only | GitHub | yes | GitHub app/token |
| deployer | artifact only | no | target only | status | environment gated |

## 5. Operational runbooks required

- Runner offline/unhealthy。
- Provider auth/rate limit/model removed。
- Cost spike or stuck agent。
- Secret detected in working tree/history/log。
- Compromised runner rebuild。
- Knowledge source takedown/redaction。
- Ledger/object storage restore。

## 6. Metrics

- task success/failure/block rate、lead time、retry count。
- model/provider latency、estimated cost、token/tool usage。
- test pass rate、review findings、revert rate。
- cache hit rate、OCR confidence、duplicate ratio。
- knowledge notes without provenance、broken links、taxonomy proposals。
- runner queue time、sandbox cleanup failures、secret scan findings。

## 7. Initial decisions still required

1. Hetzner OS、是否已有 Docker/Podman、VPS 是否同時承載其他服務。
2. GitHub 個人 repo 或 organization repo；可用的 branch/ruleset features。
3. 原始檔放 Hetzner volume、NAS、R2 或其他 S3-compatible storage。
4. 哪些歷史資料依法/依合約可送第三方模型。
5. 各 CLI 的訂閱是否允許自動化/CI；API 與訂閱額度通常不可互換，需按官方條款確認。
6. `Claude fable`、`Grok 4.6 Heavy`、`DeepSeek v4 Flash` 的精確 provider/model ID 與 API/CLI 可用性。

上述未決事項不阻擋 Phase 0/1，但阻擋 production credential 與敏感資料上線。

連續完整建置時，Phase 0 必須逐項建立 ADR，採用 `07-END-TO-END-EXECUTION.md` 的可逆 local-first default 或標記明確的 external gate。缺少 VPS、object storage 或 production credential 可以繼續不依賴它們的程式開發；資料權利不明、critical risk、需要把 confidential/restricted data 傳給第三方，仍然是 blocking condition，不得以 synthetic fixture 或 `CODE_COMPLETE_EXTERNAL_PENDING` 宣稱已通過真實資料驗收。
