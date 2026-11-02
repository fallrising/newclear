# Edge Relay agent contract

遵守根目錄 [AGENTS.md](../../AGENTS.md)。接手先讀 [SUCCESS.md](SUCCESS.md)、[SDD.md](SDD.md)、[任務板](docs/tasks/BOARD.md) 與 PR 最新證據。

## 本次授權

M0：設計與文件驗證。禁止宣稱 runtime 可用；不部署、不付費、不發布、不建立 usable tag、不合併。後續實作需獨立授權，不能把 roadmap 當作執行命令。

## 工作與驗收

1. 先核對遠端 main、工作分支及檔案來源。每項 AC 要在任務板認領，使用 UTC RFC3339 時間；每次 push 更新 last_activity。
2. 改契約先同步 SDD、SUCCESS 與測試計畫；不可為通過測試降低既定主線。
3. 原子提交到工作分支，不 force、不改 main；GitHub app 可作 Git Data 備援。更新 ref 前回讀 head，使用非 force fast-forward；衝突重新整合。
4. 必跑本元件文件連結／AC 追蹤、`python3 scripts/check_project_success.py --projects gateways/edge-relay`、repo 的 `python3 scripts/check_indexes.py`。完整 checkout 不可得時保留限制，以相同 candidate SHA 的 CI 補證據，不虛報本機 PASS。
5. 新項目必須進 inventory、PROJECTS、README catalog 與根 llms 導航；spec-only 元件可連 README，不必捏造 capability file 或不存在的 API entrypoint。
6. 文件驗證與 runtime 證據分開。測試替身不能代替兩個不同網路端點、真 CF 休眠／恢復、真 ntfy/Bark 手機的驗收。
7. 公開內容不得包含真裝置識別、topic、device key、token、主機名、私有檔案路徑或使用者對話。只使用合成 fixtures。
8. 合併前任務保持 in_progress；合併授權另取。允許的狀態與收尾依根合約，不改根 AGENTS。

## 設計禁區

不要把 route_id 當 capability；不要把 TLS 寫成 E2EE；不要自己設計密碼學握手；不要允許網路傳入任意 localhost URL／shell。通知 provider credentials 留在 endpoint，不進 relay。client disconnect 不等於業務 rollback；禁止自動重播 mutation。
