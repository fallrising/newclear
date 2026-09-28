# S0 本地執行證據

日期2026-09-28；base `05809fc951ef929665e798846aba348d6c9071a5`。環境為隔離Linux開發容器，Node v22.16.0 / npm10.9.2 / global TypeScript5.8.3。

不是SSH clone：容器DNS無法解析github.com或registry.npmjs.org，repository讀寫使用GitHub connector。本地component工作樹只包含本次 authored files，原repo內容由remote base tree保留。

| 命令／驗證 | 實際結果 |
| --- | --- |
| `npm run check` | PASS：8個operation契約形狀檢查，21tests / 0fail / 0skip |
| `tsc -p backend/tsconfig.json` | PASS：使用global5.8.3，不冒充lock內7.0.2 |
| 獨立mock Agent經HTTP、SQLite檔案重啟 | 包含於21tests：seed36→replay36→offline→recover37→restart37→reset0 |
| Duplicate／conflict競爭 | 包含於21tests：12個重送僅一個winningreceipt；兩份不同內容一個200一個409 |
| UI npm install/build、Playwright | NOT RUN locally：npm DNS blocked |
| Wrangler/workerd/D1local | NOT RUN locally：npm DNS blocked；rootCI另有gate |
| Cloudflare／real host／bootstrap | NOT RUN：沒有授權，不屬本切片 |

其他測試包含：範圍／大小／uint64／unknownfields／duplicateJSONkeys、未驗權不讀body、跨workspace、latebackfill、null、不啟用controlchannels、transactionrollback、storageerror不回成功、historyquery界限、4096容量上限。

本地SQLiteadapter並非完整D1emulator。沒有独立reviewer、真實安全認證、SLA或費用結論。前端截圖與真正localworkerd證據需由對應CI成功結果補充，不捏造。
