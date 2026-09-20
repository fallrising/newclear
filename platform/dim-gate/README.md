# dim-gate

以 CMDB 為核心的企業一站式運維自助平台前端，涵蓋 AWS、Aliyun 與自建機房，讓研發、運維與平台管理員透過同一組資料完成各自的工作。

**目前狀態：M0 工程基礎實作，驗收與 PR 狀態見 [STATUS](docs/STATUS.md)。** 可在本機操作三中心摘要、示範身分、演示時鐘、保存與重置；完整業務主線仍屬 M1–M5。沒有線上部署或真實雲端連線。

| 工作中心 | 要回答的問題 |
| --- | --- |
| RD Center | 我的應用在哪裡運行？如何申請環境、發布、觀察與回滾？ |
| Ops Center | 哪些資源承載哪些業務？變更與故障影響誰？如何處理？ |
| Admin Center | 誰能看什麼、做什麼？平台目錄與服務能力如何治理？ |

第一版的目標是可操作的示範產品：使用可重置、有狀態的模擬資料，不需要 AWS／Aliyun 帳戶或後端服務。規劃主線為「目錄與權限配置 → 資源納管 → 環境申請與審批 → 交付 → 發布 → 告警 → CMDB 影響定位 → 回滾」。M0 只有三來源各一筆 CI、兩個應用與四個環境；不代表完整 v0.1。

## 本機執行

使用 Node **24.18.0**、pnpm **11.18.0**，在本目錄執行：

```sh
pnpm install --frozen-lockfile
pnpm dev --mode demo
```

開啟 `http://127.0.0.1:5173/dim-gate/`。Production demo：

```sh
pnpm build --mode demo
pnpm preview --port 4173
```

開啟 `http://127.0.0.1:4173/dim-gate/`；深連結 `/dim-gate/guide` 可刷新。`.env.demo` 明確設定 `VITE_DATA_MODE=demo`，缺少模式或指定 live 會顯示啟動錯誤。Service Worker 與 Web Locks 需要 HTTPS 或 localhost；不支援 Web Locks 的瀏覽器會明確拒絕啟動。

在頁首切換四個 persona，比較獲授權的中心與資源摘要。在「示範導覽」前進時鐘、切換中心／身分、刷新，觀察進度保留；重置需確認，僅影響本分頁。損毀或不相容的 snapshot 提供明確重置／暫存記憶體選項，不會默默清除。暫存模式刷新後不保留進度。

## 驗證

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm check:docs
pnpm check:contracts
pnpm check:ci
pnpm build --mode demo
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

`pnpm generate:contracts` 從共用 Zod 產生 [OpenAPI](docs/openapi.json)；`check:contracts` 拒絕漂移與失效 reference。72 個 operation 中只有標記 M0 的 14 個可執行，其他為後續契約。E2E 使用 production build 與 `/dim-gate/` base path；報告在 `playwright-report/`，截圖／失敗 trace 在 `test-results/`，CI 保存 30 天。獨立審查與 M0 接受決策另存於 root `.team/`。

## 文件入口

- [開發啟動 prompt](DEVELOPMENT_PROMPT.md)：後續agent的固定入口，先核對進度，再接續最早未完成里程碑。
- [開發恢復協定](docs/DEVELOPMENT_PROTOCOL.md)：進度權責、task／evidence、重入、交接及分叉規則。
- [主控計畫](../../.team/PLAN.md)：dim-gate任務與接受決策、目前可恢復位置。
- [SDD 總綱](SDD.md)：目標、範圍、架構、不變量與閱讀順序。
- [詳細規格](docs/sdd/README.md)：頁面、資料模型、流程、權限、前端、API／Mock、驗收與決策。
- [開發狀態](docs/STATUS.md)：目前交付證據與下一個里程碑。
- [開發約定](AGENTS.md)：後續實作的範圍與文件維護方式。

下一個開發session可使用：「請讀取 `platform/dim-gate/DEVELOPMENT_PROMPT.md`，依啟動與恢復協定核對目前進度，接續開發。」若要實驗不同版本，明確提供branch／variant；入口本身不保存會過期的最新進度。這是一套由agent執行的文件協定，目前没有常駐排程器或自動恢復程式。

## 技術方向

M0 已鎖定 React 19.3、TypeScript 5.9.3、Vite 8.3、Tailwind 4.3、Radix/shadcn 風格可維護元件、React Router、TanStack Query、Zod 4 與 MSW 2；精確 patch 版與傳遞依賴見 package.json／pnpm-lock.yaml。Table、React Hook Form、React Flow 與 Recharts 在對應里程碑有實際需求時再加入。

本項目是 `fallrising/newclear` 中獨立的前端 component；未來透過 API adapter 接入後端。`platform/prism`、`specs/fleet` 與 `apps/cloudform` 只作可能的整合參考，不是第一版啟動依賴。授權沿用 repository 根目錄 MIT。
