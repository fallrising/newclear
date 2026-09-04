package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/fallrising/fleet-catalog/internal/api"
	"github.com/fallrising/fleet-catalog/internal/cf"
	"github.com/fallrising/fleet-catalog/internal/config"
	"github.com/fallrising/fleet-catalog/internal/db"
	"github.com/fallrising/fleet-catalog/internal/ingress"
	"github.com/fallrising/fleet-catalog/internal/store"
	"github.com/fallrising/fleet-catalog/internal/ui"
	"github.com/fallrising/fleet-catalog/internal/version"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.LoadFleetd()
	if err != nil {
		log.Error("config", "err", err.Error())
		os.Exit(1)
	}
	sqldb, err := db.Open(cfg.DB)
	if err != nil {
		log.Error("sqlite", "err", err.Error())
		os.Exit(1)
	}
	defer sqldb.Close()
	st := store.New(sqldb)
	inserted, err := st.EnsureBootstrapTokens(cfg.BootstrapOperatorToken, cfg.BootstrapNodeToken)
	if err != nil {
		log.Error("bootstrap", "err", err.Error())
		os.Exit(1)
	}
	if !inserted && cfg.BootstrapOperatorToken != "" {
		has, _ := st.HasOperator()
		if has {
			log.Info("bootstrap_operator_token_ignored")
		}
	}
	var rec ingress.Reconciler = ingress.Noop{}
	if cfg.CFAPIToken != "" {
		cfc := cf.New(cfg, st, log)
		rec = cfc
		go cfc.RunWorkers(context.Background())
	}
	pages, err := ui.New(st)
	if err != nil {
		log.Error("ui", "err", err.Error())
		os.Exit(1)
	}
	srvAPI := api.New(cfg, st, rec, pages)
	httpSrv := &http.Server{Addr: cfg.Listen, Handler: srvAPI}
	go func() {
		log.Info("listen", "addr", cfg.Listen, "version", version.Version)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("http", "err", err.Error())
			os.Exit(1)
		}
	}()
	go func() {
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		for range t.C {
			if n, err := st.SweepTimeouts(); err != nil {
				log.Error("tombstone_timeout", "err", err.Error())
			} else if n > 0 {
				log.Info("tombstone_timeout", "n", n)
			}
		}
	}()
	go func() {
		ctx := context.Background()
		for {
			if err := rec.EnsureOTPProvider(ctx); err != nil {
				log.Error("cf_error", "err", err.Error())
			}
			time.Sleep(60 * time.Second)
		}
	}()
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
	<-ch
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(ctx)
}
