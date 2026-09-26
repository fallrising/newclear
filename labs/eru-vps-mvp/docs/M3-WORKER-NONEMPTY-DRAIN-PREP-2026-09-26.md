# ERU-009 非空 worker drain 前置（2026-09-26）

狀態：本機 planner slice 已交付，ERU-009 仍進行中。這是 ERU-012 已管理、無狀態 HTTP app 的離線 drain 計畫器；沒有 SSH、Eru CLI、部署、移除、fence 或元件重裝行為。

## 規劃契約

執行：

```sh
python3 scripts/worker_drain.py --target worker-4 --input PATH_TO_LOCAL_DRAIN_INPUT.json
```

輸入 JSON 必須剛好包含：

- `snapshot`：唯讀 cluster snapshot，含 pods／nodes／workloads；host facts 只以摘要雜湊進入輸出 plan。
- `apps`：target 上每個 ERU-012 logical app 的完整當前 desired spec。
- `destinations`：每個 logical app 明確指定一台不同的 worker；不自動挑選或平均分配。
- `health_ok` 與 `consistency_issues`：離線呼叫端的 preflight assertion。它們不是 live evidence；之後的執行器必須重新採集。

planner 要求每個來源 spec 都是 ERU-012 v1、stateless、digest-pinned、replica 數與目前 workload IDs 完全相符，且所有 target workload 恰好被其中一個 spec 認領。來源 app 若有舊 revision、部分 replica、錯誤 owner／digest、未知 workload，或 destination 不可用，整份 plan 都會 blocked。替代 revision 以改變 node 後的 spec digest 與 deterministic Eru appname 綁定。資源容量仍由 Eru core create admission 決定；planner 不宣稱有容量預測。

輸出只包含 review 所需的 IDs、owner／digest、destination、snapshot 摘要與 plan hash，不複製原始 host inventory 或 app command。輸出含 workload IDs，請與輸入 spec 一樣留在本機 private storage；命令只寫 stdout，不會自行存檔。

## 分階段安全順序

1. 重採健康、consistency、target identity 與 workload snapshot。
2. 先建立所有 destination revisions，使用既有 ERU-012 executor 核對 exact owner／digest／replica／node，並逐個通過 HTTP readiness。
3. 所有替代 revisions 都 ready 之前，保留 target 的全部來源 workloads。
4. 再透過既有 exact-ID cleanup 清除來源 workloads；每次回覆不確定先 reconcile，不重播。
5. 確認 target workload、container、task 與資源使用皆為零後，才建立一般空 worker component-reinstall plan。
6. 任一 replacement 不確定時保留來源 revisions；若精確 cleanup 部分完成，target 仍留在 fenced／不可重裝狀態，逐筆唯讀 reconcile。不可使用 worker component restore 覆蓋 workload state，也不可 blanket reset。

## 限制與下一步

目前所有 plan 都固定 `executable: false`。沒有多 app staged executor／cross-app recovery coordinator、即時 preflight adapter、遠端 fence／cleanup 接線或 live journal reconcile。planner 只支援 ERU-012 managed stateless apps；legacy／foreign／stateful workloads 會阻擋，需先人工分類與另案設計。空 target 一律走現有元件重裝路徑。沒有連 VPS，沒有使用 private inventory，沒有跑 E2E。

10 個 fake-snapshot 測試覆蓋完整多 app mapping、未知 owner／workload、partial replica、舊 revision、destination／preflight gate、空 target、穩定 hash 與來源保留政策。下個本機切片應完成多 app stage coordinator 與唯讀 recovery，維持來源先於新 revision readiness 不刪除的保護；所有 VPS E2E 仍留到本機開發收尾後。
