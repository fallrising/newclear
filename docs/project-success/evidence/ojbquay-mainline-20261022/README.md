# ojbquay 主線資格證據（2026-10-22）

來源 `71ac5f775f9c93d679a2b0b3896ddce0d713594a`，checkout 無未提交變更。主機：Linux 4 vCPU／15 GiB、Docker 29.1.3，沒有本機 JDK 與 Compose。

- [qualify.sh](qualify.sh)：依序執行全部檢查；每步完整輸出存在執行機，這裡保留 [summary.txt](summary.txt)（每步 PASS/FAIL 與時間）及 [results.txt](results.txt)（各步關鍵結果行）。
- [extra.sh](extra.sh)：AC-01 loaded version 收斂時間與 AC-07 停 console-api 後的發送／交付。
- 執行環境：Compose 步驟在 [runner.Dockerfile](runner.Dockerfile)（`docker:29.1.3-cli` 加 bash/curl/make）內以本機 uid 執行；Gradle 用 `eclipse-temurin:25-jdk` 加 Testcontainers；瀏覽器用 `mcr.microsoft.com/playwright:v1.62.0-noble`；Go 1.25.0。

| 步驟 | 結果 | 對應 AC |
| --- | --- | --- |
| `./gradlew clean build --no-build-cache` | BUILD SUCCESSFUL，153 JUnit、0 failure／skip | AC-04/05/06/08/09，AC-01/03/07 單元與整合層 |
| `sdk/go`：`go vet`、`go test -count=1 ./...` | PASS | AC-03 |
| `make validate-deploy` | PASS | AC-11 |
| `KEEP_STACK=1 make e2e` | 8/8 PASS，11 services | AC-01/02/11 |
| `extra.sh` | loaded version 561 ms；停 console-api 後 ACK 與精確 payload | AC-01/07 |
| `pnpm e2e:stack`（真 stack，1280 px） | 1 passed | AC-10 |
| `pnpm test`、`pnpm build`、mock Playwright | 5/5、build OK、1 passed | AC-10 |
| `e2e/pull_share.sh` | `GO_INTEROP_OK`、`INTEROP_OK` | AC-03 |

同一 checkout 先前一次執行（`34c330e2`）有兩個測試的時序競態失敗，已在 `71ac5f77` 修正後重跑全部步驟。
