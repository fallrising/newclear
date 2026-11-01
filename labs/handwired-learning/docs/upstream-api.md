# HW-0：固定上游 API 支援表

核對版本：[chenglou/handwired `257856e3b221140acb4cc4460626b850c0bd4ff1`](https://github.com/chenglou/handwired/tree/257856e3b221140acb4cc4460626b850c0bd4ff1)。
核對與執行日期：2026-10-22（Asia/Singapore）；Node v24.14.0、Linux、CPU。

結論：此版本具有通用 CPU 前向與 `Circuit.backpropagateReference`，本例不需要解析梯度替代。
參數 a、b 必須放在 source cells；若寫成 `affine([[x, a]], b)` 的建圖常數，就沒有 a、b 的獨立 wire 可取梯度。

| 能力 | 固定版本入口 | 核對結果與限制 |
| --- | --- | --- |
| 建圖 | [core L237、L263](https://github.com/chenglou/handwired/blob/257856e3b221140acb4cc4460626b850c0bd4ff1/src/runtime/numeric-ui-core.ts#L237)：`new Circuit(sourceSize)` | 建圖時指定 source cell 數量；建圖與執行分開。 |
| 輸入／參數 | [L399](https://github.com/chenglou/handwired/blob/257856e3b221140acb4cc4460626b850c0bd4ff1/src/runtime/numeric-ui-core.ts#L399)：`source(index)` | x、a、b 各一個 wire，執行時填入 `Float32Array([x,a,b])`。 |
| 常數、加法、乘法 | [L406–435](https://github.com/chenglou/handwired/blob/257856e3b221140acb4cc4460626b850c0bd4ff1/src/runtime/numeric-ui-core.ts#L406)：`constant(value)`、`affine(terms,bias=0)`、`multiply(left,right)` | `affine([[multiply(a,x),1],[b,1]])` 建出本例；wire 與係數不同。 |
| CPU 全 wire 前向 | [L649](https://github.com/chenglou/handwired/blob/257856e3b221140acb4cc4460626b850c0bd4ff1/src/runtime/numeric-ui-core.ts#L649)：`evaluateReference(source)` | 回傳 source 與所有中間結果；可供 backward 使用。 |
| CPU tensor evaluator | [L751–781](https://github.com/chenglou/handwired/blob/257856e3b221140acb4cc4460626b850c0bd4ff1/src/runtime/numeric-ui-core.ts#L751)：`evaluateTensor(source)`、`createTensorEvaluator(roots)` | 後者編譯一次，回傳 roots 順序的值；buffer 下次呼叫會覆寫，不能把它當作全 wire backward 輸入。 |
| 參數梯度 | [L654–746](https://github.com/chenglou/handwired/blob/257856e3b221140acb4cc4460626b850c0bd4ff1/src/runtime/numeric-ui-core.ts#L654)：`backpropagateReference(values, outputGradients, options={})` | 兩個輸入陣列均須為全 wire 長度；本例在 y wire seed=1，回傳 da=x、db=1、dx=a。 |
| 梯度語義 | 同上 L666、L685–727 | 將 FP32 算術當實數微分，ReLU 轉角斜率為 0；boolean/index 有非零傳入梯度時預設拒絕。可明示 surrogate 選項，但本例不使用；不是任意 JS 可微編譯器。 |
| demo 訓練 | [trainable-geometry L703](https://github.com/chenglou/handwired/blob/257856e3b221140acb4cc4460626b850c0bd4ff1/src/learned-gallery/trainable-geometry.ts#L703) | demo 計算 loss seeds 並呼叫通用 backward；不表示 core 自帶本 lab 的 optimizer、loss 或收斂保證。 |
| 授權與載入 | [LICENSE](https://github.com/chenglou/handwired/blob/257856e3b221140acb4cc4460626b850c0bd4ff1/LICENSE)、[package.json](https://github.com/chenglou/handwired/blob/257856e3b221140acb4cc4460626b850c0bd4ff1/package.json) | MIT（Cheng Lou, 2026）；副本／實質部分須保留授權與著作權聲明。上游是 private ESM package；本例直接 import 無其他 imports 的 core TS，不安裝 Bun 或套件。 |

## 最小範例與重跑

[api-probe.mjs](../examples/api-probe.mjs) 是可執行範例；[api-probe.test.mjs](../tests/api-probe.test.mjs) 是使用真實固定上游的五項測試。
先把指定版本的 `src/runtime/numeric-ui-core.ts` 與 `LICENSE` 下載到 repo 外，再設定 `HANDWIRED_ROOT`。
以下從 repo 根目錄執行，需要既有 Node 24.14.0、Python 3 與可存取公開 GitHub 的 `gh`，不安裝依賴：

```bash
python3 /home/ckc/test/codex/agent-workspace/workspace.py run handwired hw0-reproduce -- bash -eu -c '
  export HANDWIRED_ROOT="$AGENT_ARTIFACTS_DIR/upstream"
  mkdir -p "$HANDWIRED_ROOT/src/runtime"
  gh api "repos/chenglou/handwired/contents/src/runtime/numeric-ui-core.ts?ref=257856e3b221140acb4cc4460626b850c0bd4ff1" -H "Accept: application/vnd.github.raw+json" > "$HANDWIRED_ROOT/src/runtime/numeric-ui-core.ts"
  gh api "repos/chenglou/handwired/contents/LICENSE?ref=257856e3b221140acb4cc4460626b850c0bd4ff1" -H "Accept: application/vnd.github.raw+json" > "$HANDWIRED_ROOT/LICENSE"
  node --test --test-isolation=none labs/handwired-learning/tests/api-probe.test.mjs
  node labs/handwired-learning/examples/api-probe.mjs
'
```

其他機器沒有本 workspace launcher 時，將 `HANDWIRED_ROOT` 設到自己的外部來源目錄，以同樣的兩個 Node 命令執行。
範例在 import 前驗證 core SHA-256 為 `75da2a13f39720e34b1e440533460435ead0af9a88fccad8c94e94a816dafa21`；缺檔或來源漂移會失敗，不會下載最新版或替換成 mock。
來源目錄應保持不變，這是固定可信來源的 API probe，並非不可信程式碼執行沙箱。

九點 x=-20,-10,…,60 的 `js`、`tensor`、`reference` 皆為
`[-27,-14.5,-2,10.5,23,35.5,48,60.5,73]`；da=x、db=1、dx=1.25。
另測非整數輸入與不同係數，前向允差維持 SDD `1e-5 + 1e-5×abs(reference)`，梯度允差 `1e-4 + 1e-4×abs(expected)`。
測試也驗證同一圖更新 source 參數、boolean 預設拒絕 backward，以及漂移來源在 import 前被拒絕。

Node 24 以內建 TypeScript type stripping 載入原始 core，沒有 type-check 或瀏覽器建置。
這是 HW-0 的歷史範例範圍。後續 HW-1 已用 Node 內建 stripping 建置含 MIT 的離線頁；HW-2 已以同一固定 core 的 backward 驗證學習。現況與證據以 [SUCCESS](../SUCCESS.md) 為準，HW-3 真人試用仍 pending。

## 證據

執行命令、先紅後綠與限制見 [HW-0 report](../tasks/450-hw0/report.md)。
專用 CI 使用固定上游 SHA、Node 24.14.0，執行相同測試與範例；失敗時不改用其他版本。
