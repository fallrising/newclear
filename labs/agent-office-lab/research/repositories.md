# GitHub 調研

查證：2026-10-31。以下是文件及部分原始碼分析，沒有執行這些 Office 專案。查詢包含 `"agent office"`、`pixel agents office opencode`、`Star Office UI`、`grok cli`。

| 候選 | 已查到的能力 | 本案判斷 |
|---|---|---|
| [AgentSystemLabs/agent-office](https://github.com/AgentSystemLabs/agent-office) | 3D／lite 介面、PTY、工位、任務、worktree；原始碼確有 OpenCode、Grok、Pi adapters | 最接近三種 CLI 要求，優先做本機驗證；功能很多，需要限制入口 |
| [ddx-510/opencode-pixel-office](https://github.com/ddx-510/opencode-pixel-office) | README 描述 OpenCode plugin／Claude hooks → HTTP → WebSocket 看板 | 適合活動可視化；Grok、Pi 與完整派工流程未在已讀文件中證實 |
| [ringhyacinth/Star-Office-UI](https://github.com/ringhyacinth/Star-Office-UI) | 狀態推送、像素辦公室、多 agent 加入、OpenClaw 整合 | 可參考呈現方式；還需要補真正的 CLI 執行與生命週期控制 |
| [ajsahni/agents-office](https://github.com/ajsahni/agents-office) | 部門、任務、Claude 驅動流程；README 宣告非商用及額外整合限制 | 需求耦合 Claude，不作本案程式碼基底；未進行授權法律評估 |

## 選型

先以 AgentSystemLabs/agent-office 的固定 commit `852e2ab28c4f3f31bffdf4b20353bd119c9d3270` 做短期驗證。其 [LICENSE](https://github.com/AgentSystemLabs/agent-office/blob/852e2ab28c4f3f31bffdf4b20353bd119c9d3270/LICENSE) 為 MIT；若沿用程式碼保留授權與署名。沒有因此認定其所有相依資產也具有相同授權。

已讀的 provider 原始碼：

- [OpenCode adapter](https://github.com/AgentSystemLabs/agent-office/blob/852e2ab28c4f3f31bffdf4b20353bd119c9d3270/src/server/providers/opencode.ts)：透過 `OPENCODE_CONFIG_CONTENT` 合併事件插件，回報 session、permission、question 等事件。
- [Grok adapter](https://github.com/AgentSystemLabs/agent-office/blob/852e2ab28c4f3f31bffdf4b20353bd119c9d3270/src/server/providers/grok.ts)：以專用 `GROK_HOME` 放 hooks，使用 `--no-alt-screen` 與 session 參數。該實作包含 `--trust`，實作 lab 時須明確處理首次工作目錄信任。
- [Pi adapter](https://github.com/AgentSystemLabs/agent-office/blob/852e2ab28c4f3f31bffdf4b20353bd119c9d3270/src/server/providers/pi.ts)：使用 CLI extension 與每工位 session 目錄。文件要求 Pi 0.87.1+；仍需用實際版本驗證。

採用既有 PTY／插件／hooks 路徑完成 MVP；不為了統一而把三者重寫成同一協定。未來若需要全程機器控制，可評估 Pi RPC、Grok ACP、OpenCode server API。

## 名稱與版本注意

Grok CLI 有兩個不同產品，不能混用命令列參數：

- 官方 Grok Build：官方文件的 `grok -p ... --output-format streaming-json`；Agent Office 的現有 Grok adapter 對應這一類 CLI。[官方文件](https://docs.x.ai/build/cli/headless-scripting)
- `superagent-ai/grok-cli`：社群專案、`grok-dev` 套件、`GROK_API_KEY`、`--prompt ... --format json`。[專案 README](https://github.com/superagent-ai/grok-cli)

使用者已指定「grok cli」；具體實作尚待回答，SDD 暫採官方版，社群版需要獨立 adapter，不宣稱已相容。

Pi 的舊 `badlogic/pi-mono` 已重新導向 [earendil-works/pi](https://github.com/earendil-works/pi)。目前的 [RPC 文件](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) 區分 `prompt` 接受、`agent_end` 與 `agent_settled`；後者才表示不會再自動繼續。

[DeepSeek 的 Pi 整合說明](https://github.com/deepseek-ai/awesome-deepseek-agent/blob/main/docs/pi_mono.md) 可作設定起點，但模型名以 [當前 API 文件](https://api-docs.deepseek.com/en/) 為準：本次查到 `deepseek-flash` 和 `deepseek-v4-pro`。不直接沿用舊教學的模型名、價格與 context 上限。

以上搜尋由 Codex 使用連接的 GitHub 工具及官方網站完成。本次 Strata 尚未成功啟動，沒有把搜尋結果歸因給本地模型。
