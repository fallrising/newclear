# Strata agent 調研實驗

> 公開匯入版：先依 [SETUP](SETUP.md) 設定環境（research 文件請見 ../docs/SETUP.md）。原 runs 的連結改指向歷史摘要，原始日誌及截圖不公開。

## 本次實際結果

2026-10-31 16:42 SGT 執行：

```sh
cd "$LAB_DIR"
"$STRATA_HOME/source/.venv/bin/python" scripts/probe_strata.py
```

使用既有 Q2_0、原生 Metal 設定與 4096 context，另存 config／logs 到新 run directory，未修改舊測試設定。

結果：**啟動失敗，未進入推論**，server exit code 2，約 1.03 秒。錯誤：

```text
server.py: error: cannot listen on 127.0.0.1:8080: Operation not permitted [1]. check --host and --port
```

這是目前工具執行沙箱的 loopback bind 限制；錯誤發生於模型載入前，不能推論模型或 Metal 是否故障。同次資源檢查的 `sysctl` 也被拒絕。本工作階段不提供 sandbox approval，因此沒有可在此提升權限的流程；未嘗試繞過。

- [啟動結果（歷史摘要）](evidence/README.md)
- [server log（歷史摘要）](evidence/README.md)
- `inference_tested=false`；owned descendants 已停止。
- 尚未驗證：推論、tool-call 格式、GitHub 搜尋迴圈、此次生成速度與品質。

另於 16:47 SGT 實際執行 `strata_research.py`，在 health 連線階段同樣收到 `Operation not permitted`，model rounds、tool calls、search successes 均為 0。[研究腳本結果（歷史摘要）](evidence/README.md)

離線驗證通過：兩個 Python 腳本語法、JSON 設定、工具白名單、拒絕非法 repo path、搜尋字串 URL 編碼與 metadata 整理。這些檢查用替身資料驗證 host 邏輯，不是模型測試。[離線結果（歷史摘要）](evidence/README.md)

## 可用執行環境中的重跑流程

先在允許 loopback、Metal 與資源監控的正常 Terminal 執行。`probe_strata.py` 只測啟動，成功後也會關閉它啟動的服務；不會留下供研究使用的 server。

研究測試分兩個 terminal，從根工作目錄執行。第一個使用既有監控器啟動 server；每次請替換時間戳，不覆寫舊證據：

```sh
cd "$LAB_DIR"
export XDG_CACHE_HOME="$PWD/strata-mac/.cache"
export XDG_CONFIG_HOME="$PWD/strata-mac/.config"
export XDG_DATA_HOME="$PWD/strata-mac/.local/share"
export HF_HOME="$PWD/strata-mac/.cache/huggingface"
export TMPDIR="$PWD/strata-mac/.cache/tmp"
LAB_RUN_STAMP=$(date -u +%Y%m%dT%H%M%SZ)
strata-mac/source/.venv/bin/python - "$LAB_RUN_STAMP" <<'PY'
import json, sys
from pathlib import Path
root = Path.cwd()
run = root / 'agent-office-lab/runs' / ('server-' + sys.argv[1])
run.mkdir(parents=True, exist_ok=False)
cfg = json.loads((root / 'strata-mac/source/strata-q2_0.json').read_text())
cfg['log'] = str(run / 'engine.log')
(run / 'config.json').write_text(json.dumps(cfg, indent=2) + '\n')
PY
caffeinate -i strata-mac/source/.venv/bin/python run-monitored.py \
  --log "agent-office-lab/runs/server-$LAB_RUN_STAMP.log" \
  --resources "agent-office-lab/runs/resources-$LAB_RUN_STAMP.jsonl" -- \
  strata-mac/source/.venv/bin/python strata-mac/source/serve/server.py \
  --engine strata --config "agent-office-lab/runs/server-$LAB_RUN_STAMP/config.json" \
  --host 127.0.0.1 --port 8080
```

每次產生獨立 config 與 engine log。若建立目錄失敗，停止該次流程並改用新的時間戳；啟動前確認 8080 沒有其他服務。

第二個 terminal 在 server ready 後執行：

```sh
cd "$LAB_DIR"
"$STRATA_HOME/source/.venv/bin/python" scripts/strata_research.py
```

腳本對已啟動的 `127.0.0.1:8080` 發出 OpenAI-compatible tool requests。host 只執行兩個白名單 GitHub GET 工具，不執行模型生成的 shell。使用 GitHub 公開匿名 API，遇到 rate limit 會回傳錯誤給模型；不讀取 GitHub 私人登入資訊。

最多 5 個 model turns、6 次 tool calls；每次搜尋最多 3 筆，只取 metadata。輸出到新的 `runs/strata-research-*/`，包含每輪 request／response／tool result／最終草稿與 result。metadata 能驗證 repo 存在，**不能證明 adapter 能力**；能力仍需另外讀取原始碼與執行測試。模型產出的草稿不覆蓋正式 SDD。

完成後於第一個 terminal 停止 server，確認 `[strata] stopped`，且只停止本次啟動的程序。不要與 Decider 同時載入。

## Pi 設定範例

`configs/pi-models.example.json` 是最小 DeepSeek 相容端點範例，不含金鑰，不是已驗證設定。實作時優先使用 Pi 當前內建 catalog；若需要自訂，將內容合併到 Pi 使用的 models.json，並依固定版本確認 thinking/tool-call 相容欄位。不得覆蓋使用者已有 provider。金鑰由 `DEEPSEEK_API_KEY` 環境變數提供。
