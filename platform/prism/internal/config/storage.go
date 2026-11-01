package config

import (
	"context"
	"errors"
	"fmt"
	"io"
	"maps"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const maxStorageDSNBytes = 4096

var clickHouseNumericOptions = map[string]struct{ defaultValue, ceiling int }{
	"max_execution_time": {55, 3600},
	"max_memory_usage":   {1_000_000_000, 1 << 50},
	"max_result_rows":    {5_000_000, 1 << 30},
	"max_rows_to_read":   {5_000_000, 1 << 30},
	"max_result_bytes":   {64 << 20, 1 << 40},
	"max_open_conns":     {10, 1000},
}

// StorageOptions gives the daemon an independent option map with retention from
// the single config source. It never mutates user-supplied options.
func (c *Config) StorageOptions() (map[string]string, error) {
	if c == nil {
		return nil, errors.New("configuration is nil")
	}
	options := maps.Clone(c.Storage.Options)
	if options == nil {
		options = make(map[string]string)
	}
	if c.Storage.Driver != "clickhouse" {
		return options, nil
	}
	for key, days := range map[string]int{
		"retention_metrics_days": c.Storage.Retention.MetricsDays,
		"retention_logs_days":    c.Storage.Retention.LogsDays,
		"retention_traces_days":  c.Storage.Retention.TracesDays,
		"retention_red_days":     c.Storage.Retention.REDDays,
	} {
		if _, exists := options[key]; exists {
			return nil, fmt.Errorf("storage.options.%s conflicts with storage.retention", key)
		}
		options[key] = strconv.Itoa(days)
	}
	return options, nil
}

func validateClickHouseStorage(ctx context.Context, storage StorageConfig, query QueryConfig) error {
	if err := validateClickHouseDSN(string(storage.DSN)); err != nil {
		return err
	}
	parsed, _ := url.Parse(string(storage.DSN)) // validated above; never format this URL.
	for key, value := range storage.Options {
		if limits, ok := clickHouseNumericOptions[key]; ok {
			n, err := strconv.Atoi(value)
			if err != nil || n <= 0 || n > limits.ceiling {
				return fmt.Errorf("storage.options.%s is outside supported range", key)
			}
			continue
		}
		switch key {
		case "cluster":
			if value != "" {
				return fmt.Errorf("storage.options.cluster is unsupported")
			}
		case "async_insert":
			if value != "0" && value != "1" {
				return fmt.Errorf("storage.options.async_insert must be 0 or 1")
			}
		case "password_file", "username_file":
			if value == "" {
				return fmt.Errorf("storage.options.%s must not be empty", key)
			}
			if _, err := readStorageDSNFile(ctx, value); err != nil {
				return fmt.Errorf("storage.options.%s must be a bounded regular credential file: %w", key, err)
			}
			if key == "username_file" && (parsed.User != nil && parsed.User.Username() != "" || parsed.Query().Has("username")) {
				return fmt.Errorf("storage.options.username_file conflicts with storage.dsn identity")
			}
			if key == "password_file" && (parsed.User != nil && hasURLPassword(parsed.User) || parsed.Query().Has("password")) {
				return fmt.Errorf("storage.options.password_file conflicts with storage.dsn identity")
			}
		case "retention_metrics_days", "retention_logs_days", "retention_traces_days", "retention_red_days":
			return fmt.Errorf("storage.options.%s conflicts with storage.retention", key)
		default:
			return fmt.Errorf("storage.options.%s is unsupported", key)
		}
	}
	for _, days := range []int{storage.Retention.MetricsDays, storage.Retention.LogsDays, storage.Retention.TracesDays, storage.Retention.REDDays} {
		if days <= 0 || days > 36500 {
			return fmt.Errorf("storage.retention exceeds ClickHouse supported range")
		}
	}
	maxExec := clickHouseNumericOptions["max_execution_time"].defaultValue
	if supplied, ok := storage.Options["max_execution_time"]; ok {
		maxExec, _ = strconv.Atoi(supplied)
	}
	if query.Timeout.Std() <= time.Duration(maxExec)*time.Second {
		return fmt.Errorf("query.timeout must exceed storage.options.max_execution_time")
	}
	return nil
}

func hasURLPassword(user *url.Userinfo) bool {
	_, exists := user.Password()
	return exists
}

func validateClickHouseDSN(value string) error {
	if len(value) > maxStorageDSNBytes {
		return fmt.Errorf("storage.dsn exceeds supported length")
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "clickhouse" || u.Host == "" || strings.Trim(u.Path, "/") == "" || u.Opaque != "" || u.Fragment != "" || strings.Contains(strings.TrimPrefix(u.Path, "/"), "/") {
		return fmt.Errorf("storage.dsn must be a ClickHouse URL with host and database")
	}
	host, port, err := net.SplitHostPort(u.Host)
	if err != nil || host == "" || len(host) > 253 {
		return fmt.Errorf("storage.dsn must have one host and native port")
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65_535 {
		return fmt.Errorf("storage.dsn must have a valid native port")
	}
	if len(u.Path) > 256 || strings.IndexFunc(u.Path, func(r rune) bool { return r < ' ' }) >= 0 {
		return fmt.Errorf("storage.dsn database is outside supported range")
	}
	params, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return fmt.Errorf("storage.dsn has invalid query options")
	}
	for key, values := range params {
		switch key {
		case "secure", "dial_timeout", "read_timeout", "username", "password", "database":
		default:
			return fmt.Errorf("storage.dsn has unsupported query option")
		}
		if len(values) != 1 || values[0] == "" {
			return fmt.Errorf("storage.dsn has invalid query option")
		}
	}
	if u.User != nil && (params.Has("username") || params.Has("password")) || params.Has("database") {
		return fmt.Errorf("storage.dsn has duplicate identity source")
	}
	for _, key := range []string{"dial_timeout", "read_timeout"} {
		if value := params.Get(key); value != "" {
			d, err := time.ParseDuration(value)
			if err != nil || d <= 0 || d > time.Minute {
				return fmt.Errorf("storage.dsn has invalid timeout")
			}
		}
	}
	if secure := params.Get("secure"); secure != "" {
		if _, err := strconv.ParseBool(secure); err != nil {
			return fmt.Errorf("storage.dsn has invalid secure option")
		}
	}
	return nil
}

func readStorageDSNFile(ctx context.Context, path string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	info, err := os.Lstat(path)
	if err != nil || info == nil || !info.Mode().IsRegular() || info.Size() == 0 || info.Size() > maxStorageDSNBytes {
		return "", errors.New("expected a bounded regular file")
	}
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return "", errors.New("cannot open regular file")
	}
	file := os.NewFile(uintptr(fd), "storage-dsn")
	defer func() { _ = file.Close() }()
	info, err = file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 || info.Size() > maxStorageDSNBytes {
		return "", errors.New("expected a bounded regular file")
	}
	content, err := io.ReadAll(io.LimitReader(file, maxStorageDSNBytes+1))
	if err != nil || len(content) == 0 || len(content) > maxStorageDSNBytes {
		return "", errors.New("invalid bounded file content")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	value := strings.TrimRight(string(content), "\r\n")
	if value == "" {
		return "", errors.New("credential file is empty")
	}
	return value, nil
}
