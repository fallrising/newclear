# 交接與驗證

日期：2026-11-02。任務：[T-0959](tasks/BOARD.md)／[issue #959](https://github.com/fallrising/newclear/issues/959)。
分支：`docs/agent-secrets-sdd-20261102`；基準：`244c7f7b416508aedd8f5f8d4a082ae2bb17d022`。
認領 commit：`134075f436a0bf04ecf5248a179b010bc435afa2`。

## 已準備

新專案文件、`docs/SDD.md`、固定上游來源與差異、Proposed Agent Broker、SUCCESS、ADR、任務板及索引。沒有實作 Store／Broker、複製上游程式、安裝依賴、部署、真憑證操作或合併。

## 檢查與環境限制

終端 `git clone --depth 1` 失敗：`Could not resolve host: github.com`（exit 128）。GitHub App 已成功讀取 repository 與寫入認領；這不是 repository 權限不足。後續使用 Git data API 基於最新基準建立 tree／commit，再以非 force 且 expected SHA 的 fast-forward 更新工作分支。

本機只可用已讀檔案重建有界文件工作區；不能把它稱作完整 clone，不能以部分 checkout 宣稱全 repo 檢查通過。完整 `--write-index`／`check_indexes.py` 依賴其餘元件，需乾淨完整 checkout；根索引以既有行保持不動、加入新元件的同一 renderer 格式，並由 PR CI 核對。

已跑局部驗證：`python3 scripts/check_project_success.py --projects systems/agent-secrets` 通過（1 個元件，不是全 repo）；來源 validator blob 核對為 `55b07757ec3f54c79aaf18a0ed7f0b18d98ccd79`。另檢查 13 個候選檔、12 組 SDD／SUCCESS AC 定義、47 個相對連結（其中 2 個外部元件目標已由固定 GitHub 基準讀取核實）、3 個新目錄 README、inventory 僅新增 1 項及 PROJECTS 新列與原 renderer 相符；全部通過。

既有 README／PROJECTS／inventory 的重建內容已逐一比對遠端 blob SHA，只有本專案所需新增項；這不是全量重建索引的證據。完整 PR CI、遠端檔案與 head 回讀結果記在交付 PR，尚未看到成功結果前不宣稱通過。runtime、上游測試、MCP 真宿主、Cloudflare、金鑰輪替／還原、Agent 對抗與獨立安全審查均未執行。

## PR 與 CI 回讀

[Draft PR #961](https://github.com/fallrising/newclear/pull/961) 已建立；規格 commit 為 `a1a25de73e459e18fddb4bad4d02518dd2c4a534`，以 GitHub App 非 force／expected SHA 更新分支。與 main 比較確認原始提交只改 13 個文件與索引檔，沒有 runtime 或 workflow 變更。

讀回專案 tree `5d6bde2f69c8245ad59f564e404f2b0164e7fd16` 與本機 10 個專案檔的 Git tree hash 相同；SDD blob `8f05bf449f102fd595a2f1ace878cd568af350f3` 相符。這證明該規格 commit 的遠端內容與已驗文件一致，不是尚未產生的最後 head SHA。

初次 [Project success contracts run 41426446370](https://github.com/fallrising/newclear/actions/runs/41426446370) 在完整 checkout 執行：20 個驗證器單元測試通過、53 項 project success／inventory／PROJECTS 契約通過；但 `check_indexes.py` 的 llms 導航失敗，具體錯誤為 `root index does not link catalog component systems/agent-secrets`。初次 llms.txt CI 也回報 failure，不能把此輪 CI 稱為通過。

修補為根 `llms.txt` 增加一個指向本專案 README 的 spec-only 導航項，沒有宣告可呼叫 capability。候選變更總數因此為 14 個檔案。這是修正本次遺漏，不變更 validator 或繞過 CI；歷史失敗保留。最終 head 的全倉回歸結果及回讀以 [PR checks](https://github.com/fallrising/newclear/pull/961/checks) 與交付留言為準，本紀錄不預先宣稱修補後 CI 成功。

## 接續入口

先讀 [SUCCESS](../SUCCESS.md)、[SDD](SDD.md)、[ADR](ADR.md)、[來源](SOURCES.md)。owner 審閱本輪文件後，再另行批准 M1；M2 另需身份、權威儲存、審批與 connector 決策。不得將「後續可以開發」視作現在授權。

PR 保持 Draft。任務列在合併前保持 in_progress／end 空白，產品 mainline incomplete、usable_tag none。後續實際 head SHA 與 PR checks 以 GitHub 回讀為準，不能在同一 commit 內偽造自引用 SHA。
