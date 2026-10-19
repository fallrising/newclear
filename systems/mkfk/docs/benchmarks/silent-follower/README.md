# Compose check for the silent follower

Manual local run. It is not part of CI.

This asks one question about the existing three-broker Compose setup: during `rf3-isr2-b1-p1`, does finding 4 from [environment B](../m7-environment-b.md) show up? The workload numbers are the ones already written down: 1 KiB records, four closed-loop producers, `acks=all`, 10 s warm-up, 60 s measurement, three repeats, one partition, replication factor 3, min ISR 2. Nothing else is injected. No netem. No disk latency.

The topology is [the Compose cluster](../../deploy/compose.yaml) with only events partition 0, mounted from [silent-follower-cluster.json](../../deploy/silent-follower-cluster.json). Broker addresses in that file are the Compose network addresses already used by `configs/compose-cluster.json`.

## What “靜默 60 秒” means

A broker reproduces the finding when all of these hold for one measurement window:

- `mkfk_leader{topic="events",partition="0"}` is 0 at the scrape that opens the window and at the scrape that closes it
- `mkfk_fsync_total` does not increase between those scrapes
- the broker's log has zero lines whose timestamp falls in `[window start, window end)`

`有` means that happened on this Compose run. `沒有` means it did not happen here. `沒有` does not mean environment B is fine.

Lines are taken from `docker compose logs --timestamps`. A line that has no timestamp is not treated as silence: that broker is not counted. The two scrapes are the same window boundaries the bench already uses. A broker that leads the data partition at either scrape is not the non-leader in this check.

## Run

From `systems/mkfk`, with Docker able to build the local image:

```sh
make silent-follower
```

The script builds the image from the current checkout, starts Compose project `mkfk-silent-follower`, writes this directory's `results.json` and `broker-1.log`, `broker-2.log`, `broker-3.log`, then removes that project's containers and volumes. It does not start if that project already has volumes. It uses the same published ports as `make demo`, so do not run both at once.

The measurement itself is about three and a half minutes, plus the image build.

## How to read the output

The process prints one line, `靜默 60 秒：有` or `靜默 60 秒：沒有`. `results.json` repeats that verdict, the per-broker fsync delta, the leader gauges, the log-line count, and the produce error counts. Those error counts are context. They are not part of the verdict. The log files have IP addresses and absolute paths replaced with `[ip]` and `[path]`.

## Limits

This Compose project is not environment B. Environment B was three VMs with their own CPU, disk, and network; those parameters are not applied here, and this run does not claim to match them. A result of `有` shows the measurement can occur on this Compose setup. A result of `沒有` only says this run did not see it. Docker on one machine does not reproduce another machine's clock skew or its network, so this check cannot by itself show that the finding will not happen on environment B.
