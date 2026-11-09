# Pi hook 身分與 session 邊界

固定 lab 任務只接受原工位、Pi／DeepSeek 固定模型及當代 token 的同 session 事件。一般上游允許的 session 切換，在此有界任務中被拒絕；合法一次性同 session 重新連接仍可使用。沒有修改 vendor。

## 驗證入口

在元件目錄執行；需要 SETUP 的固定 Pi／Office 與 macOS 環境。依序執行，不並行佔用執行鎖：

```sh
python3 scripts/office_dispatch.py run pi --execute --check-question
python3 scripts/office_dispatch.py run pi --execute --check-resume
python3 scripts/office_dispatch.py run pi --execute --check-host-restart
python3 scripts/run_pi_work.py --check-startup
```

問答／啟動不產生模型請求；重連／host 重啟各沿用一次本機 429 建立六筆歷史，外部模型請求為零。startup 參數只在直接 runner 支援。問答及恢復結果為 stopped；啟動 runner 的 completed 只代表啟動檢查，`model_inference_verified` 仍為 false。

問答、啟動各驗 11 種拒絕；重連再驗舊 token，共 12 種。真正 HTTP 回應與工位 info／session／任務／用量／已接受 hook 數逐案比較不變。正常 Pi 的原生 start、question、done 與重新連接仍通過；沒有發出會被接受的合成完成事件。Python 重新驗證嚴格證據格式，來源檔納入 snapshot 及 grant source binding。

## 本輪結果與限制

268 項元件測試（200 Python、68 Node）、21 項 repo 契約測試通過。另直接呼叫固定上游 normalizePiHook 與 lab parser 比較 1680 組輸入，結果一致。四輪真實驗收分別追蹤 33／24／99／41 個程序，全部退出、無外層補殺、鎖釋放；host 重啟含三代 host、Chrome 中斷顯示／刷新及明確恢復。沒有 Strata 推論或產品付費 grant。

持有目前有效 token 的一方仍可能送出合法的同 session 普通事件；本輪沒有 nonce／序列協定，不宣稱能防止此類偽造。僅完成 AC-08／11 的 Pi 子集；其他 provider、遠端串流續做、整棵程序樹隔離及完整 MVP 仍 pending。

[實際指導與分工](T26-TECHNICAL-GUIDANCE.md)、[白名單證據](evidence/pi-hook-boundary-2026-11-07.json)、[任務板](tasks/BOARD.md)。公開證據不含 token、session、私有路徑或原始日誌。
