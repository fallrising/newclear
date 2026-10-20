package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"

	"github.com/fallrising/newclear/platform/prism/internal/alerting/rules"
)

var activeRules atomic.Pointer[rules.Loader]

func setActiveRules(loader *rules.Loader) {
	activeRules.Store(loader)
}

func activeRuleSet() (rules.Set, bool) {
	loader := activeRules.Load()
	if loader == nil {
		return rules.Set{}, false
	}
	return loader.Current(), true
}

// startRuleReload loads rules and applies later SIGHUP reloads.
// SIGHUP is not added to the SIGINT/SIGTERM process context.
// The returned stop function ends the watcher even when ctx is still active.
func startRuleReload(ctx context.Context, path string, logger *slog.Logger) (func(), error) {
	loader, err := rules.Load(ctx, path)
	if err != nil {
		return nil, fmt.Errorf("load rules: %w", err)
	}
	setActiveRules(loader)
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGHUP)
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Go(func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-stop:
				return
			case <-signals:
				if err := loader.Reload(ctx); err != nil {
					logger.ErrorContext(ctx, "loading groups failed", "component", "rules", "error", err)
					logger.ErrorContext(ctx, "previous rule set restored", "component", "rules")
				}
			}
		}
	})
	return func() {
		signal.Stop(signals)
		close(stop)
		wg.Wait()
		setActiveRules(nil)
	}, nil
}
