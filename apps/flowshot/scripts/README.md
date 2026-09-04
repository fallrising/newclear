# Scripts

執行期腳本由對應 node 建立。本文件包不含 production implementation。

SDD governance tooling:

```text
python3 scripts/sdd.py generate
python3 scripts/sdd.py verify
```

`generate` deterministically rebuilds the non-authoritative complete export,
`MANIFEST.json`, and `SHA256SUMS`. `verify` checks the SPEC hash, node front
matter, DAG dependencies/cycles, manifest, and checksums.
