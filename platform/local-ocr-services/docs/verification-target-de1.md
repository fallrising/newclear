# Target Server Verification: de1

## Record scope

This document records evidence collected on the selected target host `de1`. It is
separate from the historical 2026-09-04 evidence in `docs/verification.md`. Current
commands ran between `2026-09-04T07:08:22+02:00` and
`2026-09-04T09:13:40+02:00` from
`/home/ckc/test/codex/local-ocr-services`.

Evidence labels used below:

- **CURRENT:** executed during this target-server verification.
- **HISTORICAL:** copied only as prior context; not treated as a current rerun.
- **INFERENCE:** a conclusion derived from identified current evidence.
- **NOT RUN:** a required check that has not been executed.

No API key, OCR fixture, production payload, host configuration, Docker daemon setting,
or existing workload was changed during M1. Two disposable containers created by the
network probes used `--rm` and are no longer present.

## M1 — S-001 target server inventory

### Server identity and operating system

**CURRENT — passed**

```console
$ date --iso-8601=seconds
2026-09-04T07:08:22+02:00
# exit 0

$ hostname
de1
# exit 0

$ cat /etc/os-release
PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"
VERSION_ID="12"
# exit 0

$ uname -a
Linux de1 6.1.0-28-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.1.119-1 (2024-11-22) x86_64 GNU/Linux
# exit 0
```

### CPU architecture, topology, and flags

**CURRENT — passed**

```console
$ lscpu
Architecture:                         x86_64
CPU(s):                               6
On-line CPU(s) list:                  0-5
Vendor ID:                            AuthenticAMD
Model name:                           AMD EPYC Processor
Thread(s) per core:                   1
Core(s) per socket:                   6
Socket(s):                            1
Hypervisor vendor:                    KVM
Virtualization type:                  full
NUMA node(s):                         1
Flags:                                fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 ht syscall nx mmxext fxsr_opt pdpe1gb rdtscp lm rep_good nopl cpuid extd_apicid tsc_known_freq pni pclmulqdq ssse3 fma cx16 sse4_1 sse4_2 x2apic movbe popcnt aes xsave avx f16c rdrand hypervisor lahf_lm cmp_legacy cr8_legacy abm sse4a misalignsse 3dnowprefetch osvw topoext vmmcall fsgsbase bmi1 avx2 smep bmi2 rdseed adx smap clflushopt sha_ni xsaveopt xsavec xgetbv1 arat
# exit 0

$ nproc --all
6
# exit 0
```

The KVM guest exposes six vCPUs with a guest topology of one socket, six cores, and one
thread per core. The physical topology of the underlying hypervisor host is unknown and
must not be inferred from guest `lscpu` output. AVX and AVX2 are exposed to the guest.
This satisfies the repository's Linux amd64/x86_64 architecture constraint.

### Memory and swap

**CURRENT — passed with one fallback**

```console
$ free -b
               total        used        free      shared  buff/cache   available
Mem:     27313537024 12440092672  2085158912    22589440 13241769984 14873444352
Swap:              0           0           0
# exit 0

$ swapon --show --bytes
/bin/bash: line 1: swapon: command not found
# exit 127; command unavailable

$ cat /proc/swaps
Filename                                Type            Size            Used            Priority
# exit 0; no swap entries
```

**INFERENCE:** total RAM is about 25.44 GiB and available RAM at this sample is about
13.85 GiB. The host has no configured swap.

### Docker storage and filesystem capacity

**CURRENT — passed**

Docker reports its data root as `/var/lib/docker` (see the daemon evidence below).

```console
$ df -hT /var/lib/docker
Filesystem     Type  Size  Used Avail Use% Mounted on
/dev/sda1      ext4  296G  144G  140G  51% /
# exit 0

$ df -i /var/lib/docker
Filesystem       Inodes   IUsed    IFree IUse% Mounted on
/dev/sda1      19660800 2335795 17325005   12% /
# exit 0

$ docker system df
TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          142       14        42.87GB   39.56GB (92%)
Containers      16        14        4.895GB   67.13MB (1%)
Local Volumes   38        10        3.609GB   3.499GB (96%)
Build Cache     514       0         12.2GB    12.2GB
# exit 0 after read-only daemon access was approved
```

An initial sandboxed `docker system df` attempt exited 1 with Docker socket permission
denied. Its output was rejected as invalid evidence and the successful read-only command
above was rerun with daemon access. No reclaim operation was performed.

### Docker Engine, Compose, BuildKit, storage, cgroups, and security

**CURRENT — passed**

```console
$ docker version --format 'ClientVersion={{.Client.Version}}
ClientAPI={{.Client.APIVersion}}
ServerVersion={{.Server.Version}}
ServerAPI={{.Server.APIVersion}}'
ClientVersion=27.5.1
ClientAPI=1.47
ServerVersion=27.5.1
ServerAPI=1.47
# exit 0

$ docker compose version
Docker Compose version v2.32.4
# exit 0

$ docker buildx version
github.com/docker/buildx v0.20.0 8e30c46
# exit 0

$ docker buildx ls
NAME/NODE     DRIVER/ENDPOINT   STATUS    BUILDKIT   PLATFORMS
default*      docker
 \_ default    \_ default       running   v0.18.2    linux/amd64 (+3), linux/386
# exit 0
```

The exact successful Docker daemon query was:

```sh
docker info --format 'Name={{.Name}}
ServerVersion={{.ServerVersion}}
OperatingSystem={{.OperatingSystem}}
OSType={{.OSType}}
Architecture={{.Architecture}}
KernelVersion={{.KernelVersion}}
NCPU={{.NCPU}}
MemTotal={{.MemTotal}}
DockerRootDir={{.DockerRootDir}}
Driver={{.Driver}}
CgroupDriver={{.CgroupDriver}}
CgroupVersion={{.CgroupVersion}}
SecurityOptions={{json .SecurityOptions}}
Containers={{.Containers}}
ContainersRunning={{.ContainersRunning}}
ContainersPaused={{.ContainersPaused}}
ContainersStopped={{.ContainersStopped}}
Images={{.Images}}
LiveRestoreEnabled={{.LiveRestoreEnabled}}'
```

It exited 0 with this key output:

```text
Name=de1
ServerVersion=27.5.1
OperatingSystem=Debian GNU/Linux 12 (bookworm)
OSType=linux
Architecture=x86_64
KernelVersion=6.1.0-28-amd64
NCPU=6
MemTotal=27313537024
DockerRootDir=/var/lib/docker
Driver=overlay2
CgroupDriver=systemd
CgroupVersion=2
SecurityOptions=["name=apparmor","name=seccomp,profile=builtin","name=cgroupns"]
Containers=16
ContainersRunning=14
ContainersPaused=0
ContainersStopped=2
Images=142
LiveRestoreEnabled=false
```

An earlier sandboxed `docker info` call printed a socket permission error while the Go
template emitted empty values and returned exit 0. Those empty values were rejected and
are not used. **INFERENCE:** the daemon is rootful rather than rootless because it uses
`/var/lib/docker` and its reported security options do not contain `name=rootless`.
AppArmor, Docker's built-in seccomp profile, and cgroup namespaces are active.

### Existing workloads and contention

**CURRENT — passed**

`docker ps --no-trunc --format
'{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'` exited 0 and showed 14 running
containers: two `ice-maker` containers and twelve `ojbquay` application, monitoring,
Kafka, and PostgreSQL containers. Multiple `ojbquay` ports currently bind to `0.0.0.0`;
the OCR Compose configuration remains separately loopback-bound.

Two `docker stats --no-stream --format
'{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.PIDs}}'` samples exited 0.
The principal consumers were:

| Container | CPU sample 1 | CPU sample 2 | Memory sample 2 |
| --- | ---: | ---: | ---: |
| `ojbquay-kafka-1` | 97.80% | 158.78% | 1.643 GiB |
| `ojbquay-demo-kafka-1` | 1.40% | 78.76% | 1.599 GiB |
| `ojbquay-demo-postgres-1` | 13.11% | 14.74% | 46.32 MiB |
| `ojbquay-demo-scheduler-1` | 4.68% | 4.82% | 264.2 MiB |
| `ojbquay-demo-console-api-1` | 0.29% | 0.10% | 476.3 MiB |

The first `uptime` sample exited 0 with load averages `3.15, 5.07, 5.98`; a later
`cat /proc/loadavg` exited 0 with `2.56 4.30 5.61`. CPU contention is therefore material
on a guest with six exposed vCPUs and is not represented by a single idle snapshot.

The exact running-container limit query inspected the 14 IDs returned by
`docker ps --quiet`:

```sh
docker inspect af43e0618c7a 61361e466aa9 e9c430229fb0 01d2befa9c80 19bcac060df7 7803be6c39cd c00659ebf5f4 51f808b6f56a 6a5c7e6d8fe3 80ae5852d2ac e9ea40c7dab4 0d8226aad42b 6d7d737a0937 89ee97074460 --format '{{.Name}}\tNanoCPUs={{.HostConfig.NanoCpus}}\tMemory={{.HostConfig.Memory}}\tMemorySwap={{.HostConfig.MemorySwap}}\tPidsLimit={{.HostConfig.PidsLimit}}'
```

It exited 0. `ice-maker-document-relay` is limited to 0.25 CPU and 128 MiB;
`ice-maker-document-service` is limited to 2 CPUs and 8 GiB. The twelve `ojbquay`
containers reported `NanoCPUs=0` and `Memory=0`, meaning Docker does not enforce CPU or
memory limits for them. This raises coexistence risk for latency-sensitive OCR.

The first sandboxed host `ps` command saw only its local process namespace and was
rejected as host evidence. Approved read-only host-namespace queries then ran without
command arguments in their output:

```sh
ps -eo user,pid,comm,%cpu,%mem,rss --sort=-rss
ps -eo user,pid,comm,%cpu,%mem,rss --sort=-%cpu
```

Both exited 0 and returned 292–293 process rows. Key memory-ranked output was:

```text
USER         PID COMMAND         %CPU %MEM   RSS
ckc      2397661 java             1.7  5.8 1566756
ckc       862323 java             1.0  5.8 1549532
ckc       798511 opencode         1.2  3.7 1008924
ckc       338048 MainThread      24.0  3.4 909676
ckc       319874 opencode        16.0  3.2 859632
ckc       143748 codex            0.7  3.0 822512
ckc      2285450 java             0.4  2.4 643888
10001    2400051 java             0.1  1.8 493832
root      418551 dockerd          0.0  1.5 423156
ckc       216755 grok             6.0  1.1 311592
```

The CPU-ranked query additionally showed `MainThread` at 24.0%, `opencode` at 16.0%,
and `grok` at 6.0%; its transient `ps` process itself appeared at 100% and is excluded
from capacity interpretation. A simultaneous `free -b` sample exited 0 with
`14889566208` bytes available and `cat /proc/loadavg` exited 0 with
`3.14 4.89 5.50`. **INFERENCE:** host-level development/agent and JVM workloads add
contention beyond the OCR containers. Process ownership does not by itself prove whether
every JVM belongs to a container, so Docker and host evidence are kept separate.

### Build-time registry/model network and runtime outbound policy

**CURRENT — partially verified**

The exact default-network probe was:

```sh
docker run --rm python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93 python -c 'import urllib.error, urllib.request; urls=("https://pypi.org/simple/", "https://deb.debian.org/debian/", "https://huggingface.co/", "https://paddle-model-ecology.bj.bcebos.com/", "https://aistudio.baidu.com/"); exec("for url in urls:\n try:\n  response=urllib.request.urlopen(url, timeout=15); print(url, response.status)\n except urllib.error.HTTPError as error:\n  print(url, error.code)")'
```

It exited 0:

```text
https://pypi.org/simple/ 200
https://deb.debian.org/debian/ 200
https://huggingface.co/ 200
https://paddle-model-ecology.bj.bcebos.com/ 403
https://aistudio.baidu.com/ 200
```

The BOS root HTTP 403 proves routing and TLS response, not authorization for or
availability of exact Paddle model objects. No Paddle model download was attempted.

`docker manifest inspect python:3.11-slim` initially exited 1 because the local command
sandbox denied DNS. The approved rerun exited 0 and returned an OCI image index including
`linux/amd64` manifest `sha256:d1053354624536b044162aaab1e418bd000ea35184fb1ae098ab3166b1072e72`.
This proves current Docker Hub manifest access, not the integrity or availability of all
future dependencies.

**INFERENCE:** ordinary containers currently have outbound HTTPS access. The repository's
Compose file does not enforce an outbound restriction, so a production runtime network
policy still has to be supplied by the operator. Exact BuildKit access to every Paddle
model object remains **NOT RUN** and is unnecessary while Paddle is `NO-GO`.

### `--network none` capability

**CURRENT — passed**

```console
$ docker run --rm --network none python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93 python -c 'import socket; print(socket.if_nameindex())'
[(1, 'lo')]
# exit 0
```

This proves the daemon can run a disposable container with only loopback visible. It is
not an OCR engine warmup and does not replace S-007 or S-009.

### Existing OCR artifact observations

**CURRENT — passed for existing images**

```sh
docker image inspect sha256:c31f55d1359844d0f9c17fdca37411ff267816fef4749624518c80aa3fbad845 sha256:eff9305a812c1f58508fa7dc0375770674e875b2420d9dbd4703297e34c52ef5 --format 'Id={{.Id}} RepoTags={{json .RepoTags}} RepoDigests={{json .RepoDigests}} Os={{.Os}} Architecture={{.Architecture}} Size={{.Size}} User={{.Config.User}} Created={{.Created}}'
```

Exit 0 key output:

```text
Id=sha256:c31f55d1359844d0f9c17fdca37411ff267816fef4749624518c80aa3fbad845 RepoTags=["local-ocr-services/rapidocr:0.1.0"] RepoDigests=[] Os=linux Architecture=amd64 Size=802823778 User=10001:10001 Created=2026-09-04T06:35:36.472866568+02:00
Id=sha256:eff9305a812c1f58508fa7dc0375770674e875b2420d9dbd4703297e34c52ef5 RepoTags=["local-ocr-services/tesseract:0.1.0"] RepoDigests=[] Os=linux Architecture=amd64 Size=286794535 User=10001:10001 Created=2026-09-04T06:35:36.588416378+02:00
```

The `Size` values are Docker-reported local image sizes, not compressed archive sizes.
Both `RepoDigests` arrays are empty. `docker image inspect
local-ocr-services/paddle-structure:0.1.0` exited 1 with `No such image`, confirming that
Paddle has not been built. A filtered `docker ps` exited 0 with no output, so neither
existing OCR image was running at the end of inventory.

## M1 — S-002 compatibility and capacity decisions

These statuses govern whether verification may proceed. They are not production
promotion decisions; S-010, S-011, S-016, and S-019 remain outstanding.

### RapidOCR — CONDITIONAL

Proceed with S-004 through S-007 against exact image
`sha256:c31f55d1359844d0f9c17fdca37411ff267816fef4749624518c80aa3fbad845`.

Supporting evidence:

- Linux x86_64, AVX2, six exposed KVM vCPUs, Docker Engine 27.5.1, BuildKit 0.18.2.
- About 13.85 GiB was available versus the Compose 4 GiB container limit.
- The exact amd64 image is present and occupies about 803 MB by Docker's size field.
- `--network none` containers work and ordinary registry/dependency routes are reachable.

Conditions:

- Production promotion awaits real current-engine smoke, representative fixture quality,
  p50/p95, peak RAM/CPU, and saturation results.
- Existing Kafka activity consumes roughly 0.8 to 1.6 cores in current samples and most
  co-located workloads have no Docker CPU/RAM limits. Benchmark results must be interpreted
  under this contention and should not be generalized to a dedicated host.
- Expected concurrency/QPS and latency targets have not been provided.

### Tesseract — CONDITIONAL

Proceed with S-004, S-008, and S-009 against exact image
`sha256:eff9305a812c1f58508fa7dc0375770674e875b2420d9dbd4703297e34c52ef5`.

Supporting evidence:

- The same compatible Linux x86_64 and Docker platform evidence applies.
- About 13.85 GiB was available versus the Compose 2 GiB limit.
- The exact amd64 image is present and occupies about 287 MB by Docker's size field.

Conditions:

- Current real-engine `eng`, `chi_sim`, and `chi_tra` inspection, network-disabled warmup,
  HTTP OCR, load, and representative quality evidence are still required.
- The same host-contention and missing service-level objective limitations apply.

### Paddle Structure — NO-GO

Do not run S-013 through S-015 on this host under the observed conditions.

Supporting evidence:

- Available RAM was about 13.85 GiB, below the 16 GiB Paddle container runtime limit
  before reserving memory for Debian, Docker, fourteen running containers, build peaks,
  or filesystem cache.
- No swap is configured, and host CPU load is material.
- Twelve existing workload containers lack Docker CPU and memory limits.
- The Paddle image does not exist; a full dependency/model build and cache validation
  would add substantial unknown peak memory and disk demand.

This is a capacity and safety decision, not an architecture incompatibility. Re-evaluate
only after the host has measured spare memory beyond the 16 GiB runtime budget plus OS,
Docker, workload, and build headroom, and after the human explicitly authorizes Paddle
resource use. No swap or host-resource change is authorized.

## S-003 artifact transfer decision

No host-to-host repository or image transfer is required because the selected target is
the current host and both permitted engine images already exist here. GitHub persistence
is a separate source-history requirement. The human subsequently authorized private
repository `fallrising/local-ocr-services`, the initial commit, `origin`, and push; those
operations completed as recorded below. No registry image publication is authorized.

## M1 repository quality gate

**CURRENT — passed**

```console
$ make check
docker build --file docker/Dockerfile.test --tag local-ocr-services:test .
# ... BuildKit reused the pinned Python 3.11 test-image layers ...
docker run --rm local-ocr-services:test
......................................                                   [100%]
38 passed in 1.21s
docker run --rm --volume "/home/ckc/test/codex/local-ocr-services:/app:ro" --workdir /app --env PYTHONPATH=/app/src python:3.11-slim python scripts/check_syntax.py src tests
syntax OK: 18 Python files
docker compose config --quiet
docker compose --profile rapidocr config --services
rapidocr
docker compose --profile tesseract config --services
tesseract
docker compose --profile paddle-structure config --services
paddle-structure
# exit 0
```

This gate validates repository contracts, syntax, and Compose rendering. Its fake-engine
tests and static Paddle checks do not replace the real-engine checks scheduled for later
milestones.

The pre-commit `git diff --cached --check` initially exited 2 because 14 baseline files
contained one extra blank line at EOF. Only those terminal blank lines were removed; no
content or behavior changed. The deployable source checksum below was recomputed, and a
final `make check` rerun exited 0: test image
`sha256:04bde9b914e60dde8c3354b54fa542c1212a9b9908e6ce35f7eada7961516884`,
38 tests passed in 0.87 seconds, syntax remained OK for 18 Python files, and all three
Compose profiles rendered. The final `git diff --cached --check` exited 0.

## M1 deployable source snapshot identity

The repository has no initial commit, so M1 uses a deterministic aggregate over the 42
non-ignored deployable source and documentation files. `.team/` and this target evidence
record are excluded so that recording decisions and the checksum itself cannot create a
self-referential identity. This is a source-tree checksum, not a Git commit, Docker image
digest, registry manifest digest, or archive checksum.

```console
$ git ls-files --cached --others --exclude-standard | grep -v '^\.team/' | grep -v '^docs/verification-target-de1\.md$' | LC_ALL=C sort | xargs sha256sum | sha256sum
b656f080d20a9c2da541629e4c7e5cd4771cfc0fb4109b131852e4713a13ee00  -
# exit 0

$ git ls-files --cached --others --exclude-standard | grep -v '^\.team/' | grep -v '^docs/verification-target-de1\.md$' | wc -l
42
# exit 0
```

M2 will freeze its own source, Dockerfile/dependency, image, and fixture identities before
RapidOCR execution. The M1 checksum does not substitute for that S-004 baseline.

## M1 GitHub persistence

**CURRENT — passed with explicit human authorization**

The repository-local commit identity was configured as `Cheng Kung Chiang
<3985697+fallrising@users.noreply.github.com>` because the authenticated GitHub profile
has no public email. Global Git configuration was not changed.

```console
$ git commit -m 'chore: establish local OCR service baseline'
[main (root-commit) c5a495b] chore: establish local OCR service baseline
50 files changed, 3369 insertions(+)
# exit 0

$ gh repo create fallrising/local-ocr-services --private --source=. --remote=origin --description 'CPU-first independently deployable local OCR services'
https://github.com/fallrising/local-ocr-services
# exit 0

$ git push -u origin main
To https://github.com/fallrising/local-ocr-services.git
 * [new branch]      main -> main
branch 'main' set up to track 'origin/main'.
# exit 0

$ gh repo view fallrising/local-ocr-services --json nameWithOwner,isPrivate,url,defaultBranchRef
{"defaultBranchRef":{"name":"main"},"isPrivate":true,"nameWithOwner":"fallrising/local-ocr-services","url":"https://github.com/fallrising/local-ocr-services"}
# exit 0

$ git rev-parse HEAD
c5a495b2f4f8ce5904fe13d6ea3c360c91fbc0bc
# exit 0

$ git ls-remote origin refs/heads/main
c5a495b2f4f8ce5904fe13d6ea3c360c91fbc0bc refs/heads/main
# exit 0
```

The local and remote `main` identities matched after the initial push. This source push
does not publish either local OCR image and does not authorize production deployment.

## M1 status

S-001 evidence collection, S-002 technical decisions, the repository quality gate,
source snapshot identity, final T-003 read-only review, and plan update are complete. The
technical evidence gate is accepted and the baseline is persisted to the approved private
GitHub repository. **M1 is complete.** Production deployment remains blocked.

## Checks not executed in M1

- RapidOCR and Tesseract real HTTP/OCR/network-disabled reruns — scheduled for M2/M3.
- Latency, resource, and saturation benchmarks — scheduled for M4.
- Safe representative OCR fixtures — not provided.
- Exact Paddle model downloads, image build, structured OCR, or offline runtime — blocked
  by the S-002 `NO-GO` decision.
- Reverse proxy, firewall, DNS, TLS, or production Compose changes — not authorized.

## M2 — S-004 RapidOCR verification baseline

### Stage identity

**CURRENT — frozen before RapidOCR runtime execution**

```console
$ date --iso-8601=seconds
2026-09-04T07:56:22+02:00
# exit 0

$ hostname
de1
# exit 0

$ git rev-parse HEAD
5e48987b71818fd834fddb71e4bda1a311757368
# exit 0

$ git ls-remote origin refs/heads/main
5e48987b71818fd834fddb71e4bda1a311757368 refs/heads/main
# exit 0

$ git status --short --branch
## main...origin/main
# exit 0; clean at baseline capture
```

Commit `5e48987b71818fd834fddb71e4bda1a311757368` is the source and verification-plan
snapshot selected for M2. The existing image was created before this repository had a
commit and carries no source-revision label. S-005 must compare observable embedded
source/artifact state and must not claim that this commit built the image.

### Dockerfile, dependency, Compose, and image identity

```console
$ sha256sum docker/Dockerfile.rapidocr requirements/base.txt requirements/rapidocr.txt compose.yaml docker/entrypoint.sh
8a5207a068ef51136726f20ff3281f57ad94b3b47457dd4ca83f7e1e8e4b68a4  docker/Dockerfile.rapidocr
bcbc4e0cb1b086b960fd56c8d9db461e419ca9867946e46c7535429c60a335e3  requirements/base.txt
b85f66bded70fdddc7b49389c9f556abcc84f43f7032436c80ce03994fea03a6  requirements/rapidocr.txt
3d450911568566b743c95dabef079f7582c38eecdd197322c4343f38581768b9  compose.yaml
185d026f2cfde96c857bb807891f9dfc8e984b387fdce96450c335ccf342eb30  docker/entrypoint.sh
# exit 0

$ docker image inspect local-ocr-services/rapidocr:0.1.0 --format 'Id={{.Id}} RepoTags={{json .RepoTags}} RepoDigests={{json .RepoDigests}} Os={{.Os}} Architecture={{.Architecture}} Size={{.Size}} User={{.Config.User}} Created={{.Created}}'
Id=sha256:c31f55d1359844d0f9c17fdca37411ff267816fef4749624518c80aa3fbad845 RepoTags=["local-ocr-services/rapidocr:0.1.0"] RepoDigests=[] Os=linux Architecture=amd64 Size=802823778 User=10001:10001 Created=2026-09-04T06:35:36.472866568+02:00
# exit 0
```

Selected exact image:
`sha256:c31f55d1359844d0f9c17fdca37411ff267816fef4749624518c80aa3fbad845`.
The local tag is `local-ocr-services/rapidocr:0.1.0`; `RepoDigests` is empty. The
Docker-reported 802,823,778-byte size is not a compressed archive size. No archive is
needed because the image is already on the selected host.

`docker compose --profile rapidocr config` exited 0 and rendered one RapidOCR service
with two CPUs, 4 GiB memory, 256 PIDs, one worker by image command, loopback port 8011,
read-only root filesystem, all capabilities dropped, `no-new-privileges`, and a 128 MiB
`/tmp` tmpfs. Its rendered API key is empty until the private test env file is supplied.

Pinned dependency inputs are Python 3.11 slim base digest
`sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93`,
FastAPI 0.141.1, AnyIO 4.14.0, Pillow 12.3.0, Uvicorn 0.52.4, ONNX Runtime 1.29.0,
and RapidOCR 3.9.2. Transitive Python wheels and apt package versions were not locked in
the original build and cannot be reconstructed as historical facts.

### Test credential handling

Before starting a service, create a stage-specific directory under `/tmp` with mode 0700
and a `runtime.env` file with mode 0600. Generate a 32-byte random key using
`openssl rand -hex 32`; write only `OCR_API_KEY=<value>` to that file. Supply it with
Docker `--env-file`; never place the value in a command, repository file, response log,
container name, or verification document. Record only the file mode and a redacted
presence/length check. Remove the file during stage cleanup.

### Functional fixture handling

Create two non-sensitive synthetic PNG fixtures, one Traditional Chinese and one English,
inside the stage `/tmp` directory using a disposable Pillow container and an installed
Noto CJK font. The generator constructs text from numeric Unicode code points so input
text is not printed in command output. Record only file name, SHA-256, byte size, pixel
dimensions, and media type. Do not copy fixtures into the repository or paste OCR input
or recognized text into logs. OCR response evidence must redact `regions[*].text` while
retaining region count, confidence, polygons, engine metadata, request ID, and dimensions.

These synthetic images prove functional wiring only. S-016 representative quality remains
blocked until the human provides approved production-representative fixture paths.

### Benchmark and resource method fixed for S-010/S-011

- Cold start: elapsed monotonic time from `docker run` invocation until the process exists.
- Ready duration: elapsed monotonic time from invocation until the first HTTP 200 from
  `/health/ready`, polling every 100 ms with a 120-second upper bound.
- Cold OCR: first authenticated OCR request after readiness, with no prior OCR warmup.
- Warmup: three authenticated OCR requests per fixture, excluded from measurements.
- Samples: twenty measured requests per fixture and engine, sequential for baseline
  latency. Saturation concurrency is measured separately in S-011.
- Percentiles: nearest-rank over sorted samples,
  `value = samples[ceil(percentile * sample_count) - 1]`; record p50 and p95.
- Resource sampling: stream `docker stats` once per second from process start through the
  final request. Record peak container memory usage and maximum Docker CPU percentage;
  retain the raw temporary sample file outside the repository until the milestone is
  accepted, then remove it.
- Image cases: record each fixture's dimensions and checksum. Larger/resized and EXIF
  cases remain separate S-010/S-016 inputs rather than being inferred from these two
  functional fixtures.
- Accuracy: record observable recognized/omitted/misread regions only; do not calculate
  or claim an accuracy percentage without an approved labelled data set and metric.

### S-004 status

Source, configuration, dependency, image, credential, fixture, benchmark, resource, stage
time, and server identity methods are fixed.

The stage workspace and credential were created without printing the key:

```console
$ mktemp -d /tmp/local-ocr-services-m2.XXXXXX
/tmp/local-ocr-services-m2.nqOevW
# exit 0

$ install -m 600 /dev/null /tmp/local-ocr-services-m2.nqOevW/runtime.env
# exit 0

$ openssl rand -hex 32 | sed 's/^/OCR_API_KEY=/' > /tmp/local-ocr-services-m2.nqOevW/runtime.env
# exit 0; no output

$ stat -c 'mode=%a owner=%U group=%G bytes=%s' /tmp/local-ocr-services-m2.nqOevW /tmp/local-ocr-services-m2.nqOevW/runtime.env
mode=700 owner=ckc group=ckc bytes=4096
mode=600 owner=ckc group=ckc bytes=77
# exit 0

$ grep -Eq '^OCR_API_KEY=[0-9a-f]{64}$' /tmp/local-ocr-services-m2.nqOevW/runtime.env
# exit 0; no output and no key disclosure
```

Fixture generation used a disposable `local-ocr-services:test` container, Pillow, and an
installed Noto CJK font; it exited 0. The text-construction portion of that command is
intentionally not persisted because the verification policy forbids recording OCR input
content. Apt emitted only non-fatal debconf frontend fallback warnings because the
disposable container had no TTY. The auditable fixture identities, dimensions, formats,
and subsequent expected-output hashes are recorded without retaining input content.

```console
$ sha256sum /tmp/local-ocr-services-m2.nqOevW/traditional.png /tmp/local-ocr-services-m2.nqOevW/english.png
a6d70dbf0a1475c36f4f9260789f639ba441152dacc6cdd5fb7226530c8049b3  /tmp/local-ocr-services-m2.nqOevW/traditional.png
9d2fbd41922f8ef21fa6ba285cc85b4faf1c90144dd056180bf92b461d4fd983  /tmp/local-ocr-services-m2.nqOevW/english.png
# exit 0

$ file /tmp/local-ocr-services-m2.nqOevW/traditional.png /tmp/local-ocr-services-m2.nqOevW/english.png
/tmp/local-ocr-services-m2.nqOevW/traditional.png: PNG image data, 1200 x 300, 8-bit/color RGB, non-interlaced
/tmp/local-ocr-services-m2.nqOevW/english.png: PNG image data, 1600 x 400, 8-bit/color RGB, non-interlaced
# exit 0

$ docker run --rm --network none --volume /tmp/local-ocr-services-m2.nqOevW:/fixtures:ro local-ocr-services:test python -c 'from PIL import Image; paths=("/fixtures/traditional.png","/fixtures/english.png"); print([(path.rsplit("/",1)[-1], Image.open(path).format, Image.open(path).size, Image.open(path).n_frames) for path in paths])'
[('traditional.png', 'PNG', (1200, 300), 1), ('english.png', 'PNG', (1600, 400), 1)]
# exit 0
```

The files are mode 0644 but remain protected by their parent mode-0700 directory. Both
belong to the remapped container user (`nobody:nogroup`) and are readable by the stage
owner. They will be removed with the entire stage directory after M2 acceptance.

**S-004 — DONE.** The next task is S-005 exact-image build and identity capture.

## M2 — S-005 RapidOCR artifact identity

### Historical image/source comparison

**CURRENT — existing image does not byte-match the selected Git snapshot**

The committed host source aggregate and the equivalent `/app/src/ocr_service` aggregate
inside historical image `c31f55d...ad845` are different:

```console
$ find src/ocr_service -type f -name '*.py' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum
d5e83c2ffe1f5db50d92c5a5ac83836753c57e49b440a3a7811029aae44edd5a  -
# exit 0

$ docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 sha256:c31f55d1359844d0f9c17fdca37411ff267816fef4749624518c80aa3fbad845 sh -c 'cd /app && find src/ocr_service -type f -name "*.py" -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum'
36be348f725857f2b51d134d3230d440cb6f7a501102da7c20bb5af00d23bb93  -
# exit 0
```

The image files were exported through `tar` under `--network none`, read-only root,
dropped capabilities, `no-new-privileges`, and a 256-PID limit, then compared locally
without printing their contents:

```text
compared=16
exact_mismatches=7
exact_mismatch_paths=src/ocr_service/__init__.py,src/ocr_service/api_models.py,src/ocr_service/backends/__init__.py,src/ocr_service/backends/base.py,src/ocr_service/backends/registry.py,src/ocr_service/warmup.py,requirements/rapidocr.txt
non_newline_mismatches=0
non_newline_mismatch_paths=
# pipeline and comparison exit 0
```

The seven files are byte-identical after stripping terminal newline bytes. This is
consistent with the documented pre-initial-commit EOF cleanup and is not evidence of a
behavioral difference. It nevertheless means the historical image cannot truthfully be
identified as built from commit `5e48987...7a311`.

The historical image remains unchanged. S-005 therefore builds a separately tagged
`local-ocr-services/rapidocr:verify-5e48987` image from the frozen commit. S-006 and
S-007 will use only the resulting resolved image ID. This rebuild is required by the new
artifact-identity evidence; it does not invalidate the earlier historical runtime record.

### Exact image build

**CURRENT — passed after one pre-build tooling correction**

The first wrapper attempt called unavailable `/usr/bin/time`, exited 127, and did not
invoke Docker. No image was created or modified by that attempt. The wrapper was changed
to POSIX wall-clock timestamps without installing a host package. The successful build
command was:

```sh
docker build --no-cache --progress=plain \
  --file docker/Dockerfile.rapidocr \
  --tag local-ocr-services/rapidocr:verify-5e48987 .
```

It exited 0. The complete 430-line, 35,355-byte build log remains in the protected stage
directory with SHA-256
`8524a5dabab40deed4a7023f7172cc399e881dd5636afdfc2ed9ad2bcd704ef7`.
Key output was:

```text
#9 Successfully installed ... fastapi-0.141.1 ... onnxruntime-1.29.0 ... rapidocr-3.9.2 ... uvicorn-0.52.4
#12 DONE 0.8s
#13 exporting layers 3.1s done
#13 writing image sha256:2a80e84b499149db3a20c620e247a5c99dff82d93b4ae6ce8f86b8ffef663409 done
#13 naming to docker.io/local-ocr-services/rapidocr:verify-5e48987 done
#13 DONE 3.1s
```

The build began at `2026-09-04T08:05:55+02:00`, ended at
`2026-09-04T08:06:24+02:00`, and took 29 wall-clock seconds. BuildKit downloaded current
Debian and transitive Python artifacts because the Dockerfile pins direct Python
requirements and the base image digest but not apt or transitive dependency versions.
This is a reproducibility limitation, not a failed build.

The build emitted one `useradd` warning because UID 10001 is above Debian's system-UID
maximum; the requested UID was created and the final image user is correct. Apt also
emitted non-fatal debconf frontend fallbacks in its non-interactive build container. No
build error or failed step occurred.

### Build resource and disk observations

A host sampler ran once per second for the complete build window. The 29-sample file has
SHA-256 `9d91abcbaae0b0e94add5d4294becb89e328e2a5e0fe09a13cb73617618d6b6f`.
It observed:

- minimum host available RAM: 13,731,000,000 bytes;
- maximum host RAM in use by `MemTotal - MemAvailable`: 13,582,500,000 bytes;
- maximum aggregate host CPU busy interval: 100.00%;
- maximum one-minute load value during sampling: 9.95;
- maximum `dockerd` RSS: 451,484 KiB.

Immediately before the build, available RAM was 15,114,559,488 bytes and filesystem
available space at `/var/lib/docker` was 146,656,837,632 bytes. Immediately after, the
values were 14,612,983,808 and 145,811,619,840 bytes. The filesystem available-space
delta was 845,217,792 bytes; rounded `docker system df` image usage increased from
42.87 GB to 43.55 GB. These are build-window host observations, not isolated per-build
accounting: the shared Docker daemon and the fourteen existing containers remained
active. They establish that the host retained substantial memory and disk headroom, but
cannot assign every CPU cycle or byte delta exclusively to RapidOCR.

### Image, embedded source, dependency, and model identity

```console
$ docker image inspect local-ocr-services/rapidocr:verify-5e48987 --format 'Id={{.Id}} RepoTags={{json .RepoTags}} RepoDigests={{json .RepoDigests}} Os={{.Os}} Architecture={{.Architecture}} Size={{.Size}} User={{.Config.User}} Created={{.Created}}'
Id=sha256:2a80e84b499149db3a20c620e247a5c99dff82d93b4ae6ce8f86b8ffef663409 RepoTags=["local-ocr-services/rapidocr:verify-5e48987"] RepoDigests=[] Os=linux Architecture=amd64 Size=802823764 User=10001:10001 Created=2026-09-04T08:06:21.79360485+02:00
# exit 0
```

Docker reports a local image size of 802,823,764 bytes. The image is `linux/amd64`, has
no registry manifest digest, runs as `10001:10001`, uses `/app`, contains the expected
entrypoint, and invokes one Uvicorn worker. It identifies Python 3.11.15 on Debian 13.6.

Host and image hashes were compared while the image ran with `--network none`, a
read-only root filesystem, all capabilities dropped, `no-new-privileges`, and a 256-PID
limit. The command exited 0:

```text
HOST source aggregate:
d5e83c2ffe1f5db50d92c5a5ac83836753c57e49b440a3a7811029aae44edd5a  -
IMAGE source aggregate:
d5e83c2ffe1f5db50d92c5a5ac83836753c57e49b440a3a7811029aae44edd5a  -
requirements/base.txt:
bcbc4e0cb1b086b960fd56c8d9db461e419ca9867946e46c7535429c60a335e3
requirements/rapidocr.txt:
b85f66bded70fdddc7b49389c9f556abcc84f43f7032436c80ce03994fea03a6
entrypoint:
185d026f2cfde96c857bb807891f9dfc8e984b387fdce96450c335ccf342eb30
artifact_check=passed
4 /opt/ocr-artifacts.sha256
dfde8e3daff7d9c12aa738653541322b7b5ff107b6036571698bd2639c3ee5da  /opt/ocr-artifacts.sha256
31749509 /usr/local/lib/python3.11/site-packages/rapidocr/models
```

All four model files in the 31,749,509-byte model directory passed the baked manifest.
The observed direct engine/runtime packages are FastAPI 0.141.1, AnyIO 4.14.0, Pillow
12.3.0, Uvicorn 0.52.4, ONNX Runtime 1.29.0, and RapidOCR 3.9.2.

### Transfer archive identity

Although S-003 selected a same-host build and no transfer is needed, temporary archives
were created in the protected stage directory to provide actual compressed and
uncompressed transfer-artifact identities:

```console
$ docker save --output /tmp/local-ocr-services-m2.nqOevW/rapidocr-verify-5e48987.tar sha256:2a80e84b499149db3a20c620e247a5c99dff82d93b4ae6ce8f86b8ffef663409
# exit 0
$ gzip -1 -c /tmp/local-ocr-services-m2.nqOevW/rapidocr-verify-5e48987.tar > /tmp/local-ocr-services-m2.nqOevW/rapidocr-verify-5e48987.tar.gz
# exit 0
$ stat -c '%n bytes=%s' /tmp/local-ocr-services-m2.nqOevW/rapidocr-verify-5e48987.tar /tmp/local-ocr-services-m2.nqOevW/rapidocr-verify-5e48987.tar.gz
rapidocr-verify-5e48987.tar bytes=811618816
rapidocr-verify-5e48987.tar.gz bytes=339435388
# exit 0
$ sha256sum /tmp/local-ocr-services-m2.nqOevW/rapidocr-verify-5e48987.tar /tmp/local-ocr-services-m2.nqOevW/rapidocr-verify-5e48987.tar.gz
b753622dc747a7264cb99dc2d85f46df625f16f63f382b3592d216512b131854  rapidocr-verify-5e48987.tar
fa991c997e53fa49b6dd7f6965d688337a8099daecbcbf68aab59d6e96324f21  rapidocr-verify-5e48987.tar.gz
# exit 0
```

These SHA-256 values identify local archive files and are explicitly **not** registry
manifest digests. The archives will be removed after M2 acceptance; the exact image will
remain as the milestone artifact.

**S-005 — DONE.** S-006 proceeds only against exact image
`sha256:2a80e84b499149db3a20c620e247a5c99dff82d93b4ae6ce8f86b8ffef663409`.

## M2 — S-006 RapidOCR security and HTTP smoke

### Hardened loopback runtime

**CURRENT — passed**

```console
$ docker run --detach --name local-ocr-m2-rapid-http --env-file /tmp/local-ocr-services-m2.nqOevW/runtime.env --publish 127.0.0.1:18011:8000 --read-only --tmpfs /tmp:size=128m,mode=1777 --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --cpus 2 --memory 4g sha256:2a80e84b499149db3a20c620e247a5c99dff82d93b4ae6ce8f86b8ffef663409
1210e9304fe6b4e1142a0699b91d8041c00702ffe13d1c661741de5affac228a
# exit 0
```

Docker sourced the key from the mode-0600 env file and injected it into the container
environment/configuration metadata for that container's lifetime. The literal value was
not printed or placed in the command line, and the temporary container was removed after
the smoke. A readiness poll against `127.0.0.1:18011` exited 0 with HTTP 200 and:

```text
ready_status=200 attempts=1 poll_elapsed_ms=53
{"status":"ready","engine":"rapidocr","model":"PP-OCRv6-small"}
```

This poll started after container creation had already returned; it is not the S-010 cold
start metric. Timestamped logs place process start at `06:10:13.622986Z` and application
startup completion at `06:10:14.963366Z`.

The runtime security inspection used:

```sh
docker inspect local-ocr-m2-rapid-http --format \
  'Image={{.Image}} User={{.Config.User}} ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} CapDrop={{json .HostConfig.CapDrop}} SecurityOpt={{json .HostConfig.SecurityOpt}} PidsLimit={{.HostConfig.PidsLimit}} NanoCpus={{.HostConfig.NanoCpus}} Memory={{.HostConfig.Memory}} PortBindings={{json .HostConfig.PortBindings}} Tmpfs={{json .HostConfig.Tmpfs}}'
docker exec local-ocr-m2-rapid-http sh -c \
  'id; grep -E "^(Uid|Gid|CapEff|NoNewPrivs):" /proc/1/status'
```

Both exited 0 with:

```text
Image=sha256:2a80e84b499149db3a20c620e247a5c99dff82d93b4ae6ce8f86b8ffef663409 User=10001:10001 ReadonlyRootfs=true CapDrop=["ALL"] SecurityOpt=["no-new-privileges"] PidsLimit=256 NanoCpus=2000000000 Memory=4294967296 PortBindings={"8000/tcp":[{"HostIp":"127.0.0.1","HostPort":"18011"}]} Tmpfs={"/tmp":"size=128m,mode=1777"}
uid=10001(ocr) gid=10001(ocr) groups=10001(ocr)
Uid: 10001 10001 10001 10001
Gid: 10001 10001 10001 10001
CapEff: 0000000000000000
NoNewPrivs: 1
```

A `touch /rootfs-probe` through `docker exec` failed as expected with `Read-only file
system`. A write/read/remove probe under `/tmp` passed. `docker top` showed one
`python -m uvicorn ... --workers 1` process as user/group 10001. The combined probe
command exited 0 because the rootfs write failure was the required result.

### Health, authentication, and real OCR

The local test harness read the API key from the protected env file, sent only raw PNG
bytes, saved full response bodies as mode-0600 files under the protected stage directory,
and printed only redacted structural summaries:

```console
$ python3 /tmp/local-ocr-services-m2.nqOevW/http-smoke.py
# first run exit 1 before authenticated OCR: harness looked up WWW-Authenticate with a case-sensitive mapping key
$ python3 /tmp/local-ocr-services-m2.nqOevW/http-smoke.py
# corrected RFC case-insensitive header lookup; exit 0
```

The first failure was a test-harness defect, not a service failure: both requests had
already returned 401, while Python exposed the header as `Www-Authenticate`. The harness
was corrected once and the successful run asserted:

```text
health: live_status=200, body={status: alive}
health: ready_status=200, body={status: ready, engine: rapidocr, model: PP-OCRv6-small}
missing_api_key: status=401, error_code=unauthorized, WWW-Authenticate=ApiKey
invalid_api_key: status=401, error_code=unauthorized, WWW-Authenticate=ApiKey
traditional.png: status=200, schema_version=1.0, engine={name: rapidocr, version: 3.9.2, model: PP-OCRv6-small}, image=1200x300, elapsed_ms=2693.873, regions=1, polygon_lengths=[4], pages=[1], block_types=[null], structured=null
traditional.png: provided request ID matched response header/body; normalized expected text matched; recognized text redacted
english.png: status=200, schema_version=1.0, engine={name: rapidocr, version: 3.9.2, model: PP-OCRv6-small}, image=1600x400, elapsed_ms=1863.931, regions=1, polygon_lengths=[4], pages=[1], block_types=[null], structured=null
english.png: generated request ID matched response header/body and allowed syntax; normalized expected text matched; recognized text redacted
```

Traditional Chinese confidence was 0.999790; English confidence was 0.980950. These two
functional examples do not constitute an accuracy percentage or representative quality
evaluation. The first successful real OCR request also performed engine work, so the two
elapsed values are functional observations rather than the S-010 benchmark series.

Container access logs independently showed the two live/ready 200 responses, four 401
responses across the failed and corrected harness runs, and two authenticated OCR 200
responses. They contained neither API keys nor request bodies. Startup logs reported that
all three model paths already existed and were valid. ONNX Runtime emitted a non-fatal
warning that a telemetry device ID could not be persisted and an in-memory identifier was
used, consistent with the read-only runtime. Neither message instruments socket attempts;
offline operation is evaluated separately in S-007.

A post-test snapshot showed 263.7 MiB container memory, 0.18% Docker CPU, and 29 PIDs;
the container was running and not OOM-killed. This is a single observation and is not a
peak or performance result.

The disposable runtime was then removed:

```console
$ docker stop --time 10 local-ocr-m2-rapid-http
local-ocr-m2-rapid-http
# exit 0
$ docker rm local-ocr-m2-rapid-http
local-ocr-m2-rapid-http
# exit 0
$ docker ps --filter name=local-ocr-m2-rapid-http --format '{{.ID}} {{.Names}} {{.Status}}'
# no output; exit 0
```

**S-006 — DONE.** Security, health, authentication, real OCR, response schema, engine
metadata, request IDs, dimensions, and normalized regions passed against exact image
`2a80e84...663409`.

## M2 — S-007 RapidOCR network-disabled verification

### Real engine warmup

**CURRENT — passed**

The same resolved image ran a real engine invocation with no container network:

```console
$ docker run --rm --network none --env-file /tmp/local-ocr-services-m2.nqOevW/runtime.env --read-only --tmpfs /tmp:size=128m,mode=1777 --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --cpus 2 --memory 4g sha256:2a80e84b499149db3a20c620e247a5c99dff82d93b4ae6ce8f86b8ffef663409 python -m ocr_service.warmup
...
File exists and is valid: .../PP-OCRv6_det_small.onnx
File exists and is valid: .../ch_ppocr_mobile_v2.0_cls_mobile.onnx
File exists and is valid: .../PP-OCRv6_rec_small.onnx
...
warmed rapidocr PP-OCRv6-small
# exit 0
```

The blank warmup image produced an expected `text detection result is empty` warning
after real engine execution. ONNX Runtime again used an in-memory telemetry identifier
because it could not persist one on the read-only filesystem. Neither warning failed
warmup.

### Same-network-namespace HTTP smoke

**CURRENT — passed after one mount-permission correction**

The initial `--network none` harness attempt exited 2 before starting Uvicorn because the
bind-mounted script was mode 0600 and unreadable to UID 10001. No HTTP or OCR assertion
ran. The non-secret harness and synthetic fixtures were copied to a separate temporary
mode-0755 directory as mode-0644 files; their fixture SHA-256 values remained
`a6d70d...049b3` and `9d2fbd...fd983`. The API key remained outside that directory and
was supplied only through `--env-file`.

The corrected exact command was:

```sh
docker run --rm --network none \
  --env-file /tmp/local-ocr-services-m2.nqOevW/runtime.env \
  --read-only --tmpfs /tmp:size=128m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 256 --cpus 2 --memory 4g \
  --mount type=bind,src=/tmp/local-ocr-services-m2-mount/offline-http-smoke.py,dst=/verify/offline-http-smoke.py,readonly \
  --mount type=bind,src=/tmp/local-ocr-services-m2-mount/traditional.png,dst=/verify/traditional.png,readonly \
  --mount type=bind,src=/tmp/local-ocr-services-m2-mount/english.png,dst=/verify/english.png,readonly \
  sha256:2a80e84b499149db3a20c620e247a5c99dff82d93b4ae6ce8f86b8ffef663409 \
  python /verify/offline-http-smoke.py
```

It exited 0. The harness ran as PID 1, inspected its namespace and security state, started
one Uvicorn worker bound to `127.0.0.1:8000`, and issued all HTTP requests from that same
container network namespace. Its redacted output was:

```text
network: interfaces=[[1, lo]], only_loopback=true
security: uid=10001, gid=10001, CapEff=0000000000000000, NoNewPrivs=1, rootfs_read_only=true
ready: status=200, attempts=20, elapsed_ms=1932.780, engine=rapidocr, model=PP-OCRv6-small
live: status=200, body={status: alive}
missing_api_key: status=401, error_code=unauthorized, WWW-Authenticate=ApiKey
invalid_api_key: status=401, error_code=unauthorized, WWW-Authenticate=ApiKey
traditional.png: status=200, schema=1.0, image=1200x300, elapsed_ms=2496.051, regions=1, confidence=0.999790, polygon_lengths=[4], provided request ID matched header/body, normalized expected text matched, text redacted
english.png: status=200, schema=1.0, image=1600x400, elapsed_ms=2018.337, regions=1, confidence=0.980950, polygon_lengths=[4], generated request ID valid and matched header/body, normalized expected text matched, text redacted
server log summary: startup complete=true, model-exists-and-valid messages=3, HTTP 200 entries=4, HTTP 401 entries=2, payloads/API key logged=false
```

Both OCR responses reported engine `{name: rapidocr, version: 3.9.2, model:
PP-OCRv6-small}`, page 1, null structured output, and valid normalized polygons. The
ready and OCR times are observations from this run, not the fixed S-010 sample series.

**S-007 — DONE.** The exact image operates with Docker `--network none` for real warmup
and same-namespace loopback HTTP health, authentication, and OCR on this host. This is
evidence of operation under the tested network policy. It does **not** prove that the
process made no socket attempt because no syscall/network instrumentation was used.

## M2 provisional status

S-004 through S-007 are complete. RapidOCR remains `CONDITIONAL` rather than promoted:
S-010 latency/resource sampling, S-011 saturation behavior, and S-016 representative
quality data remain outstanding. M2 acceptance also awaits the repository quality gate,
independent read-only evidence review, final diff inspection, and GitHub persistence.

## M2 evidence rework after T-004

T-004 returned `REWORK` because several correct results were not yet independently
reconstructable from the record. The following evidence supersedes the affected command,
credential, harness, and time-window descriptions above.

### Current interval closure and durable harness identities

```console
$ date --iso-8601=seconds
2026-09-04T08:28:13+02:00
# exit 0
```

This is the end of the M2 runtime-execution interval. Later review, Git bookkeeping, and
M3 commands are separately identified; the document-level CURRENT interval is extended
only when new target-server evidence is added.

Two non-secret evidence programs are preserved with the milestone:

```console
$ sha256sum .team/evidence/M2/run-rapidocr-build.sh .team/evidence/M2/rapidocr_http_smoke.py
1bb848ecdea4ff2f3511111adeb3ac19e3b2d727433b80e65956c3781711a89a  .team/evidence/M2/run-rapidocr-build.sh
57d32221bdc686621958dcaffc9cefbddfe30643debf21602b346c506b3c5410  .team/evidence/M2/rapidocr_http_smoke.py
# exit 0

$ cmp --silent /tmp/local-ocr-services-m2.nqOevW/run-rapidocr-build.sh .team/evidence/M2/run-rapidocr-build.sh
# exit 0; the preserved build wrapper is byte-identical to the successful executed wrapper

$ sh -n .team/evidence/M2/run-rapidocr-build.sh
# exit 0

$ python3 -c 'from pathlib import Path; p=Path(".team/evidence/M2/rapidocr_http_smoke.py"); compile(p.read_text(), str(p), "exec"); print("http_harness_syntax=passed")'
http_harness_syntax=passed
# exit 0
```

The HTTP harness contains all health, authentication, schema, engine, image-dimension,
request-ID, region, polygon, confidence, and expected-result assertions used below. It
contains only SHA-256 values of whitespace/case-normalized expected results, not fixture
or recognized text. It prints no API key or OCR text. For same-container execution it
also asserts the UID/GID, zero effective capabilities, `NoNewPrivs`, read-only rootfs,
loopback-only interface set, and absence of the actual API key and recognized response
text from captured server logs.

### Exact S-005 measurement and provenance commands

The successful build and one-second host sampler were run by the preserved wrapper:

```console
$ /bin/sh /tmp/local-ocr-services-m2.nqOevW/run-rapidocr-build.sh
build_exit=0
# exit 0
```

The exact pre-build and post-build observation commands were the same in both snapshots:

```sh
docker system df
df -B1 /var/lib/docker
free -b
cat /proc/loadavg
```

Each group exited 0. The before/after values and limitations are reported in the S-005
resource section. The preserved wrapper shows the exact `/proc/stat`, `/proc/meminfo`,
`/proc/loadavg`, `ps -C dockerd`, one-second interval, build command, log redirection, and
wall-clock calculations that produced the 29-sample evidence. The exact aggregation was:

```sh
awk -F '\t' 'NR>1 {n++; used=$2-$3; if (n==1 || used>maxused) maxused=used; if (n==1 || $3<minavail) minavail=$3; if ($4>maxcpu) maxcpu=$4; if ($5>maxload) maxload=$5; if ($6>maxrss) maxrss=$6} END {printf "samples=%d peak_host_used_bytes=%.0f min_host_available_bytes=%.0f max_host_cpu_busy_percent=%.2f max_load1=%.2f max_dockerd_rss_kib=%.0f\n", n,maxused,minavail,maxcpu,maxload,maxrss}' /tmp/local-ocr-services-m2.nqOevW/build-host-samples.tsv
```

It exited 0 and returned the 29 samples and peak values already recorded above.

The exact host/image provenance command was:

```sh
printf 'HOST\n'
find src/ocr_service -type f -name '*.py' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum
sha256sum requirements/base.txt requirements/rapidocr.txt docker/entrypoint.sh
printf 'IMAGE\n'
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 256 \
  sha256:2a80e84b499149db3a20c620e247a5c99dff82d93b4ae6ce8f86b8ffef663409 \
  sh -c 'set -eu; cd /app; find src/ocr_service -type f -name "*.py" -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum; sha256sum requirements/base.txt requirements/rapidocr.txt /usr/local/bin/ocr-entrypoint; sha256sum -c /opt/ocr-artifacts.sha256 >/dev/null; printf "artifact_check=passed\n"; wc -l /opt/ocr-artifacts.sha256; sha256sum /opt/ocr-artifacts.sha256; du -sb /usr/local/lib/python3.11/site-packages/rapidocr/models; python -c "import importlib.metadata as m,platform; print(platform.python_version()); print([(n,m.version(n)) for n in (\"fastapi\",\"anyio\",\"pillow\",\"uvicorn\",\"onnxruntime\",\"rapidocr\")])"; sed -n "1,8p" /etc/os-release'
```

The combined command exited 0. Its source, requirements, entrypoint, manifest, package,
model-directory, Python, and OS results are recorded verbatim in the S-005 identity
section.

### Final checksum-addressed S-006 rerun

The same exact image was started again with the original security envelope:

```console
$ docker run --detach --name local-ocr-m2-rapid-http-final --env-file /tmp/local-ocr-services-m2.nqOevW/runtime.env --publish 127.0.0.1:18011:8000 --read-only --tmpfs /tmp:size=128m,mode=1777 --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --cpus 2 --memory 4g sha256:2a80e84b499149db3a20c620e247a5c99dff82d93b4ae6ce8f86b8ffef663409
5239299ceffe6c99a65d119942593d2f8b550ab72a85efc96c3ce9a27a854b75
# exit 0

$ python3 .team/evidence/M2/rapidocr_http_smoke.py --base-url http://127.0.0.1:18011 --fixture-dir /tmp/local-ocr-services-m2.nqOevW --api-key-env-file /tmp/local-ocr-services-m2.nqOevW/runtime.env
# exit 0
```

The final harness run returned live/ready 200, missing/invalid-key 401, and authenticated
Traditional Chinese/English OCR 200. Both results matched their expected normalized
SHA-256, without storing or printing the text. Key structural output was:

```text
traditional.png: engine=rapidocr 3.9.2/PP-OCRv6-small, image=1200x300, elapsed_ms=2058.449, regions=1, confidence=0.999790, schema=1.0, expected_hash_match=true
english.png: engine=rapidocr 3.9.2/PP-OCRv6-small, image=1600x400, elapsed_ms=1975.414, regions=1, confidence=0.980950, schema=1.0, expected_hash_match=true
both: polygon_lengths=[4], page=1, structured=null, request ID syntax/header/body passed, text redacted
```

The following exact commands supplied the final hardening and process evidence:

```sh
docker inspect local-ocr-m2-rapid-http-final --format 'Image={{.Image}} User={{.Config.User}} ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} CapDrop={{json .HostConfig.CapDrop}} SecurityOpt={{json .HostConfig.SecurityOpt}} PidsLimit={{.HostConfig.PidsLimit}} NanoCpus={{.HostConfig.NanoCpus}} Memory={{.HostConfig.Memory}} PortBindings={{json .HostConfig.PortBindings}} Tmpfs={{json .HostConfig.Tmpfs}}'
docker exec local-ocr-m2-rapid-http-final sh -c 'id; grep -E "^(Uid|Gid|CapEff|NoNewPrivs):" /proc/1/status'
docker exec local-ocr-m2-rapid-http-final sh -c 'touch /rootfs-probe'
docker exec local-ocr-m2-rapid-http-final sh -c 'touch /tmp/tmpfs-probe && test -f /tmp/tmpfs-probe && rm /tmp/tmpfs-probe && echo tmpfs_probe=passed'
docker top local-ocr-m2-rapid-http-final -eo pid,user,group,args
```

The inspection, identity/status, tmpfs, and process commands exited 0. The rootfs write
command exited non-zero as expected with `Read-only file system`; the controlling check
converted only that expected result into `readonly_probe=expected_failure` and exited 0.
Key output again resolved image `2a80e84...663409`, user 10001, read-only true,
`CapDrop=[ALL]`, `SecurityOpt=[no-new-privileges]`, 256 PIDs, two CPUs, 4 GiB, loopback
port 18011, zero `CapEff`, `NoNewPrivs=1`, writable `/tmp`, and exactly one Uvicorn
process.

Resource and log commands were:

```sh
docker stats --no-stream local-ocr-m2-rapid-http-final --format 'Name={{.Name}} CPU={{.CPUPerc}} Memory={{.MemUsage}} MemoryPercent={{.MemPerc}} PIDs={{.PIDs}}'
docker inspect local-ocr-m2-rapid-http-final --format 'Status={{.State.Status}} Running={{.State.Running}} OOMKilled={{.State.OOMKilled}} ExitCode={{.State.ExitCode}} StartedAt={{.State.StartedAt}}'
docker logs --timestamps local-ocr-m2-rapid-http-final > /tmp/local-ocr-services-m2.nqOevW/s006-final.log 2>&1
wc -l -c /tmp/local-ocr-services-m2.nqOevW/s006-final.log
sha256sum /tmp/local-ocr-services-m2.nqOevW/s006-final.log
grep -Fq -f /tmp/local-ocr-services-m2.nqOevW/api-key-only /tmp/local-ocr-services-m2.nqOevW/s006-final.log
grep -Fq -f /tmp/local-ocr-services-m2.nqOevW/expected-text-only /tmp/local-ocr-services-m2.nqOevW/s006-final.log
```

The stats/state/log commands exited 0: 0.17% CPU, 387.5 MiB of 4 GiB, 29 PIDs,
running, and not OOM-killed. The mode-0600 log contained 20 lines/2,652 bytes and had
SHA-256 `6c1fe08840eb5df88e34ae6d003100038d0e1d2827071b41759b04d8970df431`.
The two `grep` commands intentionally exited 1, proving the undisclosed API-key pattern
and expected fixture-text patterns were absent; their controlling assertions reported
`api_key_present_in_log=false` and `expected_fixture_text_present_in_log=false` and the
combined probe exited 0. The pattern files stayed mode 0600 outside the repository and
their contents were never printed.

Docker stored the API key in the container environment/config metadata while this
container existed. The narrower verified claim is only that the key was sourced from the
mode-0600 file, was not literal in the command or recorded output, was absent from the
captured service log, and ceased to exist in disposable container metadata when the
container was removed:

```console
$ docker stop --time 10 local-ocr-m2-rapid-http-final
local-ocr-m2-rapid-http-final
# exit 0
$ docker rm local-ocr-m2-rapid-http-final
local-ocr-m2-rapid-http-final
# exit 0
```

### Final checksum-addressed S-007 rerun

The final harness was copied to a UID-10001-readable temporary mount file and verified
byte-identical before execution:

```console
$ sha256sum .team/evidence/M2/rapidocr_http_smoke.py /tmp/local-ocr-services-m2-mount/rapidocr_http_smoke.py
57d32221bdc686621958dcaffc9cefbddfe30643debf21602b346c506b3c5410  .team/evidence/M2/rapidocr_http_smoke.py
57d32221bdc686621958dcaffc9cefbddfe30643debf21602b346c506b3c5410  /tmp/local-ocr-services-m2-mount/rapidocr_http_smoke.py
# exit 0
```

The exact command was:

```sh
docker run --rm --network none \
  --env-file /tmp/local-ocr-services-m2.nqOevW/runtime.env \
  --read-only --tmpfs /tmp:size=128m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 256 --cpus 2 --memory 4g \
  --mount type=bind,src=/tmp/local-ocr-services-m2-mount/rapidocr_http_smoke.py,dst=/verify/rapidocr_http_smoke.py,readonly \
  --mount type=bind,src=/tmp/local-ocr-services-m2-mount/traditional.png,dst=/verify/traditional.png,readonly \
  --mount type=bind,src=/tmp/local-ocr-services-m2-mount/english.png,dst=/verify/english.png,readonly \
  sha256:2a80e84b499149db3a20c620e247a5c99dff82d93b4ae6ce8f86b8ffef663409 \
  python /verify/rapidocr_http_smoke.py --fixture-dir /verify \
  --start-server --expect-network-none
```

It exited 0. Final key output was:

```text
interfaces=[[1, lo]], only_loopback=true
uid=10001, gid=10001, CapEff=0000000000000000, NoNewPrivs=1, rootfs_read_only=true
ready=200 after 19 attempts/1824.275 ms; live=200
missing_api_key=401 unauthorized; invalid_api_key=401 unauthorized
traditional.png=200, 1200x300, 1 region, confidence=0.999790, elapsed_ms=2198.411, expected_hash_match=true
english.png=200, 1600x400, 1 region, confidence=0.980950, elapsed_ms=1900.031, expected_hash_match=true
server log: startup=true, model-valid messages=3, HTTP 200=4, HTTP 401=2, api_key_present=false, recognized_ocr_text_present=false
```

The HTTP service and client ran inside the same container namespace with only loopback
visible. All structural/request-ID assertions described under the harness identity
passed. No raw key, input text, or recognized text was persisted or printed. The same
scope limitation still applies: this proves operation under Docker `--network none`, not
absence of every socket syscall attempt.

### Rework status

All four T-004 must-fix items are addressed. The independent re-review returned
`ACCEPT`, and both the T-004 task and report pass `teamctl.py` validation.

## M2 technical acceptance and cleanup

The post-rework repository gate passed:

```console
$ make check
docker build --file docker/Dockerfile.test --tag local-ocr-services:test .
...
docker run --rm local-ocr-services:test
......................................                                   [100%]
38 passed in 0.85s
...
syntax OK: 18 Python files
docker compose config --quiet
docker compose --profile rapidocr config --services
rapidocr
docker compose --profile tesseract config --services
tesseract
docker compose --profile paddle-structure config --services
paddle-structure
# exit 0
```

This is the repository contract/static gate; it does not replace the exact-image runtime
evidence above. `git diff --check`, evidence-program syntax checks, and scans for the
runtime credential line and prohibited fixture-content markers all exited 0. The scans
reported `runtime_secret_line_in_repository=false` and
`fixture_content_marker_in_m2_record=false`.

After T-004 acceptance, the orchestrator inspected both exact temporary paths and then
removed only the two directories created during M2:

```console
$ rm -rf -- /tmp/local-ocr-services-m2.nqOevW /tmp/local-ocr-services-m2-mount
# exit 0
$ for path in /tmp/local-ocr-services-m2.nqOevW /tmp/local-ocr-services-m2-mount; do if [ -e "$path" ]; then echo "cleanup_failed=$path"; exit 1; else echo "cleanup_confirmed=$path"; fi; done
cleanup_confirmed=/tmp/local-ocr-services-m2.nqOevW
cleanup_confirmed=/tmp/local-ocr-services-m2-mount
# exit 0
```

This permanently removed the test API key, generated fixtures, raw responses, logs,
host sample file, and both temporary image archives. The archived SHA-256 identities
remain in this record; equivalent archives can be recreated from the retained exact
image but the removed byte streams are no longer recoverable as files. No user artifact
or pre-existing Docker image was removed.

At `2026-09-04T08:35:38+02:00`, a post-review housekeeping check confirmed the exact
image is still present as
`sha256:2a80e84b499149db3a20c620e247a5c99dff82d93b4ae6ce8f86b8ffef663409`,
tagged `local-ocr-services/rapidocr:verify-5e48987`, with empty `RepoDigests`. This
housekeeping check occurred after the CURRENT runtime-evidence interval and does not add
or change an OCR result.

**M2 technical decision — ACCEPT.** S-004 through S-007 passed for the exact image on
this host. RapidOCR remains `CONDITIONAL`, not production-promoted, because S-010
performance/resource measurements, S-011 saturation behavior, and human-approved S-016
representative quality checks remain outstanding. Formal deployment remains blocked.
Milestone closure additionally requires committing and pushing this accepted record to
the approved private GitHub repository.

## M2 GitHub persistence

**CURRENT — passed with the standing human authorization for milestone persistence**

```console
$ git commit -m 'docs: verify RapidOCR on target host'
[main 437fb00] docs: verify RapidOCR on target host
 6 files changed, 1376 insertions(+), 10 deletions(-)
# exit 0

$ git push origin main
To https://github.com/fallrising/local-ocr-services.git
   5e48987..437fb00  main -> main
# exit 0

$ git rev-parse HEAD
437fb00655c95a02741da4806bb363e4266ae111
# exit 0

$ git ls-remote origin refs/heads/main
437fb00655c95a02741da4806bb363e4266ae111 refs/heads/main
# exit 0

$ gh repo view fallrising/local-ocr-services --json nameWithOwner,isPrivate,url,defaultBranchRef
{"defaultBranchRef":{"name":"main"},"isPrivate":true,"nameWithOwner":"fallrising/local-ocr-services","url":"https://github.com/fallrising/local-ocr-services"}
# exit 0

$ git status --short --branch
## main...origin/main
# exit 0; clean at persistence confirmation
```

**M2 — COMPLETE.** The accepted record is persisted in the approved private GitHub
repository. The exact RapidOCR image remains local only; no registry image was published.
No production stack, proxy, firewall, DNS, TLS, or public endpoint was changed. M3 may
proceed with S-008/S-009 Tesseract validation.

## M3 — S-008 Tesseract baseline and historical artifact

### Stage identity

**CURRENT — frozen before Tesseract build/runtime execution**

```console
$ date --iso-8601=seconds
2026-09-04T08:40:25+02:00
# exit 0
$ hostname
de1
# exit 0
$ git rev-parse HEAD
f6c21904ada9a30da4954d67c33df36099229ee3
# exit 0
$ git ls-remote origin refs/heads/main
f6c21904ada9a30da4954d67c33df36099229ee3 refs/heads/main
# exit 0
$ git status --short --branch
## main...origin/main
# exit 0; clean at baseline capture
```

The fixed inputs are:

```console
$ sha256sum docker/Dockerfile.tesseract requirements/base.txt requirements/tesseract.txt compose.yaml docker/entrypoint.sh
d9e9804d88e5423808ff5e6e3554e7927a827d71c0047c42e4cad8a1dafb43b6  docker/Dockerfile.tesseract
bcbc4e0cb1b086b960fd56c8d9db461e419ca9867946e46c7535429c60a335e3  requirements/base.txt
79432d61d8c8b2c3b7fa093e17a2d0e9934a1945eda19a4a1cb14a9ba34023a0  requirements/tesseract.txt
3d450911568566b743c95dabef079f7582c38eecdd197322c4343f38581768b9  compose.yaml
185d026f2cfde96c857bb807891f9dfc8e984b387fdce96450c335ccf342eb30  docker/entrypoint.sh
# exit 0
$ find src/ocr_service -type f -name '*.py' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum
d5e83c2ffe1f5db50d92c5a5ac83836753c57e49b440a3a7811029aae44edd5a  -
# exit 0
```

`docker compose --profile tesseract config` exited 0 and rendered a 2-CPU, 2-GiB,
256-PID, one-worker service with loopback port 8012, read-only rootfs, all capabilities
dropped, `no-new-privileges`, 128-MiB `/tmp`, and default language set `chi_tra+eng`.
The API key remains empty until supplied from the protected stage env file.

The M3 stage directory is `/tmp/local-ocr-services-m3.Jt02KG` at mode 0700. Its
`runtime.env` is mode 0600, 77 bytes, and passed a redacted
`^OCR_API_KEY=[0-9a-f]{64}$` shape check. Docker will inject this value into disposable
container environment/config metadata while each container exists; it will not be
printed, placed literally in commands, or committed, and the stage/containers will be
removed after M3 acceptance.

### Historical image inspection

```console
$ docker image inspect local-ocr-services/tesseract:0.1.0 --format 'Id={{.Id}} RepoTags={{json .RepoTags}} RepoDigests={{json .RepoDigests}} Os={{.Os}} Architecture={{.Architecture}} Size={{.Size}} User={{.Config.User}} Created={{.Created}}'
Id=sha256:eff9305a812c1f58508fa7dc0375770674e875b2420d9dbd4703297e34c52ef5 RepoTags=["local-ocr-services/tesseract:0.1.0"] RepoDigests=[] Os=linux Architecture=amd64 Size=286794535 User=10001:10001 Created=2026-09-04T06:35:36.588416378+02:00
# exit 0
```

The historical image is local `linux/amd64`, reports 286,794,535 bytes, and has no
registry digest. A hardened `--network none` inspection verified its manifest and actual
engine/languages:

```text
artifact_check=passed
4 /opt/ocr-artifacts.sha256
bb9242b7d2d704627689fc05bf44a75c4af671247c4299b94315f94281173ee9  /opt/ocr-artifacts.sha256
19515726 /usr/share/tesseract-ocr
engine_version=tesseract 5.5.0
languages=chi_sim,chi_tra,eng,osd
python=3.11.15
pytesseract_wrapper=0.3.13
engine_via_wrapper=5.5.0
Debian 13.6 (trixie)
# exit 0
```

Tesseract 5.5.0 is the engine version; pytesseract 0.3.13 is only the Python wrapper and
is not used as the engine identity. Required `eng`, `chi_sim`, and `chi_tra` data are all
present, plus `osd`.

### Historical source comparison and exact-build decision

Host and image aggregates differed (`d5e83c...d5a6` versus `36be34...bb93`). The
historical image files were exported through `tar` under `--network none`, read-only
rootfs, dropped capabilities, `no-new-privileges`, and a 256-PID limit, then compared
without printing contents:

```text
compared=16
exact_mismatches=7
exact_mismatch_paths=src/ocr_service/__init__.py,src/ocr_service/api_models.py,src/ocr_service/backends/__init__.py,src/ocr_service/backends/base.py,src/ocr_service/backends/registry.py,src/ocr_service/warmup.py,requirements/tesseract.txt
non_newline_mismatches=0
non_newline_mismatch_paths=
# pipeline/comparison exit 0
```

All differences disappear after stripping terminal newline bytes. This is not a
behavioral mismatch, but it prevents exact provenance to commit `f6c2190...9ee3`.
The historical image is preserved. S-008 will build
`local-ocr-services/tesseract:verify-f6c2190`, capture current build/resource/archive
identity, and use only its resolved image ID for S-009.

### S-008 exact image build and resources

The preserved build/sampler source is
`.team/evidence/M3/run-tesseract-build.sh`, SHA-256
`1987f62697b6c49aaf6ca2f9a8a7a6a342c29dd6b4cb08182af2b467fa97b571`.
`sh -n` exited 0. It uses the same one-second `/proc/stat`, `/proc/meminfo`, load, and
`dockerd` RSS method accepted in M2 and runs this exact build:

```sh
docker build --no-cache --progress=plain \
  --file docker/Dockerfile.tesseract \
  --tag local-ocr-services/tesseract:verify-f6c2190 .
```

```console
$ /bin/sh .team/evidence/M3/run-tesseract-build.sh
build_exit=0
# exit 0
```

The build ran from `2026-09-04T08:43:16+02:00` through
`2026-09-04T08:43:39+02:00`, 23 wall-clock seconds. The complete 539-line,
40,605-byte log has SHA-256
`17cb72b366b98c07dac4f049f90ba869da1c5589efd1706333cf54b8c06a5b9c`.
Key output was:

```text
#7 installed tesseract-ocr 5.5.0-1+b1 and eng/chi-sim/chi-tra/osd data
#9 Successfully installed ... pytesseract-0.3.13 ...
#12 DONE 0.7s
#13 writing image sha256:25b27d10815f4c167b7915829b010514fff5d9a48c32271bf05154e9469aec77 done
#13 naming to docker.io/local-ocr-services/tesseract:verify-f6c2190 done
#13 DONE 0.8s
```

The build's only warning was the expected Debian `useradd` warning that UID 10001 is
above `SYS_UID_MAX`; the final user is verified below. Non-fatal apt debconf frontend
fallbacks occurred in the non-interactive build. No build step failed. As with RapidOCR,
apt and transitive Python versions are not fully locked even though the base image digest
and direct Python requirements are pinned.

The 22-sample host file has SHA-256
`57848a1e4eaad9d83515466feea83aad62eb2b699ae28eaa4c514f56ef1edd39`.
It observed minimum available host RAM 14,449,500,000 bytes, maximum host used RAM by
`MemTotal - MemAvailable` 12,864,000,000 bytes, maximum aggregate CPU busy 100.00%,
maximum one-minute load 15.96, and maximum `dockerd` RSS 446,876 KiB. Before/after
filesystem available space was 143,953,354,752 and 143,806,341,120 bytes, a
147,013,632-byte window delta; rounded Docker image usage increased from 43.56 to
43.72 GB. Available RAM before/after was 14,669,414,400 and 14,713,229,312 bytes.
Sixteen other containers were running and the post-build load sample reached 21.94, so
these are shared-host observations and not isolated build consumption.

### S-008 exact artifact verification

```console
$ docker image inspect local-ocr-services/tesseract:verify-f6c2190 --format 'Id={{.Id}} RepoTags={{json .RepoTags}} RepoDigests={{json .RepoDigests}} Os={{.Os}} Architecture={{.Architecture}} Size={{.Size}} User={{.Config.User}} Created={{.Created}}'
Id=sha256:25b27d10815f4c167b7915829b010514fff5d9a48c32271bf05154e9469aec77 RepoTags=["local-ocr-services/tesseract:verify-f6c2190"] RepoDigests=[] Os=linux Architecture=amd64 Size=286794521 User=10001:10001 Created=2026-09-04T08:43:38.167815771+02:00
# exit 0
```

The new image reports 286,794,521 local bytes, Linux amd64, user `10001:10001`, and no
registry digest. A hardened `--network none` host/image comparison exited 0:

```text
host source aggregate=d5e83c2ffe1f5db50d92c5a5ac83836753c57e49b440a3a7811029aae44edd5a
image source aggregate=d5e83c2ffe1f5db50d92c5a5ac83836753c57e49b440a3a7811029aae44edd5a
requirements/base.txt=bcbc4e0cb1b086b960fd56c8d9db461e419ca9867946e46c7535429c60a335e3
requirements/tesseract.txt=79432d61d8c8b2c3b7fa093e17a2d0e9934a1945eda19a4a1cb14a9ba34023a0
entrypoint=185d026f2cfde96c857bb807891f9dfc8e984b387fdce96450c335ccf342eb30
artifact_check=passed
manifest_files=4
manifest_sha256=bb9242b7d2d704627689fc05bf44a75c4af671247c4299b94315f94281173ee9
tessdata_directory_bytes=19515726
engine_version=tesseract 5.5.0
languages=chi_sim,chi_tra,eng,osd
python=3.11.15; pytesseract_wrapper=0.3.13; engine_via_wrapper=5.5.0
OS=Debian 13.6 (trixie)
```

This confirms the real Tesseract engine version separately from its Python wrapper and
confirms all three required language data sets.

### S-008 fixtures and transfer archive

The M3 stage regenerated the same non-sensitive synthetic images without persisting or
printing their text. The fixture-generation container exited 0; only apt's non-fatal
no-TTY debconf fallbacks were emitted. The resulting files match the M2 identities:

```text
traditional.png: SHA-256 a6d70dbf0a1475c36f4f9260789f639ba441152dacc6cdd5fb7226530c8049b3; 18,028 bytes; PNG RGB 1200x300
english.png: SHA-256 9d2fbd41922f8ef21fa6ba285cc85b4faf1c90144dd056180bf92b461d4fd983; 16,132 bytes; PNG RGB 1600x400
```

They remain outside the repository in the mode-0700 M3 stage and are functional fixtures,
not representative S-016 quality data.

Temporary transfer archives were created from the exact image:

```console
$ docker save --output /tmp/local-ocr-services-m3.Jt02KG/tesseract-verify-f6c2190.tar sha256:25b27d10815f4c167b7915829b010514fff5d9a48c32271bf05154e9469aec77
# exit 0
$ gzip -1 -c /tmp/local-ocr-services-m3.Jt02KG/tesseract-verify-f6c2190.tar > /tmp/local-ocr-services-m3.Jt02KG/tesseract-verify-f6c2190.tar.gz
# exit 0
```

The uncompressed Docker archive is 293,168,640 bytes with SHA-256
`ee978c85fcc4458942694b8b1be5a41e7c467c531acad39f0e89409c95340c41`.
The gzip is 122,390,996 bytes with SHA-256
`e46c90cf249e9bf5e655e187eec00b1e5d58f7d6d2e20a17ff3133e08754b138`.
These are archive hashes, explicitly not registry manifest digests. They will be removed
after M3 acceptance; the exact local image will remain.

**S-008 — DONE.** S-009 uses only exact image
`sha256:25b27d10815f4c167b7915829b010514fff5d9a48c32271bf05154e9469aec77`.

## M3 — S-009 Tesseract security, function, and offline smoke

### Auditable harness

The non-secret assertion source is preserved as
`.team/evidence/M3/tesseract_http_smoke.py`:

```console
$ python3 -c 'from pathlib import Path; p=Path(".team/evidence/M3/tesseract_http_smoke.py"); compile(p.read_text(), str(p), "exec"); print("syntax_ok", p)'
syntax_ok .team/evidence/M3/tesseract_http_smoke.py
# exit 0
$ sha256sum .team/evidence/M3/tesseract_http_smoke.py
4715f37d18cba3556b8ea6455ee7c31676aa32d90a24dcf885c16ac5d9dae67b  .team/evidence/M3/tesseract_http_smoke.py
# exit 0
```

The source submits raw image bytes, asserts health and both 401 paths, validates schema,
Tesseract engine metadata, image dimensions, request-ID header/body consistency,
non-empty regions, four-point integer polygons, confidence range, page, and null
structured output. It contains only normalized expected-result SHA-256 values, not API
keys, fixture text, or recognized text. Expected hash match is reported as an observable
quality result; it is not required merely to prove HTTP wiring and is not converted into
an accuracy percentage.

### Hardened loopback HTTP smoke

**CURRENT — passed**

```console
$ docker run --detach --name local-ocr-m3-tesseract-http --env-file /tmp/local-ocr-services-m3.Jt02KG/runtime.env --env OCR_TESSERACT_LANGUAGES=chi_tra+eng --publish 127.0.0.1:18012:8000 --read-only --tmpfs /tmp:size=128m,mode=1777 --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --cpus 2 --memory 2g sha256:25b27d10815f4c167b7915829b010514fff5d9a48c32271bf05154e9469aec77
67a14112521b2d88545003a008ef02e4bafffa5626fc69fd882d046af4371eda
# exit 0

$ python3 .team/evidence/M3/tesseract_http_smoke.py --base-url http://127.0.0.1:18012 --fixture-dir /tmp/local-ocr-services-m3.Jt02KG --api-key-env-file /tmp/local-ocr-services-m3.Jt02KG/runtime.env
# exit 0
```

The redacted harness output was:

```text
live=200 alive; ready=200 tesseract/tessdata:chi_tra+eng
missing_api_key=401 unauthorized; invalid_api_key=401 unauthorized
traditional.png=200, engine=tesseract 5.5.0, 1200x300, elapsed_ms=312.611, regions=1, confidence=0.772000, expected_text_hash_match=true
english.png=200, engine=tesseract 5.5.0, 1600x400, elapsed_ms=364.167, regions=1, confidence=0.952500, expected_text_hash_match=true
both: schema=1.0, polygon_lengths=[4], page=1, structured=null, request-ID header/body/syntax passed, recognized text redacted
```

The exact hardening/process commands were:

```sh
docker inspect local-ocr-m3-tesseract-http --format 'Image={{.Image}} User={{.Config.User}} ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} CapDrop={{json .HostConfig.CapDrop}} SecurityOpt={{json .HostConfig.SecurityOpt}} PidsLimit={{.HostConfig.PidsLimit}} NanoCpus={{.HostConfig.NanoCpus}} Memory={{.HostConfig.Memory}} PortBindings={{json .HostConfig.PortBindings}} Tmpfs={{json .HostConfig.Tmpfs}}'
docker exec local-ocr-m3-tesseract-http sh -c 'id; grep -E "^(Uid|Gid|CapEff|NoNewPrivs):" /proc/1/status'
docker exec local-ocr-m3-tesseract-http sh -c 'touch /rootfs-probe'
docker exec local-ocr-m3-tesseract-http sh -c 'touch /tmp/tmpfs-probe && test -f /tmp/tmpfs-probe && rm /tmp/tmpfs-probe && echo tmpfs_probe=passed'
docker top local-ocr-m3-tesseract-http -eo pid,user,group,args
```

The inspection, identity, tmpfs, and process commands exited 0. The rootfs write failed
as expected and its controlling assertion exited 0. Key output resolved exact image
`25b27d1...a9aec77`, UID/GID 10001, `ReadonlyRootfs=true`, `CapDrop=[ALL]`,
`SecurityOpt=[no-new-privileges]`, 256 PIDs, two CPUs, 2 GiB RAM, loopback port 18012,
`CapEff=0`, `NoNewPrivs=1`, writable `/tmp`, and one Uvicorn worker.

```console
$ docker stats --no-stream local-ocr-m3-tesseract-http --format 'Name={{.Name}} CPU={{.CPUPerc}} Memory={{.MemUsage}} MemoryPercent={{.MemPerc}} PIDs={{.PIDs}}'
Name=local-ocr-m3-tesseract-http CPU=0.19% Memory=36.83MiB / 2GiB MemoryPercent=1.80% PIDs=2
# exit 0
$ docker inspect local-ocr-m3-tesseract-http --format 'Status={{.State.Status}} Running={{.State.Running}} OOMKilled={{.State.OOMKilled}} ExitCode={{.State.ExitCode}} StartedAt={{.State.StartedAt}}'
Status=running Running=true OOMKilled=false ExitCode=0 StartedAt=2026-09-04T06:47:28.460559887Z
# exit 0
```

This is one idle post-smoke resource snapshot, not a peak or benchmark series. The full
mode-0600 service log was 10 lines/891 bytes with SHA-256
`09d05ee7d561354585063131b2f6518d6412b6ea3f1eed8d831afd8d5e512ee9`.
Exact `grep -Fq -f` scans using non-output mode-0600 API-key and expected-text pattern
files both returned 1; their controlling assertions reported
`api_key_present_in_log=false` and `expected_fixture_text_present_in_log=false` and
exited 0. Docker still held the key in container environment/config metadata while the
container existed.

```console
$ docker stop --time 10 local-ocr-m3-tesseract-http
local-ocr-m3-tesseract-http
# exit 0
$ docker rm local-ocr-m3-tesseract-http
local-ocr-m3-tesseract-http
# exit 0
```

### Network-disabled real warmup

**CURRENT — passed**

```console
$ docker run --rm --network none --env-file /tmp/local-ocr-services-m3.Jt02KG/runtime.env --env OCR_TESSERACT_LANGUAGES=chi_tra+eng --read-only --tmpfs /tmp:size=128m,mode=1777 --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --cpus 2 --memory 2g sha256:25b27d10815f4c167b7915829b010514fff5d9a48c32271bf05154e9469aec77 python -m ocr_service.warmup
warmed tesseract tessdata:chi_tra+eng
# exit 0
```

This invoked the real Tesseract adapter and engine on an in-memory image; it was not a
mock or import-only check.

### Network-disabled same-namespace HTTP smoke

**CURRENT — passed**

The repository harness and readable mount copy had identical SHA-256
`4715f37d18cba3556b8ea6455ee7c31676aa32d90a24dcf885c16ac5d9dae67b`.
The mounted fixtures retained the S-008 checksums. The exact command was:

```sh
docker run --rm --network none \
  --env-file /tmp/local-ocr-services-m3.Jt02KG/runtime.env \
  --env OCR_TESSERACT_LANGUAGES=chi_tra+eng \
  --read-only --tmpfs /tmp:size=128m,mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 256 --cpus 2 --memory 2g \
  --mount type=bind,src=/tmp/local-ocr-services-m3-mount/tesseract_http_smoke.py,dst=/verify/tesseract_http_smoke.py,readonly \
  --mount type=bind,src=/tmp/local-ocr-services-m3-mount/traditional.png,dst=/verify/traditional.png,readonly \
  --mount type=bind,src=/tmp/local-ocr-services-m3-mount/english.png,dst=/verify/english.png,readonly \
  sha256:25b27d10815f4c167b7915829b010514fff5d9a48c32271bf05154e9469aec77 \
  python /verify/tesseract_http_smoke.py --fixture-dir /verify \
  --start-server --expect-network-none
```

It exited 0 with:

```text
interfaces=[[1, lo]], only_loopback=true
uid=10001, gid=10001, CapEff=0000000000000000, NoNewPrivs=1, rootfs_read_only=true
ready=200 after 10 attempts/916.345 ms; live=200
missing_api_key=401 unauthorized; invalid_api_key=401 unauthorized
traditional.png=200, 1200x300, 1 region, confidence=0.772000, elapsed_ms=307.204, expected_text_hash_match=true
english.png=200, 1600x400, 1 region, confidence=0.952500, elapsed_ms=332.561, expected_text_hash_match=true
server log: startup=true, HTTP 200=4, HTTP 401=2, api_key_present=false, recognized_ocr_text_present=false
```

The service and client shared the same network namespace with only loopback visible.
This proves that exact image operates under Docker `--network none` on this host. No
socket instrumentation was used, so it does not prove absence of socket attempts.

At `2026-09-04T08:49:28+02:00`, a filtered `docker ps` returned no container derived
from the exact image, while `docker image inspect` reconfirmed image
`25b27d1...a9aec77`, Linux amd64, 286,794,521 bytes, tag
`local-ocr-services/tesseract:verify-f6c2190`, and empty `RepoDigests`.

**S-009 — DONE.** Tesseract remains `CONDITIONAL`, not production-promoted. The two
functional fixtures passed observable expected-result hash checks, but S-010 benchmark
sampling, S-011 saturation behavior, and human-approved S-016 representative quality
remain outstanding. M3 acceptance awaits the repository gate, independent review,
stage cleanup, commit, and private GitHub persistence.

## M3 reviewer rework — exact command provenance

**CURRENT — evidence added in response to T-005 REWORK**

This section supplies the exact commands missing from the first M3 draft. It does not
replace, weaken, or reinterpret the results above. Commands which read private fixture
text or the test API key never print those values. The private files remain under the
mode-0700 M3 stage until acceptance cleanup.

### Historical image inspection and source comparison

The exact successful historical identity command was:

```sh
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 256 \
  sha256:eff9305a812c1f58508fa7dc0375770674e875b2420d9dbd4703297e34c52ef5 \
  sh -c 'set -eu; cd /app; find src/ocr_service -type f -name "*.py" -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum; sha256sum requirements/base.txt requirements/tesseract.txt /usr/local/bin/ocr-entrypoint; sha256sum -c /opt/ocr-artifacts.sha256 >/dev/null; printf "artifact_check=passed\n"; wc -l /opt/ocr-artifacts.sha256; sha256sum /opt/ocr-artifacts.sha256; du -sb /usr/share/tesseract-ocr; tesseract --version | sed -n "1p"; printf "languages="; tesseract --list-langs 2>/dev/null | tail -n +2 | LC_ALL=C sort | paste -sd, -; python -c "import importlib.metadata as m,platform,pytesseract; print(\"python=\"+platform.python_version()); print(\"pytesseract_wrapper=\"+m.version(\"pytesseract\")); print(\"engine_via_wrapper=\"+str(pytesseract.get_tesseract_version()))"; sed -n "1,8p" /etc/os-release'
```

It exited 0. Its output is the historical source/dependency/manifest/engine/language
block recorded under S-008 above: source aggregate `36be348...bb93`, manifest check
passed with four entries, Tesseract 5.5.0, pytesseract 0.3.13, and languages
`chi_sim,chi_tra,eng,osd`. One preceding rework attempt used `sed -n "2,$p"` inside the
inner shell; `set -u` interpreted `$p` as an unset shell parameter, so that attempt
exited 1 after printing `sh: 1: p: parameter not set`. No claim relies on the failed
attempt; the successful command above replaced it with `tail -n +2`.

The image files were exported and compared with these exact commands:

```sh
install -d -m 700 /tmp/local-ocr-services-m3.Jt02KG/embedded-rework
set -o pipefail
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 256 \
  sha256:eff9305a812c1f58508fa7dc0375770674e875b2420d9dbd4703297e34c52ef5 \
  sh -c 'set -eu; cd /app; tar -cf - src/ocr_service requirements/base.txt requirements/tesseract.txt' \
  | tar -xf - -C /tmp/local-ocr-services-m3.Jt02KG/embedded-rework
python3 -m py_compile .team/evidence/M3/compare_image_source.py
sha256sum .team/evidence/M3/compare_image_source.py
python3 .team/evidence/M3/compare_image_source.py \
  --host-root /home/ckc/test/codex/local-ocr-services \
  --image-root /tmp/local-ocr-services-m3.Jt02KG/embedded-rework
```

Every command exited 0. The preserved comparison program has SHA-256
`c88b55d6475e3dc81e7a0d1e00753b2bfa651808d14d1a9b2cc9f72d15dca90f`.
It compares fourteen sorted Python paths followed by both requirement files, and defines
the newline-only normalization exactly as `value.rstrip(b"\r\n")`. Its output was:

```text
compared=16
exact_mismatches=7
exact_mismatch_paths=src/ocr_service/__init__.py,src/ocr_service/api_models.py,src/ocr_service/backends/__init__.py,src/ocr_service/backends/base.py,src/ocr_service/backends/registry.py,src/ocr_service/warmup.py,requirements/tesseract.txt
non_newline_mismatches=0
non_newline_mismatch_paths=
```

### Exact rebuilt-image provenance

The complete host/image comparison was:

```sh
printf 'HOST\n'
find src/ocr_service -type f -name '*.py' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum
sha256sum requirements/base.txt requirements/tesseract.txt docker/entrypoint.sh
printf 'IMAGE\n'
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 256 \
  sha256:25b27d10815f4c167b7915829b010514fff5d9a48c32271bf05154e9469aec77 \
  sh -c 'set -eu; cd /app; find src/ocr_service -type f -name "*.py" -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum; sha256sum requirements/base.txt requirements/tesseract.txt /usr/local/bin/ocr-entrypoint; sha256sum -c /opt/ocr-artifacts.sha256 >/dev/null; printf "artifact_check=passed\n"; wc -l /opt/ocr-artifacts.sha256; sha256sum /opt/ocr-artifacts.sha256; du -sb /usr/share/tesseract-ocr; tesseract --version | sed -n "1p"; printf "languages="; tesseract --list-langs 2>/dev/null | tail -n +2 | LC_ALL=C sort | paste -sd, -; python -c "import importlib.metadata as m,platform,pytesseract; print(\"python=\"+platform.python_version()); print(\"pytesseract_wrapper=\"+m.version(\"pytesseract\")); print(\"engine_via_wrapper=\"+str(pytesseract.get_tesseract_version()))"; sed -n "1,8p" /etc/os-release'
```

The combined command exited 0. Host and image source aggregates were both
`d5e83c2...d5a6`; both requirements and the entrypoint matched their frozen checksums;
the four-file artifact manifest passed; and the output reconfirmed Tesseract 5.5.0,
pytesseract 0.3.13, `chi_sim,chi_tra,eng,osd`, Python 3.11.15, and Debian 13.6.

### Build-window, archive, and current resource commands

Immediately before and after the build, the same read-only command group was used:

```sh
docker system df
docker ps -q | wc -l
df -B1 /var/lib/docker
free -b
cat /proc/loadavg
```

Both command groups exited 0. The pre-build key values were 145 images using 43.56 GB,
16 running containers, 143,953,354,752 filesystem bytes available,
14,669,414,400 RAM bytes available, and load1 12.36. The post-build key values were
146 images using 43.72 GB, 16 running containers, 143,806,341,120 filesystem bytes
available, 14,713,229,312 RAM bytes available, and load1 21.94. They are point-in-time
shared-host values, not isolated attribution to the build.

The exact raw-sample aggregation and evidence-file identity commands were:

```sh
awk -F '\t' 'NR>1 {n++; used=$2-$3; if (n==1 || used>maxused) maxused=used; if (n==1 || $3<minavail) minavail=$3; if ($4>maxcpu) maxcpu=$4; if ($5>maxload) maxload=$5; if ($6>maxrss) maxrss=$6} END {printf "samples=%d peak_host_used_bytes=%.0f min_host_available_bytes=%.0f max_host_cpu_busy_percent=%.2f max_load1=%.2f max_dockerd_rss_kib=%.0f\n", n,maxused,minavail,maxcpu,maxload,maxrss}' /tmp/local-ocr-services-m3.Jt02KG/build-host-samples.tsv
wc -l -c /tmp/local-ocr-services-m3.Jt02KG/build-host-samples.tsv /tmp/local-ocr-services-m3.Jt02KG/build.log /tmp/local-ocr-services-m3.Jt02KG/build-time.txt
sha256sum /tmp/local-ocr-services-m3.Jt02KG/build-host-samples.tsv /tmp/local-ocr-services-m3.Jt02KG/build.log /tmp/local-ocr-services-m3.Jt02KG/build-time.txt
```

They exited 0. Aggregation returned 22 samples, peak host-used RAM 12,864,000,000
bytes, minimum available RAM 14,449,500,000 bytes, maximum aggregate CPU busy 100.00%,
load1 15.96, and maximum dockerd RSS 446,876 KiB. The raw samples and build log hashes
match those recorded above; `build-time.txt` is 3 lines/78 bytes with SHA-256
`b40e273bbb8381287745ff9719428cfb48410e039195890da25c809821bc7b93`.

Archive creation and identity used:

```sh
docker save --output /tmp/local-ocr-services-m3.Jt02KG/tesseract-verify-f6c2190.tar \
  sha256:25b27d10815f4c167b7915829b010514fff5d9a48c32271bf05154e9469aec77
gzip -1 -c /tmp/local-ocr-services-m3.Jt02KG/tesseract-verify-f6c2190.tar \
  > /tmp/local-ocr-services-m3.Jt02KG/tesseract-verify-f6c2190.tar.gz
stat -c 'mode=%a owner=%U group=%G bytes=%s path=%n' \
  /tmp/local-ocr-services-m3.Jt02KG/tesseract-verify-f6c2190.tar \
  /tmp/local-ocr-services-m3.Jt02KG/tesseract-verify-f6c2190.tar.gz
sha256sum /tmp/local-ocr-services-m3.Jt02KG/tesseract-verify-f6c2190.tar \
  /tmp/local-ocr-services-m3.Jt02KG/tesseract-verify-f6c2190.tar.gz
```

All commands exited 0. Both archives were mode 0600. Sizes and hashes were respectively
293,168,640 bytes / `ee978c85...0c41` and 122,390,996 bytes /
`e46c90cf...b138`; they remain archive SHA-256 values, not registry digests.

A later reviewer-rework snapshot ran the same five read-only resource commands and
exited 0, but it is not substituted for build-window evidence. At that later time the
host still had 16 running containers and 146 images using 43.72 GB, while filesystem,
RAM, and load had independently changed.

### Credential and checksum-fixed fixture creation

The M3 stage and credential were created with these commands; neither command printed
the generated key:

```sh
mktemp -d /tmp/local-ocr-services-m3.XXXXXX
chmod 700 /tmp/local-ocr-services-m3.Jt02KG
install -m 600 /dev/null /tmp/local-ocr-services-m3.Jt02KG/runtime.env
openssl rand -hex 32 | sed 's/^/OCR_API_KEY=/' > /tmp/local-ocr-services-m3.Jt02KG/runtime.env
install -m 600 /dev/null /tmp/local-ocr-services-m3.Jt02KG/api-key-only
sed -n 's/^OCR_API_KEY=//p' /tmp/local-ocr-services-m3.Jt02KG/runtime.env > /tmp/local-ocr-services-m3.Jt02KG/api-key-only
stat -c 'mode=%a owner=%U group=%G bytes=%s path=%n' \
  /tmp/local-ocr-services-m3.Jt02KG \
  /tmp/local-ocr-services-m3.Jt02KG/runtime.env \
  /tmp/local-ocr-services-m3.Jt02KG/api-key-only \
  /tmp/local-ocr-services-m3.Jt02KG/expected-text-only
grep -Eq '^OCR_API_KEY=[0-9a-f]{64}$' /tmp/local-ocr-services-m3.Jt02KG/runtime.env
test "$(wc -l < /tmp/local-ocr-services-m3.Jt02KG/expected-text-only)" -eq 2
```

The `mktemp` command returned `/tmp/local-ocr-services-m3.Jt02KG`; all commands exited
0. The directory was mode 0700. `runtime.env`, `api-key-only`, and the two-line private
fixture source were mode 0600 and respectively 77, 65, and 53 bytes. The fixture source
was populated privately and is treated as OCR input: its content, checksum, and literal
population command are deliberately not recorded. Its file mode and two-line shape are
recorded; the reproducible non-secret rendering procedure is preserved below.

The checksum-addressed program
`.team/evidence/M3/generate_functional_fixtures.py` has SHA-256
`baa1b7498fb8f6aa24ceb57c97e8ba82c157b0493e2365d5dfe2d5563347f819`.
It reads the protected two-line input without printing it, renders with a fixed Noto CJK
font, and fails unless both PNG hashes equal the frozen identities. Its exact execution
was:

```sh
python3 -m py_compile .team/evidence/M3/generate_functional_fixtures.py
sha256sum .team/evidence/M3/generate_functional_fixtures.py
docker run --rm \
  --volume /tmp/local-ocr-services-m3.Jt02KG:/fixtures \
  --mount type=bind,src=/home/ckc/test/codex/local-ocr-services/.team/evidence/M3/generate_functional_fixtures.py,dst=/generate_functional_fixtures.py,readonly \
  local-ocr-services:test \
  sh -c 'set -eu; umask 077; apt-get update >/fixtures/fixture-generation.log 2>&1; DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends fonts-noto-cjk >>/fixtures/fixture-generation.log 2>&1; python /generate_functional_fixtures.py --private-text-file /fixtures/expected-text-only --output-dir /fixtures; chmod 0644 /fixtures/traditional.png /fixtures/english.png; chmod 0600 /fixtures/fixture-generation.log'
docker run --rm --network none \
  --volume /tmp/local-ocr-services-m3.Jt02KG:/fixtures \
  local-ocr-services:test chmod 0644 /fixtures/fixture-generation.log
stat -c 'mode=%a owner=%U group=%G bytes=%s path=%n' \
  /tmp/local-ocr-services-m3.Jt02KG/traditional.png \
  /tmp/local-ocr-services-m3.Jt02KG/english.png \
  /tmp/local-ocr-services-m3.Jt02KG/fixture-generation.log
sha256sum /tmp/local-ocr-services-m3.Jt02KG/traditional.png \
  /tmp/local-ocr-services-m3.Jt02KG/english.png \
  /tmp/local-ocr-services-m3.Jt02KG/fixture-generation.log
file /tmp/local-ocr-services-m3.Jt02KG/traditional.png \
  /tmp/local-ocr-services-m3.Jt02KG/english.png
wc -l -c /tmp/local-ocr-services-m3.Jt02KG/fixture-generation.log
```

The compile, checksum, generation, permission correction, and final inspection commands
all exited 0. The generator printed only
`generated_fixtures=2 checksums=passed private_text=not_printed`. The PNG identities
remain `a6d70d...49b3` at 18,028 bytes / RGB 1200x300 and `9d2fbd...983` at 16,132
bytes / RGB 1600x400. Their owner is the Docker user-namespace mapping
`nobody:nogroup`, their mode is 0644, and the parent directory is mode 0700. The
non-secret apt log is 25 lines/1,845 bytes, mode 0644 under that protected parent, with
SHA-256 `0822c284...4241`.

Before the mode correction, one combined `stat`/`sha256sum` command exited 1 because the
container-created mode-0600 log was owned by the user-namespace mapping and therefore
unreadable by the host user. The PNG results in that partial output were already correct.
The network-none chmod command above changed only the non-secret apt log to mode 0644;
the protected 0700 parent still prevents access by other host users. Final inspection
then exited 0. Two earlier private rendering-parameter searches returned
`no exact render match`; a corrected pixel-bounds comparison found Noto Sans CJK at
size 72 and position `(50, 90)`. Only the fixed, checksum-enforcing generator is used as
acceptance evidence.

### Online log and offline mount privacy checks

The mode-0600 online service log was captured before the disposable container was
removed:

```sh
install -m 600 /dev/null /tmp/local-ocr-services-m3.Jt02KG/s009-online.log
docker logs --timestamps local-ocr-m3-tesseract-http \
  > /tmp/local-ocr-services-m3.Jt02KG/s009-online.log 2>&1
chmod 600 /tmp/local-ocr-services-m3.Jt02KG/s009-online.log
```

Those commands exited 0. The exact final inspection and controlling assertions were:

```sh
stat -c 'mode=%a owner=%U group=%G bytes=%s path=%n' \
  /tmp/local-ocr-services-m3.Jt02KG/s009-online.log \
  /tmp/local-ocr-services-m3.Jt02KG/api-key-only \
  /tmp/local-ocr-services-m3.Jt02KG/expected-text-only
wc -l -c /tmp/local-ocr-services-m3.Jt02KG/s009-online.log
sha256sum /tmp/local-ocr-services-m3.Jt02KG/s009-online.log
if grep -Fq -f /tmp/local-ocr-services-m3.Jt02KG/api-key-only /tmp/local-ocr-services-m3.Jt02KG/s009-online.log; then
  echo api_key_present_in_log=true
  exit 1
else
  rc=$?
  test "$rc" -eq 1
  echo api_key_present_in_log=false grep_exit=1
fi
if grep -Fq -f /tmp/local-ocr-services-m3.Jt02KG/expected-text-only /tmp/local-ocr-services-m3.Jt02KG/s009-online.log; then
  echo expected_fixture_text_present_in_log=true
  exit 1
else
  rc=$?
  test "$rc" -eq 1
  echo expected_fixture_text_present_in_log=false grep_exit=1
fi
```

The combined check exited 0. The three private files were mode 0600; the log was 10
lines/891 bytes with SHA-256 `09d05ee7...2ee9`. Each raw `grep` condition returned the
expected 1, and the controlling branches verified exactly that status before reporting
both patterns absent.

The same-namespace harness and fixture copies were prepared and verified with:

```sh
install -d -m 755 /tmp/local-ocr-services-m3-mount
install -m 644 .team/evidence/M3/tesseract_http_smoke.py \
  /tmp/local-ocr-services-m3-mount/tesseract_http_smoke.py
install -m 644 /tmp/local-ocr-services-m3.Jt02KG/traditional.png \
  /tmp/local-ocr-services-m3-mount/traditional.png
install -m 644 /tmp/local-ocr-services-m3.Jt02KG/english.png \
  /tmp/local-ocr-services-m3-mount/english.png
sha256sum .team/evidence/M3/tesseract_http_smoke.py \
  /tmp/local-ocr-services-m3-mount/tesseract_http_smoke.py \
  /tmp/local-ocr-services-m3.Jt02KG/traditional.png \
  /tmp/local-ocr-services-m3-mount/traditional.png \
  /tmp/local-ocr-services-m3.Jt02KG/english.png \
  /tmp/local-ocr-services-m3-mount/english.png
stat -c 'mode=%a owner=%U group=%G bytes=%s path=%n' \
  /tmp/local-ocr-services-m3-mount \
  /tmp/local-ocr-services-m3-mount/tesseract_http_smoke.py \
  /tmp/local-ocr-services-m3-mount/traditional.png \
  /tmp/local-ocr-services-m3-mount/english.png
```

All commands exited 0. The source and mounted harness hashes both equal
`4715f37d...e67b`; each source/mount fixture pair equals its frozen S-008 hash. The
directory is mode 0755 and all three mounted files are mode 0644 so container UID 10001
can read them. Their content is synthetic and non-sensitive; no fixture text is printed
or committed.

All five T-005 command-provenance groups are now addressed. M3 remains `IN REVIEW`
until independent re-review, final repository gates, cleanup of only the two documented
M3 temporary paths, Git acceptance bookkeeping, commit, and private GitHub push.

The reviewer-rework CURRENT interval closed with:

```console
$ date --iso-8601=seconds
2026-09-04T09:13:40+02:00
# exit 0
```

This timestamp extends the document-level CURRENT interval at the top of this file. Git
review/acceptance bookkeeping and cleanup may occur later without being described as
target runtime evidence.

## M3 technical acceptance and cleanup

**POST-CURRENT — review, repository gate, and cleanup bookkeeping**

The independent T-005 review retained its initial REWORK and timestamp REWORK sections,
then returned final `ACCEPT`. It found no remaining contradiction or evidence defect;
this does not change the `CONDITIONAL` Tesseract promotion status or complete S-010,
S-011, or S-016.

Repository gates after the command-provenance rework were:

```console
$ make check
...
38 passed in 1.37s
syntax OK: 18 Python files
rapidocr
tesseract
paddle-structure
# exit 0

$ python3 /home/ckc/test/codex/codex-team-superpowers/scripts/teamctl.py validate-task .team/tasks/T-005.md
validate-task validation passed: .team/tasks/T-005.md
# exit 0
$ python3 /home/ckc/test/codex/codex-team-superpowers/scripts/teamctl.py validate-report .team/reports/T-005.md
validate-report validation passed: .team/reports/T-005.md
# exit 0
$ git diff --check
# exit 0
```

Before removing the protected stage, exact-pattern scans over every intended M3
repository file used the mode-0600 `api-key-only` and `expected-text-only` files. Each
raw `grep -Fq -f` returned 1; controlling assertions required exactly 1 and returned:

```text
api_key_present_in_m3_repo_changes=false grep_exit=1
fixture_text_present_in_m3_repo_changes=false grep_exit=1
# controlling command exit 0
```

The four intended M3 evidence sources were the only files under `.team/evidence/M3`;
generated `__pycache__` was absent. After listing both temporary trees and confirming
their real paths and sizes (397 MiB and 52 KiB), the orchestrator ran:

```sh
rm -rf /tmp/local-ocr-services-m3.Jt02KG /tmp/local-ocr-services-m3-mount
```

This cleanup command exited 0 and removed only M3-created temporary artifacts, including
the test API key, private fixture text, generated PNGs, build logs/samples, extracted
historical source, and Docker archive copies. These paths are not recoverable from the
workspace; the non-secret audit programs and reported hashes remain in the repository.

```console
$ date --iso-8601=seconds
2026-09-04T09:15:31+02:00
# exit 0
$ for path in /tmp/local-ocr-services-m3.Jt02KG /tmp/local-ocr-services-m3-mount; do if test -e "$path"; then echo "cleanup_failed path=$path"; exit 1; else echo "cleanup_absent path=$path"; fi; done
cleanup_absent path=/tmp/local-ocr-services-m3.Jt02KG
cleanup_absent path=/tmp/local-ocr-services-m3-mount
# exit 0
$ docker ps -a --filter ancestor=sha256:25b27d10815f4c167b7915829b010514fff5d9a48c32271bf05154e9469aec77 --format 'ID={{.ID}} Name={{.Names}} Status={{.Status}}'
# exit 0; no matching container
$ docker image inspect sha256:25b27d10815f4c167b7915829b010514fff5d9a48c32271bf05154e9469aec77 --format 'Id={{.Id}} RepoTags={{json .RepoTags}} RepoDigests={{json .RepoDigests}} Os={{.Os}} Architecture={{.Architecture}} Size={{.Size}} User={{.Config.User}}'
Id=sha256:25b27d10815f4c167b7915829b010514fff5d9a48c32271bf05154e9469aec77 RepoTags=["local-ocr-services/tesseract:verify-f6c2190"] RepoDigests=[] Os=linux Architecture=amd64 Size=286794521 User=10001:10001
# exit 0
```

M3 is technically accepted. The exact image remains a local artifact only; no registry
image was published. Milestone completion still requires Git commit and private GitHub
persistence, followed by clean local/remote parity evidence. Formal deployment remains
blocked pending explicit human authorization.

## M3 GitHub persistence

**POST-CURRENT — Git bookkeeping**

The accepted M3 evidence was committed and pushed to the previously authorized private
repository:

```console
$ git commit -m "verify Tesseract on target host"
[main f98e59a] verify Tesseract on target host
 8 files changed, 1443 insertions(+), 7 deletions(-)
# exit 0
$ git push origin main
To https://github.com/fallrising/local-ocr-services.git
   f6c2190..f98e59a  main -> main
# exit 0
$ date --iso-8601=seconds
2026-09-04T09:16:51+02:00
# exit 0
$ git rev-parse HEAD
f98e59a8a999aec3168735f5d119d12d83e57b94
# exit 0
```

The first combined local/remote parity probe reached `git ls-remote` inside the
restricted sandbox and exited 128 with `Could not resolve host: github.com`; that is a
sandbox network failure, not evidence of a GitHub mismatch. The required read-only
network retry was then run with approved network access:

```console
$ git ls-remote origin refs/heads/main
f98e59a8a999aec3168735f5d119d12d83e57b94 refs/heads/main
# exit 0
$ git status --short --branch
## main...origin/main
# exit 0; clean after technical evidence commit
```

M3 evidence is therefore persisted on private GitHub. This final documentation/PLAN
bookkeeping is committed separately so the milestone state is resumable. No Git remote,
registry artifact, release, production stack, proxy, firewall, DNS, TLS, or public
endpoint was created or changed. M4 may proceed; formal deployment remains blocked.

## M4 tooling checkpoint

**CURRENT — 2026-09-04; documentation/tooling review only**

M4's measurement protocol was committed before load execution, but T-006 tooling has
not passed orchestrator or independent review. The initial worker delivery and its one
rework were rejected for statistical, saturation, privacy, exact-image cancellation,
security-capture, and maintainability defects. In particular, nearest-rank percentiles
must use `sorted_samples[ceil(p*n)-1]`; with N=20, p50 and p95 select zero-based indexes
9 and 18. This correction is specification evidence only, not runtime benchmark data.

The escalated worker was interrupted when the human requested a safe checkpoint. Its
candidate files remain uncommitted in the local `agent/t006` worktree and are not part of
this target-verification record. No candidate M4 program was copied to `main`, no M4
benchmark or saturation request was run, and no performance/resource result is claimed.

```console
$ date --utc --iso-8601=seconds
2026-09-04T07:47:59+00:00
# exit 0
$ docker ps --all --filter name=m4- --format '{{.ID}} {{.Names}} {{.Status}}'
# exit 0; empty output, no retained M4 container
$ git status --short --branch
## main...origin/main
 M .team/PLAN.md
 M .team/tasks/T-006.md
 M docs/specs/target-server-verification.md
# exit 0
$ git rev-parse HEAD
29a330555d797a4d3bc57246563433ed71d45f1b
# exit 0
$ git rev-parse origin/main
29a330555d797a4d3bc57246563433ed71d45f1b
# exit 0
$ git -C /home/ckc/test/codex/worktrees/local-ocr-services-T-006 status --short --branch
## agent/t006
 M .team/tasks/T-006.md
?? .team/evidence/M4/
?? .team/reports/T-006.md
# exit 0
```

The first restricted-sandbox `make check` attempt exited 2 because access to
`/var/run/docker.sock` was denied; this was an execution-environment permission failure,
not a test failure. The authorized Docker rerun completed the repository-native gate:

```console
$ make check
......................................                                   [100%]
38 passed in 1.52s
syntax OK: 18 Python files
rapidocr
tesseract
paddle-structure
# exit 0
```

Checkpoint status: S-010 and S-011 are `PENDING`; S-016 remains `BLOCKED` on approved
representative fixtures; RapidOCR and Tesseract remain `CONDITIONAL`; Paddle remains
`NO-GO` on current capacity evidence; S-020 remains `BLOCKED` pending explicit human
deployment authorization.
