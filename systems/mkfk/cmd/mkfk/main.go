// Command mkfk is the broker: `mkfk format` prepares an empty data
// directory; `mkfk serve` recovers it and serves the client, peer, and
// admin listeners until SIGINT or SIGTERM.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/broker"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

const defaultShutdownTimeout = 10 * time.Second

func main() {
	if err := run(os.Args[1:], os.Stderr); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "mkfk:", err)
		os.Exit(1)
	}
}

func run(arguments []string, stderr io.Writer) error {
	if len(arguments) == 0 {
		return errors.New("usage: mkfk <format|serve> --data-dir DIR --node-id N --cluster-json FILE")
	}
	switch arguments[0] {
	case "format":
		return runFormat(arguments[1:], stderr)
	case "serve":
		return runServe(arguments[1:], stderr)
	default:
		return fmt.Errorf("unknown command %q", arguments[0])
	}
}

type nodeFlags struct {
	dataDir     string
	nodeID      uint
	clusterJSON string
}

func parseNodeFlags(name string, arguments []string, extra func(*flag.FlagSet)) (nodeFlags, []byte, error) {
	flags := flag.NewFlagSet(name, flag.ContinueOnError)
	var node nodeFlags
	flags.StringVar(&node.dataDir, "data-dir", "", "broker data directory")
	flags.UintVar(&node.nodeID, "node-id", 0, "this broker's ID in the cluster topology")
	flags.StringVar(&node.clusterJSON, "cluster-json", "", "cluster topology file (identical bytes on every broker)")
	if extra != nil {
		extra(flags)
	}
	if err := flags.Parse(arguments); err != nil {
		return nodeFlags{}, nil, err
	}
	if node.dataDir == "" || node.nodeID == 0 || node.nodeID > 1<<31 || node.clusterJSON == "" {
		return nodeFlags{}, nil, errors.New("--data-dir, --node-id, and --cluster-json are required")
	}
	topology, err := os.ReadFile(node.clusterJSON)
	if err != nil {
		return nodeFlags{}, nil, err
	}
	return node, topology, nil
}

// runFormat initializes an empty data directory. A directory that already
// holds a storage manifest is only verified against this node and topology
// (SDD §6.3), never overwritten, so a deployment can run format on every
// start.
func runFormat(arguments []string, stderr io.Writer) error {
	node, topology, err := parseNodeFlags("format", arguments, nil)
	if err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(node.dataDir, "manifest.json")); err == nil {
		dataDir, err := storage.OpenDataDir(node.dataDir, uint32(node.nodeID), topology)
		if err != nil {
			return fmt.Errorf("existing data directory does not match: %w", err)
		}
		_, _ = fmt.Fprintln(stderr, "mkfk: data directory already formatted; node and topology verified")
		return dataDir.Close()
	}
	return storage.FormatDataDir(node.dataDir, uint32(node.nodeID), topology)
}

func runServe(arguments []string, stderr io.Writer) error {
	var allowInsecure bool
	var peerBind string
	var shutdownTimeout time.Duration
	node, topology, err := parseNodeFlags("serve", arguments, func(flags *flag.FlagSet) {
		flags.BoolVar(&allowInsecure, "allow-insecure-bind", false, "allow non-loopback listeners without TLS or authentication")
		flags.StringVar(&peerBind, "peer-bind", "", "bind the peer listener here instead of the topology's peer_addr")
		flags.DurationVar(&shutdownTimeout, "shutdown-timeout", defaultShutdownTimeout, "bound on draining in-flight requests")
	})
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewJSONHandler(stderr, nil))
	b, err := broker.Open(broker.Config{
		Topology: topology, NodeID: uint32(node.nodeID), DataDir: node.dataDir,
		AllowInsecureBind: allowInsecure, PeerBind: peerBind, Logger: logger,
	})
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := b.Start(); err != nil {
		b.Shutdown(context.Background())
		return err
	}
	<-ctx.Done()
	logger.Info("shutdown requested", "timeout", shutdownTimeout.String())
	drain, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	b.Shutdown(drain)
	return nil
}
