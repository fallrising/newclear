#!/bin/sh
set -eu

stage=/tmp/local-ocr-services-m3.Jt02KG
samples="$stage/build-host-samples.tsv"

sample_host() {
    previous_total=0
    previous_idle=0
    printf 'epoch\tmem_total_bytes\tmem_available_bytes\tcpu_busy_percent\tload1\tdockerd_rss_kib\n'
    while :; do
        set -- $(awk '/^cpu / {print $2,$3,$4,$5,$6,$7,$8,$9,$10,$11}' /proc/stat)
        user=$1
        nice=$2
        system=$3
        idle=$4
        iowait=$5
        irq=$6
        softirq=$7
        steal=$8
        guest=$9
        guest_nice=${10}
        total=$((user + nice + system + idle + iowait + irq + softirq + steal + guest + guest_nice))
        idle_total=$((idle + iowait))
        busy=0
        if [ "$previous_total" -ne 0 ]; then
            delta_total=$((total - previous_total))
            delta_idle=$((idle_total - previous_idle))
            if [ "$delta_total" -gt 0 ]; then
                busy=$(awk -v total="$delta_total" -v idle="$delta_idle" 'BEGIN {printf "%.2f", 100 * (total-idle) / total}')
            fi
        fi
        previous_total=$total
        previous_idle=$idle_total
        mem_total=$(awk '/^MemTotal:/ {print $2 * 1024}' /proc/meminfo)
        mem_available=$(awk '/^MemAvailable:/ {print $2 * 1024}' /proc/meminfo)
        load1=$(awk '{print $1}' /proc/loadavg)
        dockerd_rss=$(ps -C dockerd -o rss= | awk '{sum += $1} END {print sum + 0}')
        printf '%s\t%.0f\t%.0f\t%s\t%s\t%s\n' "$(date +%s)" "$mem_total" "$mem_available" "$busy" "$load1" "$dockerd_rss"
        sleep 1
    done
}

sample_host > "$samples" &
sample_pid=$!
trap 'kill "$sample_pid" 2>/dev/null || true; wait "$sample_pid" 2>/dev/null || true' EXIT INT TERM

build_start_epoch=$(date +%s)
build_start_iso=$(date --iso-8601=seconds)
set +e
docker build --no-cache --progress=plain \
    --file docker/Dockerfile.tesseract \
    --tag local-ocr-services/tesseract:verify-f6c2190 \
    . > "$stage/build.log" 2>&1
build_exit=$?
set -e
build_end_epoch=$(date +%s)
build_end_iso=$(date --iso-8601=seconds)
{
    printf 'start=%s\n' "$build_start_iso"
    printf 'end=%s\n' "$build_end_iso"
    printf 'wall_seconds=%s\n' "$((build_end_epoch - build_start_epoch))"
} > "$stage/build-time.txt"

kill "$sample_pid" 2>/dev/null || true
wait "$sample_pid" 2>/dev/null || true
trap - EXIT INT TERM
printf 'build_exit=%s\n' "$build_exit"
exit "$build_exit"
