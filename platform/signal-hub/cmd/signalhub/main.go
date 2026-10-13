package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/auth"
	"github.com/fallrising/newclear/platform/signal-hub/internal/config"
	"github.com/fallrising/newclear/platform/signal-hub/internal/delivery"
	"github.com/fallrising/newclear/platform/signal-hub/internal/httpapi"
	"github.com/fallrising/newclear/platform/signal-hub/internal/rules"
	"github.com/fallrising/newclear/platform/signal-hub/internal/store"
	"github.com/fallrising/newclear/platform/signal-hub/web"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "signalhub:", err)
		os.Exit(1)
	}
}

func listenAddress(value string) (string, error) {
	host, port, err := net.SplitHostPort(value)
	if err != nil {
		return "", errors.New("listen must be an explicit loopback or tailnet IP and port")
	}
	ip, err := netip.ParseAddr(host)
	n, portErr := strconv.Atoi(port)
	if err != nil || portErr != nil || n < 0 || n > 65535 || ip.Zone() != "" {
		return "", errors.New("invalid listen address")
	}
	ip = ip.Unmap()
	if !ip.IsLoopback() && !netip.MustParsePrefix("100.64.0.0/10").Contains(ip) && !netip.MustParsePrefix("fd7a:115c:a1e0::/48").Contains(ip) {
		return "", errors.New("listen address must be loopback or in the tailnet address range")
	}
	return net.JoinHostPort(ip.String(), strconv.Itoa(n)), nil
}

type runtimeOptions struct {
	senderFactory    func([]delivery.Subscription, []string) (*delivery.Sender, error)
	now              func() time.Time
	deliveryInterval time.Duration
}

func run(ctx context.Context, args []string, output io.Writer) error {
	return runWithOptions(ctx, args, output, runtimeOptions{})
}

// Options provide deterministic clocks and a pinned synthetic TLS receiver to
// integration tests. The CLI always uses the production defaults.
func runWithOptions(ctx context.Context, args []string, output io.Writer, options runtimeOptions) error {
	if options.now == nil {
		options.now = time.Now
	}
	if options.senderFactory == nil {
		options.senderFactory = delivery.NewSender
	}
	if options.deliveryInterval == 0 {
		options.deliveryInterval = time.Second
	}

	if len(args) >= 2 && args[0] == "rules" && args[1] == "backfill" {
		return backfill(ctx, args[2:], output)
	}
	flags := flag.NewFlagSet("signalhub", flag.ContinueOnError)
	flags.SetOutput(output)
	configPath := flags.String("config", "", "strict JSON configuration path (required)")
	dbPath := flags.String("db", "", "SQLite database file path (required)")
	ownerRef := flags.String("owner-token-ref", "", "owner file:/absolute/path (required)")
	readonlyRef := flags.String("readonly-token-ref", "", "optional readonly file:/absolute/path")
	bind := flags.String("listen", "127.0.0.1:8080", "explicit loopback or tailnet IP:port")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return errors.New("invalid command options")
	}
	if flags.NArg() != 0 || *configPath == "" || *dbPath == "" || *ownerRef == "" {
		return errors.New("config, db and owner-token-ref are required; see -help")
	}
	address, err := listenAddress(*bind)
	if err != nil {
		return err
	}
	cfg, err := config.Load(*configPath)
	if err != nil {
		return errors.New("configuration is invalid or unavailable")
	}
	credentials, err := auth.New(cfg.Sources, *ownerRef, *readonlyRef)
	if err != nil {
		return errors.New("credential files are invalid, unavailable or duplicated")
	}
	subscriptions, err := delivery.Parse(cfg.Subscriptions, cfg.WebhookAllowlist)
	if err != nil {
		return errors.New("subscription configuration is invalid")
	}
	sender, err := options.senderFactory(subscriptions, cfg.WebhookAllowlist)
	if err != nil {
		return errors.New("delivery credentials or targets are invalid or unavailable")
	}
	db, err := store.Open(*dbPath)
	if err != nil {
		return errors.New("database could not be opened or migrated")
	}
	defer db.Close()
	definitions, err := rules.Parse(cfg.Rules)
	if err != nil {
		return errors.New("rule configuration is invalid")
	}
	if err := db.ConfigureRuntime(ctx, cfg.Sources, definitions, options.now().UTC(), false, subscriptions); err != nil {
		return errors.New("runtime configuration could not be initialized; verify rule versions and subscription identities")
	}
	if err := db.EvaluateSources(ctx, options.now().UTC()); err != nil {
		return errors.New("source freshness could not be initialized")
	}
	handler := httpapi.NewRuntime(db, credentials, httpapi.ReloadOptions{ConfigPath: *configPath, OwnerRef: *ownerRef, ReadOnlyRef: *readonlyRef, Sender: sender, SenderFactory: options.senderFactory, Now: options.now})
	if err := handler.EvaluateRules(ctx, options.now().UTC()); err != nil {
		fmt.Fprintln(output, "signalhub: rule evaluation failed; retrying each minute")
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return errors.New("could not bind requested interface")
	}
	server := &http.Server{
		Handler:           web.Handler(handler),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    128 << 10, // bounded escaped metric group keys from <=16 KiB event data
	}
	workerCtx, stopWorker := context.WithCancel(ctx)
	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		ruleTicker := time.NewTicker(time.Minute)
		defer ruleTicker.Stop()
		for {
			select {
			case <-workerCtx.Done():
				return
			case <-ticker.C:
				if err := handler.EvaluateSources(workerCtx, options.now().UTC()); err != nil && workerCtx.Err() == nil {
					fmt.Fprintln(output, "signalhub: source freshness evaluation failed; retrying")
				}
			case <-ruleTicker.C:
				if err := handler.EvaluateRules(workerCtx, options.now().UTC()); err != nil && workerCtx.Err() == nil {
					fmt.Fprintln(output, "signalhub: rule evaluation failed; retrying each minute")
				}
			}
		}
	}()
	deliveryDone := make(chan struct{})
	go func() {
		defer close(deliveryDone)
		ticker := time.NewTicker(options.deliveryInterval)
		defer ticker.Stop()
		for {
			if err := handler.Dispatch(workerCtx, options.now().UTC(), "http://"+listener.Addr().String()); err != nil && workerCtx.Err() == nil {
				fmt.Fprintln(output, "signalhub: delivery dispatch failed; retrying")
			}
			select {
			case <-workerCtx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	defer func() { stopWorker(); <-workerDone; <-deliveryDone }()
	result := make(chan error, 1)
	go func() { result <- server.Serve(listener) }()
	fmt.Fprintf(output, "signalhub listening on %s\n", listener.Addr())
	select {
	case err := <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return errors.New("HTTP server stopped unexpectedly")
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
			return errors.New("HTTP shutdown deadline exceeded")
		}
		return nil
	}
}
