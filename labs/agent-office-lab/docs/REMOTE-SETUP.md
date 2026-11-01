# Grok／Pi 接入前置

這個入口安裝並檢查 CLI，讓 owner 完成隔離登入；不啟動 Office 遠端 worker，不呼叫付費模型。現有 OpenCode／Strata demo 維持 local-only。官方 Grok Build 是 SDD 的暫定選項；社群 grok-dev 不相容，不會因同名 executable 而被接受。

## 固定安裝與檢查

在本元件目錄執行；不需要 global npm 安裝：

```sh
npm --prefix tools/pi ci --ignore-scripts --no-audit --no-fund
npm --prefix tools/grok ci --ignore-scripts --no-audit --no-fund
python3 scripts/remote_cli.py check
```

鎖定 `@earendil-works/pi-coding-agent` 1.4.0 與 `@xai-official/grok` 1.0.70。需 Node 22.19+、npm、Python 3.11+；實測 macOS arm64、Node 23.11.0。依據 [Pi 安裝文件](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md)與 [Grok 官方 CLI](https://docs.x.ai/build/cli/reference)。Grok 的 npm postinstall 沒有執行，實測 bootstrap 仍可使用 optional platform binary。

`check` 只接受 lab 內固定 package identity、版本及 entrypoint，實際執行 `--version`／`--help`，檢查 Office 所需旗標。Grok 的隱藏 `--trust` 以 `--trust --help` 驗證 parser，沒有啟動任務。每次使用 disposable HOME，移除繼承的憑證與 Node／Python 注入設定，以 macOS sandbox-exec 阻擋網路。Linux CI 只跑離線測試，不宣稱完成這個 macOS probe。受限代理可能不允許建立巢狀 sandbox；`version_or_help_failed` 不代表 CLI 本身不相容，應在允許 sandbox-exec 的環境重跑。

輸出只包含版本、能力、來源 hash 及原因碼；`compatible=true` 不是登入成功或推論驗收。沒有安裝、錯版、錯套件或缺少能力時 exit 1，登入入口也會先拒絕。

## Owner 執行一次

Pi + DeepSeek：

```sh
python3 scripts/remote_cli.py setup-pi
```

在提示中貼入 DeepSeek API key，輸入不回顯。不要把金鑰放進命令列、聊天或 Git。設定寫入忽略的 `.local/remote/pi/auth.json`，模式 0600、父目錄 0700；拒絕 symlink、改動過的模型設定及覆寫既有憑證。它不驗證 API key 餘額／權限，也不發出 API 請求。

模型設定使用 `deepseek-flash`／`https://api.deepseek.com`，來源為 [DeepSeek API 文件](https://api-docs.deepseek.com/)。Pi 的 `$DEEPSEEK_API_KEY` 插值模板保留；已存的 `auth.json` 憑證依 Pi 原生優先序使用。本次只用合成金鑰在斷網環境驗證格式與模型清單，未把它當成真實登入。

若使用官方 Grok Build：

```sh
python3 scripts/remote_cli.py login-grok
```

這會執行固定 CLI 的原生 `login --device-auth`，依畫面提示在瀏覽器完成帳號登入。`GROK_HOME` 是 `.local/remote/grok`，不修改既有 `~/.grok`；不繼承 XAI／其他 provider 的環境金鑰。登入過程需要連線，但不送模型任務。需要有效的帳號資格，工具不會代為購買方案。

完成後只回覆設定／登入是否完成，不傳 key、auth.json、登入碼或 token。若已存在隔離憑證，setup-pi 會拒絕覆寫；請先說明需要更換，而非刪除整個狀態目錄。

## 接下來的驗收

遠端 adapter、具體模型、合成任務與用量上限要明確設定後才能做付費 smoke。Grok 上游的 `--trust` 表示初次 workspace 信任，必須揭露／處理，不能當成逐次工具權限；本輪沒有執行這個信任動作。Pi 的 extension 必須以 `agent_settled` 判定完成，不能把 accepted／agent_end 當成功。後續一次有界 Pi 工位任務已通過 AC-04，見[真實證據](evidence/pi-live-2026-11-01.json)；Grok AC-03 與完整生命週期仍待驗，既有 demo 不會因安裝 CLI 而自動開放雲端 provider。

Pi 的原生 Office 有界 runner 已備妥，見[Pi 遠端驗收](PI-REMOTE.md)。`--check-startup` 不發出遠端請求；`--allow-remote` 是付費驗收的明確 opt-in，不因登入設定自動執行。
