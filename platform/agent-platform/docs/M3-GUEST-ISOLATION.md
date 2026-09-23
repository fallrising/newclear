# M3 第六個切片：客體控制憑證隔離

> 2026-09-23 接續：固定節點 egress 已由 [下一切片](M3-EGRESS.md) 完成；目前部署另需 migration 007、sealed node policy，並重建含固定 proxy 環境的 launcher。以下保留本隔離切片的驗收歷史。

修復 PR #30 發現的同 UID terminal 可讀取 Agent Server `SESSION_API_KEY` 問題。Agent Server 維持 SDD 要求的非 root 執行；控制服務與工具使用不同帳號、私有目錄與固定降權 launcher。**AT-07／M3 仍未整體完成**，egress policy 與 model proxy／budget／usage 尚待開發。

## 執行邊界

| 元件 | Guest 身分 | 可存取範圍 |
| --- | --- | --- |
| Agent Server、固定模型 | `agentcontrol`，UID／GID 2001 | 0700 的 `/var/lib/agent-platform/control`；HOME、state、tmp、SDK workspace 均在此處 |
| terminal、repository checkout／diff helper | `agentprobe`，UID／GID 2000 | `/home/agentprobe/workspace`；工具無附加群組與有效／permitted capabilities |
| 固定 launcher | root:2001，mode 4750 | 只接受 UID 2001 和單一 `-i` 參數；只會降至 UID／GID 2000 並啟動固定 bash |
| Connector 的 guest setup／attestation | guest root | 固定檔案與帳號初始化、hash／權限／程序核對；不接受 task 指定帳號、路径或命令 |

所有 guest helper 放在 root-owned `/opt/agent-platform`，Python helper 以 `-I` 執行，避免 `/tmp`、repository 或 HOME 的 Python module 注入。Launcher 是小型 static ELF：清除附加群組、關閉多餘 FD、禁止 core dump、清除 saved UID／GID、設定 `NoNewPrivs`，以固定環境進入 repository，使用 `bash --noprofile --norc -i`。工具無法重新執行此 launcher 取得其他帳號，也不能靠 setuid 或 file capabilities 恢復權限。

固定 SDK 的 `username` 參數本身不能作為 UID 隔離證據，因此 terminal 明確選用 `subprocess` backend 與固定 `shell_path`。SDK 的 LocalWorkspace 指向控制帳號的空白私有 workspace，實際 terminal cwd 則由 launcher 固定在 repository。這讓 SDK 的 ambient plugin／hook 探索無法讀取由工具修改的 repository 或 agentprobe HOME；自動 skills／memory 亦關閉。Repository 內容仍可經 terminal 作為資料讀取、編輯與測試。

控制服務以 allowlist 環境、0700 HOME／TMPDIR 與 `umask 077` 啟動，core dump 關閉。Provider master key、sandbox operator key、host connector token 仍不進 guest；guest 只保有自己的 session key。固定模型仍不呼叫付費 provider。

## Admission、恢復與暫停

- Connector 設定先驗證私密 launcher 檔案、amd64 ELF header、大小與 SHA-256；每次上傳及 guest attestation 重新核對 digest。只在新的 guest 安裝 setuid mode，host 上的編譯產物保持 0600 資料檔。
- Prepare 保存 `guest-control-v1`，核對 helper hash／owner／mode、控制目錄 owner／mode 與 live Agent Server UID 2001。初始化 terminal 後必須實際觀測 UID／GID 2000、空附加群組、零 capabilities 與 `NoNewPrivs=1`，才能開始工具執行。
- Prompt、恢復接管、核准、pause／resume quiescence、收集 result 都核對隔離。未知或不一致保持隔離／容量占用，不嘗試修補執行中的 guest，也不降級成其他 shell。
- 程序身分由 `/proc/PID/status` 的實際 UID 取得；程序的實際身分不依賴 proc 檔案 metadata。背景程序案例會實際設定不可 dump，核對其 environ 檔案 owner 為 root、實際 UID 仍為 2000，並要求暫停等待程序結束。Quiescence 同時追蹤 UID 2000 工具和 UID 2001 控制服務／固定模型的 PID identity；既有 admission barrier、live state、generation fence、未知 ACK 不重送等規則保留。
- 舊 journal 沒有隔離 revision 時，拒絕繼續執行與恢復。取消仍可停止原 VM，完整停止證據確認後才釋放容量。

## 升級

先 drain 現有 runs，處理 paused／awaiting approval 任務，保留 journal／fences／DB generation。這個切片沒有新 migration；不會把舊 active guest 原地升級。

受信任的 Linux amd64 build 環境需有 `cc` 和 static libc（例如 Ubuntu 的 `build-essential`）。由目前 package 的固定 C 原始碼建立 launcher；命令拒絕覆寫已存在的產物：

```bash
python -m agent_platform.build_terminal --output /private/path/terminal
```

將命令輸出的 `terminal_launcher_file` 與 `terminal_launcher_sha256` 加入 0600 的 connector 配置。產物也必須保持當前服務帳號所有、非 symlink、mode 0600；不要在 host 設定 setuid。來源 C 與 binary hash 可保存於部署紀錄，升級 launcher 時重新 build、pin digest 並 drain。設定範例見 [M2](M2.md)。沒有新增 host root 執行入口，也不需重新拉取本機已快取的固定 guest template。

## 驗收與剩餘範圍

八項新增 host 契約／編譯測試包含 private launcher、digest 不符、偽造 proof、舊 journal、固定工具配置及 launcher 的拒絕路徑；M0 45 項、平台共 116 項測試通過。

真實 KVM 驗收共 16 個案例：一個具備實際 approval gate 的惡意 terminal 案例（23 項檢查）、兩個 output canary 案例，以及 recovery 三例、cancel 兩例、approval 兩例、pause／resume 六例回歸。每組最後確認 VM／claims 歸零。

惡意 terminal 驗收不把 session key 傳給工具，只檢查布林結果：控制程序 environ／state／HOME／SDK workspace 不可讀、不能 signal 控制程序、不能覆寫 launcher／probe／model、未授權 read／approve／run API 被拒絕、不能提升成 root、repository／HOME plugin 及 `/tmp` Python import bait 未執行。輸出測試則先量測憑證隔離，再**刻意放入該 run 的 session canary**，分別驗證事件遮蔽和 secret diff 拒絕；這個注入只存在於測試驅動器。

證據見 [彙整](evidence/m3-isolation-2026-09-23.json) 與 [攻擊驗收](evidence/m3-isolation-attacks-2026-09-23.json)。重跑時直接持有 journal 的驅動器需先停止同 journal 的 connector，HTTP／DB 驅動器則需啟動 connector：

```bash
make platform-check
python scripts/m3-isolation-kvm.py --config /private/path/connector.json --output .artifacts/isolation-new
python scripts/m3-output-kvm.py --config /private/path/connector.json --output .artifacts/output-new
# 啟動 connector 後：
python scripts/test-postgres.py python scripts/m3-pause-kvm.py \
  --config /private/path/connector.json --origin http://127.0.0.1:17888 --output .artifacts/pause-new
```

本證據適用固定 binary／template／terminal 與可信控制服務。它不是 kernel／SDK exploit、任意新增工具或完整 production 安全保證；setuid launcher 的小型受信任程式與 owner／mode／hash gate 都是邊界的一部分。Egress allowlist／DNS rebinding／redirect／動態 policy 強制限制、model proxy／budget／usage 與 M4 production gate 仍未完成。

固定 SDK 依據：[subprocess shell 啟動](https://github.com/OpenHands/software-agent-sdk/blob/856d99d48e4b11c70c5f1cab21e7830570dbc324/openhands-tools/openhands/tools/terminal/terminal/subprocess_terminal.py)、[工具 create 參數](https://github.com/OpenHands/software-agent-sdk/blob/856d99d48e4b11c70c5f1cab21e7830570dbc324/openhands-tools/openhands/tools/terminal/definition.py)、[ambient plugin 載入](https://github.com/OpenHands/software-agent-sdk/blob/856d99d48e4b11c70c5f1cab21e7830570dbc324/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py)。
