# FE Review — 設計 session 提示詞

這是開新 session 撰寫 `DESIGN.md` 時交給 agent 的提示詞。它屬於第 1 輪（文檔先行）：只寫文件，不啟動 UI、不修改程式碼。可以整段貼進新 session，也可以只說「依 `docs/fe-review/DESIGN-PROMPT.md` 繼續」。

---

你要為這個 repository 中處於第 1 輪的 fe-review 元件撰寫 `DESIGN.md`。

## 先讀

1. [PROTOCOL.md](PROTOCOL.md)：第 0 節（執行環境與耦合）、第 1 節（三輪節奏、`REVIEW.md` 與 `DESIGN.md` 規則）、第 4 節（修改範圍）。
2. [DESIGN-TEMPLATE.md](DESIGN-TEMPLATE.md)：`DESIGN.md` 的結構。
3. 這個 repository 的 `AGENTS.md`（若有）與 [README.md](README.md) 的元件清單。
4. 每處理一個元件，先讀它的 `fe-review/REVIEW.md`、`PROMPT.md`、`targets.json`，再讀元件自己的 `README.md`、`AGENTS.md`、SDD／ADR 與相關原始碼。

## 選擇元件

- 只處理 `REVIEW.md`「目前輪次」為第 1 輪、且還沒有 `DESIGN.md` 的元件；標示「暫緩（退役）」的元件跳過。
- 依下方「本 repository 的順序」逐一處理。一個 session 做 3～5 個元件即可，品質優先。

## 每個元件的做法

1. 對照原始碼確認 `REVIEW.md` 的矛盾點仍然成立；已不成立的直接改寫或刪除（不留過期描述）。
2. 依模板寫 `DESIGN.md`：
   - 「已決定」的項目直接作為依據。
   - 仍「待擁有者決定」的項目，採用 `REVIEW.md` 的建議作為**假設**，寫進「依據 → 假設」，不要自行改成已決定。
   - 每個修改項目都要有 file:line 的現況、明確的修改範圍、驗證方式與回滾方式。
   - 寫出「不做的事」，讓第 2 輪的範圍有邊界。
3. 若設計發現 `PROMPT.md` 或 `targets.json` 的描述不準確，一併修正。
4. 更新 `REVIEW.md`：「目前輪次」寫明 `DESIGN.md` 已草擬、待確認；「相關 PR」加上本次 PR。

## PR

- 一個元件一個 PR（彼此綁定的元件可以合併，例如本 repository 順序中註明的組合）。
- PR 說明包含：本次處理的元件、`DESIGN.md` 的修改項目摘要、**需要擁有者確認的假設清單**、修正過的 `REVIEW.md`／`PROMPT.md`／`targets.json` 內容，以及執行過的檢查（連結檢查、元件自己的文件檢查）。
- 除非擁有者在 session 中明確要求，不要自行合併。

## 不要做

- 不修改元件的程式碼、測試、依賴或 CI；不啟動 UI；不跑 `capture.mjs`。
- 不把「待決定」改成「已決定」；不在文件中寫入秘密、token 或真實資料。
- 不為退役元件撰寫設計。

## 本 repository 的順序

1. A 檔（active）：`products/kith`、`platform/dim-gate`、`products/hai-taskboard`、`platform/agent-platform`、`apps/cms-scaffold`、`platform/ice-maker`。
2. B 檔：`specs/fleet`（修改不得改變對外契約）。
3. C 檔（休眠，依 [PORTFOLIO.md](../../PORTFOLIO.md)「Owner override 2026-09-27 — fe-review 休眠元件」可修改前端，但不做新功能或 major 升級）：`systems/ojbquay`、`products/goku`、`products/phark`、`apps/flowshot` 與 `apps/loom`（兩者的 Tauri IPC 解耦方式相同，可同一個 PR）、`gateways/pokercase`、`systems/clarkq`、`platform/fanzloud`。
4. 跳過 D 檔（退役）：`apps/cloudform`、`labs/aweshore`、`tools/streaming-converter`。
