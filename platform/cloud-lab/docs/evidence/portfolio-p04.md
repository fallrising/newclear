STATUS: PARTIAL

# P04 文件對帳證據

## Summary

P04-01～03 文件候選通過本地檢查與獨立內容審查，lead 接受；[PR #1067](https://github.com/fallrising/newclear/pull/1067) 的最終 CI、合併與遠端回讀仍待完成。本頁保留合併前檢查點，最終回執見 PR 與[任務板](../tasks/BOARD.md)，不預寫 Git 交付完成。

候選僅七份文件：能力／期限對照、元件 SUCCESS／README、根 README、任務與任務板、本證據。原 AC、SDD、runtime、schema 與政策不變。

## Verification

- 固定來源：12 份文件 SHA256、原基準到開工基準差異、8 個公開固定來源指向與檔案存在性；私人角色映射保存在私人 P04 交接證據，reviewer 亦逐份核對 — passed
- 文件範圍／相對連結：七檔 allowlist，初次192個相對連結；原 SUCCESS／BOARD 完整 byte prefix 保留，原 AC／SDD／runtime／AGENTS 未修改；公開邊界人工與字樣檢查 — passed
- `python3 scripts/check_indexes.py`，cwd repo 根、Python3.12.3、既有 OpenCC0.1.7 隔離環境：55 project-success contracts、9 llms、0 errors — passed
- `git diff --cached --check`，cwd repo 根；包含新增文件 — passed
- Codex 獨立唯讀審查：P04-01／02／03 全部符合，無阻擋缺陷，RECOMMENDATION ACCEPT；lead 檢視來源、diff 及結果後接受文件候選 — passed

審查主檔 SHA256：`625d31a1e702a539227ad775b8d5eece2e495d8271a570f2221dfb70ebbfd7e9`。審查要求補齊本頁實際證據、保留 Claude 失敗、push 刷新活動時間及合併後才結案；本頁補充不改主檔內容。後續 final staged 檢查／CI／回讀按 PR 實際回執登記。

未執行本地產品／live／benchmark；文件範圍不要求重跑歷史驗收。既有必要 GitHub Cloud Lab local implementation、project-success、llms CI 原樣保留，須通過才合併，不把未跑項目記作通過。

## Documentation

[對照](../portfolio-capability-audit.md)、[任務](../tasks/portfolio-p04.md)、SUCCESS／README 及根導航同步。來源狀態仍由原 SUCCESS／證據負責，沒有複製新產品狀態權威。

保留查核失敗：首次本機讀取新私人 source commit 時尚未 fetch，Git 找不到該版本檔案；唯讀 fetch 後以相同固定 SHA 完整讀取與核對成功，未換成舊版冒充。

## Risks and Follow-ups

可選 Claude Code 技術支持沒有完成：指定 `claude-opus-5-5`／high 的一次 CLI 啟動在 OAuth 驗證失敗，exit1、0.415秒，沒有技術回覆、modelUsage 空。CLI init 的 tools／MCP／skills 為空，仍列四個內建 plugins；不宣稱 OS 隔離或所有 plugins 不存在。沒有重試、登入設定變更、委派或靜默換模型；已告知 owner 並由 Codex reviewer 完成必要獨立審查。provider 請求數與帳務未知，不能從 modelUsage 空推算零費用。

當前 live／真人登入未知。CA 尚未實作，Edge Ops／私人來源原 qualification 不提升；完整產品仍待 owner 驗收。Git 交付待必要 CI／正常合併／回讀，最後依 repo 規則以 board-only PR 填實際合併時間；不自行啟動下一里程碑。
