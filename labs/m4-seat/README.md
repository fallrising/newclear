# M4 48GB 單人座位

> 主線、驗收條件、剩餘缺口與可用版本：[SUCCESS.md](SUCCESS.md)。


> 有界運行方案；投入與文件檔位尚未分級。見 [Portfolio](../../PORTFOLIO.md) 與[文件政策](../../docs/portfolio-doc-tiers.md)。

把一台 **M4 Max、48GB** 的 MacBook Pro 訂成單人、開著蓋用的推論座位。機主已確認晶片是 M4 Max；對應配置是 16 核 CPU、40 核 GPU、廣告頻寬 546 GB/s。運行組合、記憶體上限與驗收清單在 [方案](docs/plan.md)。

這份文件沒有 runtime，也沒有在這台筆電上重跑計時。日常模型的 tok/s 用的是另一台同配置 M4 Max 48GB 的公開碼錶。Strata 沒有這台配置的公開計時，不借用 M4 Pro 的 25 tok/s，也不借用 128GB Max 的 68–111 tok/s。

## 決定

預設常駐一顆放得進記憶體的 4-bit MoE（Qwen3.6-35B-A3B）。要 Qwen3.8-Flash-Next 時才切到 strata-mlx，專家工作集壓在 24GB。Jev 沒有可下載的權重；資料不能出門時用 Kev-4B，要更接近 Jev 再單獨載 Kev-9B。三種座位同時只開一種。

## 不做

- 不把這台筆電闔蓋當 24/7 節點。
- 不把 M4 Max 128GB 上的 68–111 tok/s 寫成這台的目標。
- 不同時常駐 Strata 與 Kev-9B，也不把 Kev-27B 放進 48GB。
- 不改 [pg-jev-router](../pg-jev-router/README.md)。那個 lab 可以指向任何 `POST /v1/systemone`。本機 Kev 以後可以當那個 server；接線不在這份方案裡。
