# Verification Record

This record describes the local evidence collected on 2026-09-04. It is not a
substitute for accuracy, performance, and capacity testing on the deployment server.

The current staged assessment of host `de1` is recorded separately in
[`verification-target-de1.md`](verification-target-de1.md). Treat this file as historical
evidence and the target record as current rerun evidence; neither is a production
deployment authorization.

## Host

- Linux `x86_64`, 6 logical CPUs.
- 25 GiB RAM total, about 13 GiB available during verification, and no swap.
- About 140 GiB free on the Docker filesystem.

## Passed checks

- `make check`: 38 tests passed; Python syntax passed for 18 files; all three Compose
  profiles rendered independently.
- `docker build --check` for all four Dockerfiles: passed with no warnings.
- RapidOCR image build: passed, image ID
  `sha256:c31f55d1359844d0f9c17fdca37411ff267816fef4749624518c80aa3fbad845`.
- Tesseract image build: passed, image ID
  `sha256:eff9305a812c1f58508fa7dc0375770674e875b2420d9dbd4703297e34c52ef5`.
- Both images ran as UID/GID `10001:10001` with a read-only root filesystem and passed
  real-engine warmup with `--network none`.
- Both images passed authenticated HTTP OCR against an in-memory PNG. RapidOCR 3.9.2
  and Tesseract 5.5.0 each returned HTTP 200, the expected engine metadata, oriented
  dimensions, one recognized region, and the supplied request ID.
- Temporary HTTP smoke containers were stopped and removed.

## Deferred target-server evidence

The Paddle Structure Dockerfile and Compose profile passed static checks, and its
normalization contract has unit coverage. The full Paddle image was not built on this
host: its configured runtime budget is 16 GiB while only about 13 GiB was available and
the host has no swap.

Before promoting Paddle, build the exact image on the target server and exercise real
PaddleOCR 3.7 output for text, tables, and layout. Repeat authenticated OCR under
`--network none` and record the final image digest, peak RSS, CPU use, p50/p95 latency,
accuracy on representative documents, and saturation behavior. Repeat the performance
and accuracy measurements for RapidOCR and Tesseract as well.
