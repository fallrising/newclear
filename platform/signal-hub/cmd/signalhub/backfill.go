package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/config"
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
	"github.com/fallrising/newclear/platform/signal-hub/internal/rules"
	"github.com/fallrising/newclear/platform/signal-hub/internal/store"
)

func backfill(ctx context.Context, args []string, output io.Writer) error {
	flags := flag.NewFlagSet("signalhub rules backfill", flag.ContinueOnError)
	flags.SetOutput(output)
	configPath := flags.String("config", "", "strict JSON configuration path")
	dbPath := flags.String("db", "", "existing SQLite database")
	id := flags.String("rule", "", "active rule ID")
	fromRaw := flags.String("from", "", "inclusive UTC date or RFC3339 timestamp")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return errors.New("invalid backfill options")
	}
	if flags.NArg() != 0 || *configPath == "" || *dbPath == "" || *id == "" || *fromRaw == "" {
		return errors.New("backfill requires config, db, rule and from")
	}
	from, err := event.ParseTime(*fromRaw)
	if err != nil {
		from, err = time.Parse("2006-01-02", *fromRaw)
	}
	now := time.Now().UTC()
	if err != nil || !from.Before(now) {
		return errors.New("from must be a date or RFC3339 timestamp before now")
	}
	cfg, err := config.Load(*configPath)
	if err != nil {
		return errors.New("configuration is invalid or unavailable")
	}
	definitions, err := rules.Parse(cfg.Rules)
	if err != nil {
		return errors.New("rule configuration is invalid")
	}
	var selected *rules.Rule
	for _, rule := range definitions {
		if rule.ID == *id {
			selected = &rule
			break
		}
	}
	if selected == nil {
		return errors.New("requested rule is absent from configuration")
	}
	db, err := store.Open(*dbPath)
	if err != nil {
		return errors.New("database could not be opened")
	}
	defer db.Close()
	active, err := db.ActiveRules(ctx)
	if err != nil {
		return errors.New("active rules unavailable")
	}
	want, err := selected.Hash()
	if err != nil {
		return errors.New("invalid rule definition")
	}
	found := false
	for _, rule := range active {
		if rule.ID == *id {
			hash, err := rule.Hash()
			found = err == nil && hash == want && rule.Version == selected.Version
			break
		}
	}
	if !found {
		return errors.New("configuration differs from the active rule; reload the service first")
	}
	if err := db.BackfillRule(ctx, *id, from.UTC().Format(time.RFC3339Nano), now); err != nil {
		return errors.New("backfill failed; verify range and database availability")
	}
	fmt.Fprintln(output, "backfill completed")
	return nil
}
