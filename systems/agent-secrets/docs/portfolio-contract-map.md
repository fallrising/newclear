# Agent Secrets 的首個業務操作候選

本頁供選定第一個 connector 時審查。狀態為 Proposed。

候選操作 read_service_health 讀取一個獲准服務資源的健康狀態。核准綁定該資源及指定動作。查詢既有 operation 的處理狀態是另一項操作。若資源不存在、別名錯誤或呼叫者無權，三種情況回傳相同拒絕，下游呼叫數均為零。操作介面只接受固定資源與參數，不提供 catalog、存在性探測、原始秘密、任意 URL、header 或 shell。候選輸出白名單為服務健康狀態 status、非敏感介面版本 revision 及本次 operation_id。拒絕結果不透露憑證是否有效或過期。

產品驗收仍依 [SUCCESS](../SUCCESS.md) 的 AC-101～107。Store 相容性與密文驗證、MCP 互通、可信核准、單次消耗與撤銷、輸出與程序隔離、備份還原均待驗證。併發時須驗證同一單次 grant 至多消耗一次。重複 request_id 查回原 operation。若請求可能已送出而回應遺失，保留 UNKNOWN 與既有消耗紀錄，由權威紀錄對帳。第一個 connector、控制儲存與隔離方案仍待決策，見 [SDD](SDD.md) 與 [ADR](ADR.md)。
