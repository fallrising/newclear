# M3 第五個切片：輸出密鑰防漏與 diff 完整性

Connector 在事件、審批與結果離開私密執行環境之前檢查資料。本切片只完成 AT-07 的部分輸出邊界；**AT-07 與 M3 尚未完成**。模型仍是固定 fixture，沒有付費 provider key。

## 行為

- 統一檢查目前 connector token、node operator token、該 run 的 sandbox token 與 Agent Server session key。Node token 不應进入 guest；仍納入防禦性過濾，避免上游錯誤回傳時落入平台。
- 對解碼後的 JSON 字串、巢狀值及 map key 遮蔽完整已知憑證，再序列化與截斷事件內容。這修正了先序列化再替換時，引號、反斜線及 Unicode 轉義可能造成的遺漏。
- 事件 ID／cursor、kind、state 必須是有界字串，含已知憑證時直接拒絕。不能替換 ID，否則會改變重播與去重的語意。
- 審批參數含憑證時拒絕；不修改待審的 command，也不產生與實際動作不同的 digest。
- Guest workspace result 必須符合固定欄位集合，不能注入或覆寫 host summary／execution mode。Connector 驗證固定 base SHA、UTF-8 diff 的實際 bytes／SHA-256、256 KiB 限制，以及 fixture verification 的完整結構與 run ID。
- 含憑證的 diff 直接拒絕，不產生經過遮蔽卻宣稱原 hash 的 patch。Guest helper 也不再用 replacement character 悄悄替換非 UTF-8 bytes；不可解碼的 diff 會失敗。
- 被拒絕的結果不寫成 completed journal receipt，也不進入平台 result。Worker 保持 interrupted 與容量占用；明確取消或期限回收，取得完整停止證據後才釋放 reservation。

過濾只比對完整、原樣的已知憑證；不宣稱可攔截 Base64、分段輸出、任意編碼、未知 repository secret 或蓄意資訊外洩。驗證 diff hash 證明傳輸資料一致，fixture assertion 不等於可信的 repository 測試或惡意 guest 執行證明。舊資料不會因升級自動重新遮蔽。

## 真實 VM 發現的控制憑證缺口

兩個 none-lane guest 的 UID 2000 terminal 都能從同 UID 程序的 `/proc/*/environ` 讀取 Agent Server 的 `SESSION_API_KEY`。驗收故意把此既有 guest credential 輸出到工具事件，確認 connector 遮蔽；第二個 VM 再把它寫進 workspace，確認 diff 被拒絕。測試沒有把 host connector／node operator credential 傳入 guest，證據只保存布林值與計數。

**輸出遮蔽不能修復 guest 控制權限。** 同 UID terminal 可以接觸 Agent Server 憑證／狀態；此前固定 fixture 下通過的 approval／pause 單 writer 條件不能當作惡意 guest 的安全保證。下一優先工作是隔離 Agent Server 控制帳號、憑證、狀態與工具程序，驗收 terminal 不能讀取／修改控制資訊或繞過 admission policy，並重新驗證 approval／pause／recovery。完成前不得把本模式描述為可安全執行不可信 agent 的 production 環境。

## 驗收

新增 10 項測試，涵蓋 JSON 轉義／巢狀 key、四種憑證、截斷邊界、完整審批參數、Unicode patch、偽造欄位／hash／size／verification、DB／SSE 防漏，以及拒絕後保留容量和取消回收。既有 M0 45 項與平台共 108 項測試通過。

`scripts/m3-output-kvm.py` 在同一專用 node 配置兩個真實 VM，使用 product connector、journal、fence、Agent Server 及 terminal。驅動器只更換固定模型的 command 以注入上述惡意輸出；KVM 驅動器本身不經平台 HTTP／DB，後者由整合測試覆蓋。

- 跨 VM 的 workspace marker 無法互相讀到。
- 檢查 guest 只有 loopback 及核心可能建立、處於 down 的 SIT tunnel；直接公網 TCP 不可達。
- 探測 HTTP proxy 的 public HTTP、HTTPS CONNECT、metadata、private IPv4、IPv4／IPv6 loopback 與未列出域名。目前配置沒有開啟 proxy，這些連線均不可達。此結果只證明這次 deny-all fixture 的觀測，**不證明 allowlist、DNS rebinding、redirect 或動態 node policy 的強制限制**；產品仍需獨立 egress policy 驗證。
- 正常 patch 通過完整性檢查；含 session key 的 patch 被拒絕且無 completed result receipt。
- 兩個 VM 最終取得 VMM／VM record／runtime directory／cgroup 停止證據，claims／VMs 歸零。

證據見 [KVM 報告](evidence/m3-output-kvm-2026-09-22.json)。報告 `passed` 僅代表本切片測試通過，`full_at07_complete` 固定為 false。

```bash
make platform-check
python scripts/m3-output-kvm.py \
  --config /private/path/connector.json --output .artifacts/m3-output-new
```

此驅動器直接持有 connector journal，執行前停掉該 journal 的 connector 服務，使用專用 zero-warm node 與新的輸出目錄。私密配置／journal／token 不進版控。

升級先 drain，保留 journal／fences 與 DB generation；本切片沒有新 migration。既有 active journal／已保存 result 不會追溯檢查，不能用新部署替舊結果背書。下階段依序處理 guest 控制憑證隔離、egress policy 強制限制、AT-11 model proxy／budget／usage，再進入 M4 artifact／export／production。
