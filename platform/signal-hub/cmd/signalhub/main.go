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
	"github.com/fallrising/newclear/platform/signal-hub/internal/httpapi"
	"github.com/fallrising/newclear/platform/signal-hub/internal/store"
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

func run(ctx context.Context, args []string, output io.Writer) error {
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
	db, err := store.Open(*dbPath)
	if err != nil {
		return errors.New("database could not be opened or migrated")
	}
	defer db.Close()
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return errors.New("could not bind requested interface")
	}
	server := &http.Server{
		Handler:           httpapi.New(db, credentials),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
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
