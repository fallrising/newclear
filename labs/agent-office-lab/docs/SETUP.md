# 安裝與重跑

從 `newclear/labs/agent-office-lab` 執行以下命令。這是 macOS arm64／Metal 的實驗 runner；Linux CI 只跑離線檢查。
需 Git、Python 3.11+（原實測 3.12.13）、Node／npm（原實測 Node 23.11.0、npm 10.9.2）、Google Chrome 預設 macOS 安裝路徑。
OpenCode binary 固定為 darwin-arm64。Codex harness 額外需要 `/opt/homebrew/bin/codex` 0.166.0；OpenCode harness 不需要 Codex 登入。

## 固定 Office 與 OpenCode

以下會從公開 GitHub／npm 下載程式與依賴；不下載模型、不登入模型服務。

```sh
export LAB_DIR="$PWD"
mkdir -p vendor
git clone https://github.com/AgentSystemLabs/agent-office.git vendor/agent-office
git -C vendor/agent-office checkout --detach 852e2ab28c4f3f31bffdf4b20353bd119c9d3270
npm --prefix vendor/agent-office ci --ignore-scripts --no-audit --no-fund
npm --prefix vendor/agent-office run typecheck
npm --prefix vendor/agent-office run build
npm --prefix tools/opencode ci --ignore-scripts --no-audit --no-fund
npm --prefix tools/opencode-plugin ci --ignore-scripts --no-audit --no-fund
```

保留上游 MIT LICENSE；本 repo 不複製上游來源。`npm ci --ignore-scripts` 是原先成功的安裝方式；原生 PTY 需要對應平台的 optional package。全新 macOS 安裝仍需自行確認 build 與 smoke；本次匯入只驗證既有環境的搬移與離線檢查。
OpenCode 與 plugin SDK 均為 1.19.5，鎖檔在 `tools/`。SDK 必須預裝，否則隔離執行時會卡在 dependency initialization。

## 外部 Strata 前置條件

Strata 與約 66 GB 的 Q2_0 權重不在 repo 內。本實驗沿用獨立安裝：

- [Strata](https://github.com/Niko1221/Strata/tree/7dd5cf18e68c639a8773e096c5c79f971ea2a9f5)，固定 commit `7dd5cf18e68c639a8773e096c5c79f971ea2a9f5`。
- 依該版本 [macOS 安裝文件](https://github.com/Niko1221/Strata/blob/7dd5cf18e68c639a8773e096c5c79f971ea2a9f5/docs/MAC.md) 準備 Metal build、Python server、tokenizer 與 expert pack。
- 模型 `ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF`，revision `ed59f92082b1e93c0e96d60a8b11aab089b52f09`，兩個 Q2_0 GGUF shards。
- 根目錄下必須有 `source/serve/server.py`、`source/.venv/bin/python`、`source/strata-q2_0.json`；config 內的 binary、pack、GGUF、expert profile、tokenizer 路徑須對應本機安裝，`model_name` 為 `qwen3.8-flash-next-q2_0`。
- [設定模板](../configs/strata-q2_0.example.json) 用 `@STRATA_HOME@` 標示根目錄；它不是可直接交給 server 的設定，必須先替換成本機絕對路徑並核對檔案存在。

選擇已準備好的安裝位置，勿將個人實際路徑寫回 Git：

```sh
export STRATA_HOME="$(cd ../strata-mac && pwd)"  # 或你自己的外部安裝位置
"$STRATA_HOME/source/.venv/bin/python" -m pip install -r requirements.txt
"$STRATA_HOME/source/.venv/bin/python" scripts/run_local_work.py --prepare-only
```

`STRATA_HOME` 未設定時預設為 lab 相鄰的 `../strata-mac`。prepare-only 只檢查設定與產生 fixture，不證明 Metal／模型／CLI 可運作。runtime 固定改為 32K context，不變更來源 config；只監聽 localhost:8080。預先停止占用 8080 的服務。

## 執行與清理

```sh
# 真實 Office 任務，驗證完成後自動關閉
"$STRATA_HOME/source/.venv/bin/python" scripts/run_local_work.py --harness office-opencode
# 加驗取消，再保持 demo 開啟；Ctrl+C 清理
"$STRATA_HOME/source/.venv/bin/python" scripts/run_local_work.py --harness office-opencode --check-cancel --keep-open
# 獨立生命週期驗收：合成權限回覆、瀏覽器刷新及終止後恢復原 session
"$STRATA_HOME/source/.venv/bin/python" scripts/run_local_work.py --harness office-opencode --check-lifecycle
# 真實 Office host 崩潰／重啟、保持 interrupted、手動恢復原 session
"$STRATA_HOME/source/.venv/bin/python" scripts/run_local_work.py --harness office-opencode --check-restart
# 不載入模型的 sandbox 邊界 probe，執行前確認 8080 沒有服務
"$STRATA_HOME/source/.venv/bin/python" scripts/check_opencode_sandbox.py
```

`--check-lifecycle` 是有界合成測試，不能與 keep-open、check-cancel 或 queue-repair 合用。它將該 Office worker 的 edit／bash 權限設為 ask，等待原生權限事件與終端畫面，確認產物仍未寫入後才透過 PTY 按 Enter 選一次 Allow once；最多八次，不選 Allow always。一般 demo 設定不變。它另外刷新真正的 lite 瀏覽器，再終止已完成任務的 OpenCode 程序，以原生 worker.resume 恢復同一 session 並核對第二個產物。Office host restart 另以 `--check-restart` 驗收。

`--check-restart` 使用同樣的有界合成權限回覆，不能與其他 Office 驗收旗標或 keep-open 合用。它在權限等待時強制結束獨立 Office host，再用相同 workspace／home／port 啟動新 host；驗證舊 PTY 退出、沒有新 PID 或產物、再次重啟仍保留 interrupted。最後在真瀏覽器中點開中斷工位，透過原生 worker.resume 恢復原 session，完成後再重啟確認不重跑。

一般 Office demo 也套用 lab 的手動恢復政策：重啟時停止殘留 PTY，未完成任務顯示 `interrupted ·`，點開離線工位才恢復；等同 session 的已認證 usage 與新終端就緒後，才透過原生 PTY 送出一次繼續指令（30 秒未就緒則停止並保留 interrupted）。固定版 OpenCode 的 `--prompt` 不會在既有 session 自動送出，所以不能只傳 CLI 旗標。沒有 session 的中斷任務必須重新提交。狀態記在合成 workspace 的 `.agent-office/lab-recovery.json`，損壞或不一致時拒絕啟動。adapter 依賴固定版本的 WorkerManager 內部介面，不適用其他上游版本；每次新 runner 仍建立全新 run，跨 host 恢復由同一 run 的 host 驗收示範。

需要環境允許 Metal、loopback、PTY、sysctl 和 macOS sandbox-exec；受限代理中失敗時不能取消工具 sandbox 來偽裝成功。
資源 guard 在 memory pressure critical／連續 warning、swap 增量超過 1 GiB、磁碟剩餘少於 50 GiB 或監控失敗時停止本次 runner。
每次結果在全新的 `runs/`；一次性登入連結、session、SQLite 和 prompt 不可提交。

基底預覽：`node scripts/office.mjs --serve`，預設 agent 關閉；`--screenshot` 跑 smoke 後退出。預覽產生的 `projects/`、`state/` 也已忽略。
Grok／Pi 另見[固定安裝與 owner 設定命令](REMOTE-SETUP.md)。Pi 模板已做真實 CLI 的離線格式／模型清單檢查，尚未驗證遠端推論。

## 離線驗證

```sh
python3 scripts/check_publication.py
node --test scripts/*.test.mjs
python3 -m unittest discover -s scripts -p 'test_*.py' -v
# 在 newclear 根目錄
python3 scripts/check_indexes.py
```

故意有 bug 的 queue-repair fixture 是給模型修復的題目，不是已通過的產品 unit test。不要直接把 fixture 全部跑過當成 CI gate。
