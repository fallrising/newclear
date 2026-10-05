package clickhouse

import (
	"context"
	"errors"
	"io"
	"net/url"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

type options struct {
	native     *clickhouse.Options
	metricDays int
	logDays    int
	traceDays  int
	redDays    int
	maxOpen    int
	maxExec    int
	timeout    time.Duration
}

func parseOptions(ctx context.Context, cfg spi.Config) (options, error) {
	var out options
	u, err := url.Parse(cfg.DSN)
	if err != nil || u.Scheme != "clickhouse" || u.Host == "" || u.Opaque != "" || u.Fragment != "" || strings.Trim(u.Path, "/") == "" {
		return out, inputError("Open", "invalid ClickHouse DSN")
	}
	params, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return out, inputError("Open", "invalid DSN query")
	}
	allowedDSN := map[string]bool{"secure": true, "dial_timeout": true, "read_timeout": true, "username": true, "password": true, "database": true}
	for k, values := range params {
		if !allowedDSN[k] || len(values) != 1 || values[0] == "" {
			return out, inputError("Open", "invalid or duplicate DSN option")
		}
	}
	if params.Has("username") && u.User != nil || params.Has("password") && u.User != nil || params.Has("database") {
		return out, inputError("Open", "duplicate DSN identity source")
	}
	for _, key := range []string{"dial_timeout", "read_timeout"} {
		if s := params.Get(key); s != "" {
			d, err := time.ParseDuration(s)
			if err != nil || d <= 0 || d > time.Minute {
				return out, inputError("Open", "invalid DSN timeout")
			}
		}
	}
	allowed := map[string]bool{"cluster": true, "max_execution_time": true, "max_memory_usage": true, "max_result_rows": true, "async_insert": true, "max_open_conns": true, "retention_metrics_days": true, "retention_logs_days": true, "retention_traces_days": true, "retention_red_days": true, "password_file": true, "username_file": true}
	for k := range cfg.Options {
		if !allowed[k] {
			return out, inputError("Open", "unknown ClickHouse option")
		}
	}
	if cfg.Options["cluster"] != "" {
		return out, unsupportedError("Open", "cluster mode is unsupported")
	}
	out.native, err = clickhouse.ParseDSN(cfg.DSN)
	if err != nil {
		return out, inputError("Open", "invalid ClickHouse DSN")
	}
	if out.native.Auth.Password != "" && cfg.Options["password_file"] != "" {
		return out, inputError("Open", "duplicate password source")
	}
	if out.native.Auth.Username != "" && cfg.Options["username_file"] != "" {
		return out, inputError("Open", "duplicate username source")
	}
	if file := cfg.Options["password_file"]; file != "" {
		out.native.Auth.Password, err = readCredential(ctx, file)
		if err != nil {
			if ctx.Err() != nil {
				return out, classifiedError("Open", ctx.Err())
			}
			return out, inputError("Open", "invalid password file")
		}
	}
	if file := cfg.Options["username_file"]; file != "" {
		out.native.Auth.Username, err = readCredential(ctx, file)
		if err != nil {
			if ctx.Err() != nil {
				return out, classifiedError("Open", ctx.Err())
			}
			return out, inputError("Open", "invalid username file")
		}
	}
	if out.metricDays, err = positiveOption(cfg, "retention_metrics_days", 30, 36500); err != nil {
		return out, err
	}
	if out.logDays, err = positiveOption(cfg, "retention_logs_days", 14, 36500); err != nil {
		return out, err
	}
	if out.traceDays, err = positiveOption(cfg, "retention_traces_days", 7, 36500); err != nil {
		return out, err
	}
	if out.redDays, err = positiveOption(cfg, "retention_red_days", 90, 36500); err != nil {
		return out, err
	}
	if out.maxOpen, err = positiveOption(cfg, "max_open_conns", 10, 1000); err != nil {
		return out, err
	}
	out.maxExec, err = positiveOption(cfg, "max_execution_time", 55, 3600)
	if err != nil {
		return out, err
	}
	maxMem, err := positiveOption(cfg, "max_memory_usage", 1_000_000_000, 1<<50)
	if err != nil {
		return out, err
	}
	maxRows, err := positiveOption(cfg, "max_result_rows", 5_000_000, 1<<30)
	if err != nil {
		return out, err
	}
	async := 1
	if s, ok := cfg.Options["async_insert"]; ok {
		async, err = strconv.Atoi(s)
		if err != nil || (async != 0 && async != 1) {
			return out, inputError("Open", "invalid async_insert")
		}
	}
	out.timeout = time.Duration(out.maxExec+5) * time.Second
	out.native.MaxOpenConns = out.maxOpen
	out.native.MaxIdleConns = min(out.maxOpen, 5)
	if out.native.Settings == nil {
		out.native.Settings = clickhouse.Settings{}
	}
	out.native.Settings["max_execution_time"] = out.maxExec
	out.native.Settings["max_memory_usage"] = maxMem
	out.native.Settings["max_result_rows"] = maxRows
	out.native.Settings["async_insert"] = async
	out.native.Settings["wait_for_async_insert"] = 0
	out.native.Settings["async_insert_max_data_size"] = 10_485_760
	out.native.Settings["async_insert_busy_timeout_ms"] = 1000
	out.native.Settings["insert_deduplicate"] = 0
	out.native.Settings["flatten_nested"] = 1
	return out, nil
}

func positiveOption(cfg spi.Config, key string, def, ceiling int) (int, error) {
	s, ok := cfg.Options[key]
	if !ok {
		return def, nil
	}
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 || n > ceiling {
		return 0, inputError("Open", "invalid "+key)
	}
	return n, nil
}

func readCredential(ctx context.Context, path string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	info, err := os.Lstat(path)
	if err != nil || info.Size() > 4096 || !info.Mode().IsRegular() {
		return "", errors.New("invalid credential file")
	}
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return "", err
	}
	f := os.NewFile(uintptr(fd), "credential")
	defer func() { _ = f.Close() }()
	info, err = f.Stat()
	if err != nil || info.Size() > 4096 || !info.Mode().IsRegular() {
		return "", errors.New("invalid credential file")
	}
	b, err := io.ReadAll(io.LimitReader(f, 4097))
	if err != nil || len(b) == 0 || len(b) > 4096 {
		return "", errors.New("invalid credential content")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return strings.TrimRight(string(b), "\r\n"), nil
}
