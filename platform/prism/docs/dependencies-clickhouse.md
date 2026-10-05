# P1-09 dependency provenance

Owner explicitly authorized the official native ClickHouse client and necessary selected transitive changes on 2026-10-05. Go remains 1.27.1. `github.com/ClickHouse/clickhouse-go/v2 v2.48.0` provides the batch API and native transport required by SDD17. Upstream source tag resolves to `69b5195a9b2e04a999f9c130a7a9dc1248288689`; module checksum `h1:auzd4VkapQYhQF8F2Gog7s3x78Bi1JZmByxGbrw3C+4=`. [Official pinned release](https://github.com/ClickHouse/clickhouse-go/releases/tag/v2.48.0).

Necessary MVS updates include OTel/metric/trace 1.44.0, OTel auto/sdk 1.2.1, logr 1.4.3, x/net 0.57.0, x/sys 0.47.0, x/text 0.40.0 and compression 1.19.1. The native client adds ch-go 0.74.0, city/errors, brotli, orb, LZ4, asm, decimal and UUID packages. No upstream testcontainers/testify helpers are imported by Prism; upstream module/test checksums are not evidence of a runtime import. Existing memory/security/corpus behavior must pass against these shared versions.

The following table is derived from `go list -deps -test -json ./...` with Go1.27.1 readonly modules and local official module LICENSE/COPYING files. It covers the compiled package graph, including Prism tests, rather than treating every module metadata requirement as a compiled dependency. Composite module licence notices are retained; klauspost/compress primarily uses BSD for imported compression packages and also includes Apache/MIT notices for other directories. Full original licence bytes remain in upstream modules; no upstream implementation was copied into Prism. SHA256 values below identify the inspected primary licence files. Release/distribution work remains separately authorized scope.

| Compiled module | Version | Licence notices | Primary licence SHA256 |
| --- | --- | --- | --- |
| `github.com/ClickHouse/ch-go` | `v0.74.0` | Apache-2.0 | `22e7fd421de32ec18e6f9e4f62655696386d9d5dc661722df0b6324351e8cb08` |
| `github.com/ClickHouse/clickhouse-go/v2` | `v2.48.0` | Apache-2.0 | `27099b82691d1d17cb18138319e2a4f9980ef59c1186c9b02a3273c757c0f91b` |
| `github.com/andybalholm/brotli` | `v1.2.2` | MIT | `3d180008e36922a4e8daec11c34c7af264fed5962d07924aea928c38e8663c94` |
| `github.com/beorn7/perks` | `v1.0.1` | MIT | `0db7c9ebb3717e526f34f87dd1ee8bc77d36846e29cb0cec9246f7138fbe962b` |
| `github.com/cespare/xxhash/v2` | `v2.3.0` | MIT | `f566a9f97bacdaf00d9f21dd991e81dc11201c4e016c86b470799429a1c9a79c` |
| `github.com/dennwc/varint` | `v1.0.0` | MIT | `cc132cf90d36b033bc39885a343a6d8f1c36cc775cc4e2b8e270b5083e3d0646` |
| `github.com/edsrzf/mmap-go` | `v1.1.0` | BSD | `c2eba69f20d05414538c3a5df7694dde392e065ff70882e1625e90f5d6659fff` |
| `github.com/facette/natsort` | `v0.0.0-20181210072756-2cd4dd1e2dcb` | BSD | `48faea5bcf55d45517e01e0277323bf8f7abc0112d04b3b1bfaceb0ec640c580` |
| `github.com/go-faster/city` | `v1.0.1` | MIT | `ee60dfaa1cb16b6606355feddfcec03bd7305f335d067e261d36ff20716425fd` |
| `github.com/go-faster/errors` | `v0.7.1` | BSD | `2d36597f7117c38b006835ae7f537487207d8ec407aa9d9980794b2030cbc067` |
| `github.com/go-kit/log` | `v0.2.1` | MIT | `1ea87f17c186a528a91ff8d81073d9ee434f40a3ad8067d83158f5c5188c0be2` |
| `github.com/go-logfmt/logfmt` | `v0.6.0` | MIT | `1b582013d963b973548e8a51b99fc2e8e1937855698c6a7b460886ac2e90017e` |
| `github.com/go-logr/logr` | `v1.4.3` | Apache-2.0 | `b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1` |
| `github.com/go-logr/stdr` | `v1.2.2` | Apache-2.0 | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `github.com/gogo/protobuf` | `v1.3.2` | BSD | `3f571768c0ba2f330e5fee90de89bfe5141f48c1939be8008fa61461c30ca07f` |
| `github.com/golang/snappy` | `v0.0.4` | BSD | `f69f157b0be75da373605dbc8bbf142e8924ee82d8f44f11bcaf351335bf98cf` |
| `github.com/google/uuid` | `v1.6.0` | BSD | `0a8d61ed3cbfd5312326e8126c31ce9c627a283adc99131b56896d29ada04b2d` |
| `github.com/grafana/regexp` | `v0.0.0-20240518133315-a468a5bfb3bc` | BSD | `2d36597f7117c38b006835ae7f537487207d8ec407aa9d9980794b2030cbc067` |
| `github.com/json-iterator/go` | `v1.1.12` | MIT | `3247931083f058b00760a3c32a9ca0962c05e4d562ad2ffcc1753451fa8d4486` |
| `github.com/klauspost/compress` | `v1.19.1` | Apache-2.0 / BSD / MIT | `0d9e582ee4bff57bf1189c9e514e6da7ce277f9cd3bc2d488b22fbb39a6d87cf` |
| `github.com/modern-go/concurrent` | `v0.0.0-20180306012644-bacd9c7ef1dd` | Apache-2.0 | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `github.com/modern-go/reflect2` | `v1.0.2` | Apache-2.0 | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `github.com/paulmach/orb` | `v0.13.0` | MIT | `91d97518f7a7bd54f8f5fa763a1ae268d23477f37317d787e348d66f56ff7b42` |
| `github.com/pierrec/lz4/v4` | `v4.1.27` | BSD | `6a358d2540ca14048f02d366f23787c0a480157e58f058113f0e27168dd4e447` |
| `github.com/prometheus/client_golang` | `v1.19.1` | Apache-2.0 | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `github.com/prometheus/client_model` | `v0.6.1` | Apache-2.0 | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `github.com/prometheus/common` | `v0.54.0` | Apache-2.0 | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `github.com/prometheus/procfs` | `v0.12.0` | Apache-2.0 | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `github.com/prometheus/prometheus` | `v0.53.0` | Apache-2.0 | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `github.com/segmentio/asm` | `v1.2.1` | MIT-0 (MIT No Attribution) | `cca993712df289a5958bdef69031a5dac0f951ac15afeb313f9eeea55ed59443` |
| `github.com/shopspring/decimal` | `v1.4.0` | MIT | `b92ba0f6ee02f2309628bfdadb123668a17c016e475ba477b857d33470d9d625` |
| `go.opentelemetry.io/auto/sdk` | `v1.2.1` | Apache-2.0 | `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` |
| `go.opentelemetry.io/collector/pdata` | `v1.23.0` | Apache-2.0 | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| `go.opentelemetry.io/otel` | `v1.44.0` | Apache-2.0 / BSD | `1ae07514be1d7bb33f0698f8d91fb51b8b9fe1463157ec1c72081a49b9bc6f40` |
| `go.opentelemetry.io/otel/metric` | `v1.44.0` | Apache-2.0 / BSD | `1ae07514be1d7bb33f0698f8d91fb51b8b9fe1463157ec1c72081a49b9bc6f40` |
| `go.opentelemetry.io/otel/trace` | `v1.44.0` | Apache-2.0 / BSD | `1ae07514be1d7bb33f0698f8d91fb51b8b9fe1463157ec1c72081a49b9bc6f40` |
| `go.uber.org/atomic` | `v1.11.0` | MIT | `edbb5a4d165ac69376c765b551c0662ff42bea87e1f1eda85f42ac90c34b09d0` |
| `go.uber.org/goleak` | `v1.3.0` | MIT | `cea390bdf643a06fbdd99fbab18c50e82c34e7bead0d55bf1168bd0d65b9fa32` |
| `go.uber.org/multierr` | `v1.11.0` | MIT | `dcdabe03bef2382a130640d1c3a4cd5ec42aba1035095c38272fde694eb72405` |
| `golang.org/x/net` | `v0.57.0` | BSD | `911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad` |
| `golang.org/x/sys` | `v0.47.0` | BSD | `911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad` |
| `golang.org/x/text` | `v0.40.0` | BSD | `911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad` |
| `google.golang.org/genproto/googleapis/rpc` | `v0.0.0-20241015192408-796eee8c2d53` | Apache-2.0 | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| `google.golang.org/grpc` | `v1.69.2` | Apache-2.0 | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| `google.golang.org/protobuf` | `v1.36.2` | BSD | `4835612df0098ca95f8e7d9e3bffcb02358d435dbb38057c844c99d7f725eb20` |

Observed compiled modules: **45**. All inspected notices fall within the project Apache-2.0/MIT/BSD/MPL-2.0 policy; MIT-0 is the permissive MIT No Attribution variant. `go mod verify` checks downloaded module identity. The repository dependency guard and its five negative fixtures check import direction and prohibited AGPL package imports; they are not a universal vulnerability scan.

The local ClickHouse integration runner pins `clickhouse/clickhouse-server@sha256:b002e56ed5c16e224c312527f6fcba7e77216fec5d7a88a7828f59efc614feb5`, observed server `24.8.14.39`, matching the original SDD24.8 family. This image is a disposable test prerequisite, not a new shipped Go dependency or deployment approval. Newer servers and replicated clusters are not covered by that fixture.
