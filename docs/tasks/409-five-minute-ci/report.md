# Issue409 verification

Issue: https://github.com/fallrising/newclear/issues/409
Base: caedc24c8baca26e65cfb6da49b079b508bbd899

Prism's two jobs and mkfk's three jobs now use the requested five-minute maximum. Only timeout constants changed. This preserves unit/race/model/integration/chaos/demo gates, artifact upload and always-run demo cleanup.

## Prior execution evidence

Fetched job timestamps on2026-10-23 for five recent completed Prism runs and four recent completed mkfk runs; excluded the latest in-progress mkfk run. All22 sampled jobs succeeded in29–168seconds. These are job execution durations, not queue or finalization latency. The issue's older153-second observation is not treated as the present maximum. Historical head hashes and queue state may differ from this candidate; the new cap still requires candidate CI. No promise is made about future network stalls/cold runners.

| Job | Seconds | Conclusion |
| --- | ---: | --- |
| [go / 120463706472](https://github.com/fallrising/newclear/actions/runs/39968248096/job/120463706472) | 168 | success |
| [golangci / 120463706896](https://github.com/fallrising/newclear/actions/runs/39968248096/job/120463706896) | 58 | success |
| [golangci / 120462018098](https://github.com/fallrising/newclear/actions/runs/39967760685/job/120462018098) | 63 | success |
| [go / 120462018532](https://github.com/fallrising/newclear/actions/runs/39967760685/job/120462018532) | 138 | success |
| [golangci / 119343878183](https://github.com/fallrising/newclear/actions/runs/39635258267/job/119343878183) | 69 | success |
| [go / 119343878604](https://github.com/fallrising/newclear/actions/runs/39635258267/job/119343878604) | 147 | success |
| [golangci / 119338415687](https://github.com/fallrising/newclear/actions/runs/39633710806/job/119338415687) | 71 | success |
| [go / 119338416388](https://github.com/fallrising/newclear/actions/runs/39633710806/job/119338416388) | 163 | success |
| [go / 119331259229](https://github.com/fallrising/newclear/actions/runs/39631545489/job/119331259229) | 137 | success |
| [golangci / 119331259242](https://github.com/fallrising/newclear/actions/runs/39631545489/job/119331259242) | 94 | success |
| [Chaos profile (short) / 120470838192](https://github.com/fallrising/newclear/actions/runs/39970285283/job/120470838192) | 51 | success |
| [Format, vet, unit, race, model, integration / 120470838768](https://github.com/fallrising/newclear/actions/runs/39970285283/job/120470838768) | 136 | success |
| [Three-broker Compose demo (local image, no registry) / 120470838847](https://github.com/fallrising/newclear/actions/runs/39970285283/job/120470838847) | 38 | success |
| [Format, vet, unit, race, model, integration / 120469873749](https://github.com/fallrising/newclear/actions/runs/39970004904/job/120469873749) | 102 | success |
| [Three-broker Compose demo (local image, no registry) / 120469874081](https://github.com/fallrising/newclear/actions/runs/39970004904/job/120469874081) | 36 | success |
| [Chaos profile (short) / 120469874312](https://github.com/fallrising/newclear/actions/runs/39970004904/job/120469874312) | 56 | success |
| [Format, vet, unit, race, model, integration / 120468629764](https://github.com/fallrising/newclear/actions/runs/39969651323/job/120468629764) | 141 | success |
| [Three-broker Compose demo (local image, no registry) / 120468630040](https://github.com/fallrising/newclear/actions/runs/39969651323/job/120468630040) | 35 | success |
| [Chaos profile (short) / 120468630185](https://github.com/fallrising/newclear/actions/runs/39969651323/job/120468630185) | 46 | success |
| [Chaos profile (short) / 120467407144](https://github.com/fallrising/newclear/actions/runs/39969302027/job/120467407144) | 50 | success |
| [Format, vet, unit, race, model, integration / 120467407348](https://github.com/fallrising/newclear/actions/runs/39969302027/job/120467407348) | 133 | success |
| [Three-broker Compose demo (local image, no registry) / 120467407431](https://github.com/fallrising/newclear/actions/runs/39969302027/job/120467407431) | 29 | success |

## Candidate checks

Local actionlint1.7.12 passed all37root workflows through the shared launcher. Exact comparison against HEAD passed: Prism changes two timeout values and mkfk three; every other workflow byte is identical. Staged whitespace passed. The shared index checker passed42 projectcontracts and5llms indexes with0errors. Independent review and final candidate CI/merge are recorded on the PR. No product code changed or gate was skipped. A future job exceeding the declared budget fails instead of silently running for15–30minutes.
