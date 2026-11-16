# T-0027 合成秘密結果輸出契約

本輪只完成 AC-11 子集；不偵測真實憑證，不修改原始報告、產物或來源。
實際 Claude Opus 5.5 指導後，由主導核對現有介面並凍結以下契約。

## 有限語法與文字

- case-sensitive Python regex `(?<![A-Za-z0-9])SYNTHSECRET_[0-9a-f]{16}(?![A-Za-z0-9])`；替換為 `SYNTHSECRET_REDACTED`。邊界可為 `_`、`-`、`.`、`/` 或文字起訖；不匹配大小寫錯誤、15／17 hex 或相鄰英數。只處理解碼後字串，涵蓋值與 dict key；key 碰撞 fail closed。
- 安全 Unicode、CR／LF／CRLF 原樣保存，不做 Unicode 正規化。孤立 surrogate 轉 U+FFFD；合法 surrogate pair 合為對應 codepoint，確保 Python UTF-8、HTTP JSON、TextEncoder／Blob 一致。這是主導對指導中「保留 lone surrogate」的相容修正，避免現有 HTTP ensure_ascii=False.encode() 失敗。
- `redact(text)`、`redact_tree(value)`、`display_bytes(text)`、`make_ref(root, raw_run_name)`、`project_row(row)` 為後端共用 helpers。輸入不修改；投影冪等。

## 出口及身分

- 先核對原 bytes／hash，再投影。normalize 包住原 normalize＋retry 邏輯的所有出口；catalog unsafe-directory 列也投影。render_html 對完整資料再次 redact_tree 作防禦（不可重算已投影 row 的 ref／id_redacted），ensure_ascii=True 並 escape <>&，最後掃描 sentinel。
- `id` 保持顯示用字串（既有 plain job id／catalog root:name 形式），`root` 為正整數（plain id 預設 1），`id_redacted` 為布林；`ref = 'r1_' + sha256(b'agent-office-result-ref\0' + str(root).encode('ascii') + b'\0' + raw_run_name.encode('utf8')).hexdigest()[:32]`。同一 raw run 的 job／catalog refs 相同。
- `retry.root`／`retry.parent` 只保留遮蔽顯示字串，不當作 lookup；另提供 `root_ref`／`parent_ref`（None 保留）。ref 無持久化 key，可能供字典猜測，僅合成測試範圍，不是授權 token。
- 投影錯誤保留已知非成功 status，否則降為 invalid；固定 reason `redaction_failed`，artifact={status:unavailable}，provider=unknown、model/version=None、cleanup_verified=False；id 必須安全或固定 `unavailable`，ref 如不能可靠計算則 None。不得回傳原文／例外訊息。保留現有 UI 可消費列結構，不新增未知 error status。
- 既有 `Console.job_view(job)` 不改成新遠端查詢端點；仍從內部 raw run讀取，回應 run_id 遮蔽，result已投影。失敗 fallback 同樣遮蔽。
- UI view 使用快照中的 row／ref；retry 改為 `{retry_ref:run.ref}`，只顯示 root=1 的 Pi failed retry。主導 `Console.resolve_ref` 僅映射自身 lab/runs 的 allowed names，必須在 snapshot roots 的第一個根就是 lab/runs；0 或多匹配一律拒絕。不能用ref繞過既有 retry eligibility。舊 retry_id 仍供相容內部輸入，回應不得洩漏原文字串。
- CLI --show 先查 ref；顯示 id 僅在唯一且 id_redacted=false 才可查，否則沿用固定無原文 error。主導在 backend 合併後實作此項。

## 產物／下載

- `artifact.sha256`／`before_sha256`：原始、已驗證 bytes hash，語義不變。
- text/revision：`text` 是投影後替代內容，`display_sha256` 是 display_bytes(text) 的 SHA-256；revision 另有 original、display_original_sha256、diff、display_diff_sha256。
- fixture：`content` 是投影後 marker/total；新增 `export_text`，精確使用 `json.dumps(content,sort_keys=True,separators=(',',':'),ensure_ascii=False)+'\n'`；display_sha256 為此 canonical JSON UTF-8 hash。`export_canonical=true`；不代表原始 JSON 檔格式。
- `artifact.redacted` 表示產物任一輸出字串受遮蔽／surrogate修正；row另提供 `redaction={policy:'synthetic-v1',applied:bool}`。不能拿這些旗標跳過任何外部輸入驗證。
- `changed` 保留原始 bytes 的判斷。`display_changed` 精確比較投影後 original/text；diff 從投影後兩者重算 unified_diff，標題只用投影 target，splitlines 與既有 line-endings-only訊息一致。不遮蔽原diff來假裝重算；secret-only變更保留 changed=true/display_changed=false/diff=''。display_changed不能在changed=false時為true。
- UI 分別標「原始檔案 SHA-256」與「下載內容 SHA-256」。所有下載僅用投影文字，經 TextEncoder／crypto.subtle SHA-256 核對 display hash 後啟用 Blob；失配禁用並顯示錯誤。保持既有文字／revision替代檔下載；fixture可提供canonical JSON下載。原文／diff不必新增下載按鈕。

## 分工與驗收

Pi backend：result_redaction.py、office_results.py、test_result_redaction.py。Pi UI：office_console.js、office_results.html、check_result_redaction_browser.mjs。兩者各獨立 worktree，不共改檔。主導負責 Console glue、CLI --show、HTTP整合測試、真實瀏覽器／Blob驗證、文件、必要gates及PR。
覆蓋成功／失敗／early-return、unsafe symlink、metadata／marker／target、碰撞、穩定ref、Unicode／換行、secret-only差異、篡改原產物／來源、來源hash不變、API／CLI／HTML／Blob無指定secret。產品模型請求零。完整 AC-11／MVP 保持 pending。

兩個 Pi 各 24 provider-request hook／6000 output tokens／80 tools／720秒，回報費用達 US$3 停止（最後回應可能超過）。無 shell／Git／MCP、不改vendor，不自動重試。
