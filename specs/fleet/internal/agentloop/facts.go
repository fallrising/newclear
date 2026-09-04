package agentloop

import (
	"bufio"
	"os"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func CollectFacts(dockerOK bool, dockerRunning int) map[string]any {
	facts := map[string]any{
		"ncpu":                     runtime.NumCPU(),
		"load1":                    load1(),
		"mem_total_mb":             0,
		"mem_used_mb":              0,
		"mem_used_pct":             0,
		"disk_root_used_pct":       0,
		"docker_ok":                dockerOK,
		"docker_running_containers": dockerRunning,
	}
	if h, err := os.Hostname(); err == nil {
		facts["hostname"] = h
	}
	if b, err := os.ReadFile("/proc/sys/kernel/osrelease"); err == nil {
		facts["kernel"] = strings.TrimSpace(string(b))
	}
	if b, err := os.ReadFile("/proc/uptime"); err == nil {
		fields := strings.Fields(string(b))
		if len(fields) > 0 {
			if v, err := strconv.ParseFloat(fields[0], 64); err == nil {
				facts["uptime_seconds"] = int(v)
			}
		}
	}
	memTotal, memAvail := meminfo()
	if memTotal > 0 {
		used := memTotal - memAvail
		facts["mem_total_mb"] = memTotal / 1024
		facts["mem_used_mb"] = used / 1024
		facts["mem_used_pct"] = int(used * 100 / memTotal)
	}
	var st syscall.Statfs_t
	if err := syscall.Statfs("/", &st); err == nil && st.Blocks > 0 {
		used := 1.0 - float64(st.Bavail)/float64(st.Blocks)
		facts["disk_root_used_pct"] = int(used * 100)
		facts["disk_root_avail_bytes"] = int64(st.Bavail) * int64(st.Bsize)
		if st.Files > 0 {
			facts["inode_root_used_pct"] = int((1.0 - float64(st.Ffree)/float64(st.Files)) * 100)
		}
	}
	_ = time.Now()
	return facts
}

func load1() float64 {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(b))
	if len(fields) == 0 {
		return 0
	}
	v, _ := strconv.ParseFloat(fields[0], 64)
	return v
}

func meminfo() (total, avail int64) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		n, _ := strconv.ParseInt(fields[1], 10, 64)
		switch fields[0] {
		case "MemTotal:":
			total = n
		case "MemAvailable:":
			avail = n
		}
	}
	return total, avail
}
