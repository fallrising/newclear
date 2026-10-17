# P1f：本機 durable bootstrap intent journal

P1f 依 [p1f-v1.1 契約](P1-JOURNAL-CONTRACT.md) 保存一筆精確 bootstrap action 的 intent。
它不執行 action。成功記錄後，狀態直接是 `uncertain`：效果可能發生，也可能沒有發生。
同一個保留的 journal 會拒絕所有後續記錄，包括相同 action、另一個 phase 或重啟後的要求。

## 原始輸入與綁定

三個 API 是 `initialize_journal`、`journal_status`、`record_intent`，都需要原始 P1c
bootstrap plan、獨立保存的預期 bootstrap digest 與私有 state root。
只接受完整驗證的 pristine proposal；already-converged 沒有 action，拒絕建立 journal。
原始 plan 的 machine/container/node、ownership、manifest、snapshot、phase requirements
都受精確內容綁定；hash 是內容身分，不是認證或操作授權。

`record_intent` 以原 plan 的 `phase_id` 與嚴格整數 `action_index` 選取 action；
不能傳入自行拼裝的命令。它可記錄任一原始 action，但不驗證執行順序、phase readiness
或先前效果。必須由未來獨立設計的 executor 提供這些條件。

回傳的 metadata 與 intent 是私有資料。公開 CLI summary 只含固定否定旗標、操作名稱、
`no-intent`／`uncertain` 與 intent 數量。`no-intent` 只描述已驗證的本機目錄，不能推論
遠端 absent、empty、healthy 或可以安全重送。

## 本機檔案與失敗行為

新 root 必須原先不存在；不接管現有空目錄。直接父目錄及 root 是目前使用者的0700
目錄，檔案是0600、single-link、regular file。路徑須是原始 canonical absolute string，
不經 symlink、不在 source tree，且不能與任一 host data_root 有雙向祖先重疊。

成功初始化保留不可替換的空 `.lock` 和 immutable `journal.json`；記錄後增加一次性的
`intent.json`。metadata 綁定 root／lock 的 device+inode。每次 API，包括 status，
都取得同一個 nonblocking exclusive flock，重查檔案、目錄與完整 schema。

寫入順序是 exclusive pending file → file fsync → directory fsync → identity recheck
→ atomic rename → directory fsync → validated reread。初始化還同步父目錄，並在 metadata staging 前 fsync 新建立的 lock inode。
`.initialize.pending`、`.intent.pending`、未知檔案、缺檔、部分或 malformed JSON
一律拒絕後續操作；錯誤不自動清理。metadata／intent 各上限65536 bytes，包含 canonical
JSON 尾端 LF；plan input 上限1MiB。檔案的 permission、owner、link、type 與 bytes 都受檢查。

失敗回覆不代表沒寫入：rename 之後的錯誤可能已留下有效 intent，重新查詢會看到
`uncertain`。Timeout／lost reply 不等於遠端取消；晚到的效果也不清除 uncertainty。
本輪沒有 resolve、complete、abandon、retry、reset、adopt 或 repair API。
保留失敗 artifacts 供後續調查，不自行刪目錄重來。

## 私有 CLI

以下是參數形式參考，不是已執行 transcript 或遠端操作指令。PRIVATE 路徑須替換為
本機 private file/root；plan file 的直接父目錄須0700，檔案須0600。

```text
python3 scripts/bootstrap_journal.py init
  --plan PRIVATE_PLAN --expected-bootstrap-digest INDEPENDENT_BOOTSTRAP_SHA256
  --state-root NEW_PRIVATE_ROOT

python3 scripts/bootstrap_journal.py status
  --plan PRIVATE_PLAN --expected-bootstrap-digest INDEPENDENT_BOOTSTRAP_SHA256
  --state-root RETAINED_PRIVATE_ROOT

python3 scripts/bootstrap_journal.py record-intent
  --plan PRIVATE_PLAN --expected-bootstrap-digest INDEPENDENT_BOOTSTRAP_SHA256
  --state-root RETAINED_PRIVATE_ROOT --phase-id set-config-epochs --action-index 0
```

成功 exit0；拒絕或中斷 exit2，只輸出去識別 JSON。CLI index 不接受符號、空白或前導零。
沒有 credential、execute、approval、mock effect 或輸出匯入選項。真實 inventory、原始
plan、ID、journal 與 raw receipts 留私有 evidence，不貼到公開 PR。

## 保證與後續界線

保護限於同一個被保留的 journal root 與合作遵守 lock 的 caller。另一個 root、同 UID
回滾或刪除、外部操作者無法由這個 library 阻止；新 root 不授予重送權限。它不提供
全域 exactly-once、認證或防竄改保證。操作期間的 root 替換會拒絕；若原目錄之後被移到另一個合法路徑，同 inode 的 uncertainty 仍保留，沒有以 pathname 偵測歷史搬移的保證。Fsync／rename／flock 的 OS/filesystem 支援是前提，
process-kill 與 mock 測試不能冒充斷電耐久性證據。

實際本機證據見 [VALIDATION](VALIDATION.md) 與 [T-018](../.team/reports/T-018.md)、
[T-019](../.team/reports/T-019.md)。模擬效果只在測試 wrapper 中發生，且只能在持久化 API
成功回傳之後開始；production module 沒有 transport 或 callback seam。

Authenticated fresh collection、phase 前後及逐效果身分核對、獨立精確批准、完整
startup／phase-aware executor、authenticated uncertainty resolution、Mithril image
provenance、有效 network／ACL、replication health／lag、實機保留資料 lifecycle 與
proxy smoke 仍未驗收。正常 down 保留資料，purge 另需精確條件與批准。
完整 P1／MR-004 尚未完成；正式剩餘任務仍是5項，詳見 [STATUS](STATUS.md)。
