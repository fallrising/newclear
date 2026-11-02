# PP1c PostgreSQL helper 的隱含 volume 修訂提案

狀態：**PENDING OWNER DECISION**。T-0351；這不是11月2日先前兩項批准的一部分。B受影響的 helper/capture 驗收暫停，C/D未開始。本文不授權實作或合併規格。

## 已觀察問題

同一個已批准 PG16 映像 `sha256:6a2e324ebe59af6031c4c1cd96c1d5072c2ebc36563d2196365e43b8297c062d` 的 `Config.Volumes` 恰為 `{"/var/lib/postgresql/data":{}}`。即使 helper 直接執行 pg_dump/pg_restore，Docker create 也會自動加入一個 RW anonymous volume。真實 profile 的 create後完整inspect正確拒絕了這個未列明掛載，尚未啟動PG helper。

保留的完整container ID：`a5444793df46dedaba7674edb48518826ea467db09ab285784d758e96c11f2f1`，狀態created；未啟動、未猜測清理。匿名volume `9ec11afa0079a762b41283e90c06f4c6537819d81e31483951c30d8d120b844b` 保留。舊PP1b runtime/data/locks未動。

## 建議批准的唯一修改

在附約§1固定 Docker create 向量中，**只對使用同一已驗PG映像的PG_DUMP、PG_RESTORE及這兩種工具的same-image --version profile**，明列額外參數：

```text
--tmpfs=/var/lib/postgresql/data:ro,nosuid,nodev,noexec,size=1048576
```

原 `/tmp:rw,nosuid,nodev,size=67108864` 保留。PG映像的`Config.Volumes`必須恰為上述單一PGDATA宣告，其他宣告拒絕；若其他kind映像聲明未列明volume，同樣拒絕。這個1MiB只讀暫存掛載遮住映像宣告位置，無持久資料、不掛任何source/target DB volume；直接執行既定client argv，不執行postgres/initdb或image entrypoint。

policySha256的既有preimage鍵集合保持原樣；額外tmpfs是由kind及已驗PG映像角色唯一決定的固定政策，create後/運行/退出inspect都必須逐項核對HostConfig.Tmpfs精確相等，並核對Mounts恰為該kind原列明的bind/volume集合，任何額外anonymous/persistent mount仍拒絕。PROFILE僅有固定PG_DUMP_VERSION/PG_RESTORE_VERSION角色，不能由caller選任意image/path/argv。

不變更映像ID、使用者、network、cap-drop、no-new-privileges、read-only rootfs、PG單一backend及完整ID清理規則。只修正本次helper臨時容器；不變更source/target PostgreSQL server資料volume。

## 可審查證據及驗收

[PROBE.json](PROBE.json)保存兩個獨立network-none synthetic探針的完整ID、image、inspect Mounts/Tmpfs及實際16.15版本輸出：pg_dump與pg_restore均exit0，Mounts為空、PGDATA tmpfs明列ro，容器已exited且保留。這只證明提案可行，不是產品helper/backup/restore成功。

批准後先同步PP1c wave與local-adapters的正式固定政策，必要獨立審查/CI/正常合併/遠端核對，再實作：namedRed/Green覆蓋missing/writable/oversized/extra tmpfs、unexpected image VOLUME、anonymous mount及非PGkind誤用；真實same-image profile與source capture重驗，完整B閘門後依序C/D。

替代選項：維持現行規格，B停在此阻擋點。另造無VOLUME衍生PG映像會改變同映像來源，需另一份規格與驗證，不包含在本提案。
