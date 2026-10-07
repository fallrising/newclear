package broker

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/config"
	"github.com/fallrising/newclear/systems/mkfk/internal/peer"
	"github.com/fallrising/newclear/systems/mkfk/internal/replication"
	"github.com/fallrising/newclear/systems/mkfk/internal/transport"
)

const (
	readHeaderTimeout = 5 * time.Second
	maxHeaderBytes    = 64 << 10
)

// Start runs boot steps 8–11: the peer listener first so Raft traffic can
// flow, then the client and admin listeners. readyz turns true only after
// every listener is up and no partition has failed.
func (b *Broker) Start() error {
	peerServer, err := peer.NewServer(peerBackend{b}, b.manifest.ClusterID, b.configHash)
	if err != nil {
		return err
	}
	clientMux, err := b.clientMux()
	if err != nil {
		return err
	}
	for _, listener := range []struct {
		name    string
		address string
		handler http.Handler
	}{
		{"peer", b.self.PeerAddr, peerServer},
		{"client", b.self.ClientAddr, clientMux},
		{"admin", b.self.AdminAddr, b.adminMux()},
	} {
		if err := b.listen(listener.name, listener.address, listener.handler); err != nil {
			b.stopServers(context.Background())
			return err
		}
	}
	b.ready.Store(true)
	b.logger.Info("broker ready", "client", b.self.ClientAddr, "peer", b.self.PeerAddr, "admin", b.self.AdminAddr)
	return nil
}

func (b *Broker) listen(name, address string, handler http.Handler) error {
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return err
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: readHeaderTimeout, MaxHeaderBytes: maxHeaderBytes}
	b.servers = append(b.servers, server)
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			b.logger.Error("listener stopped", "listener", name, "error", err.Error())
			b.ready.Store(false)
		}
	}()
	return nil
}

func (b *Broker) clientMux() (*http.ServeMux, error) {
	backend := clientBackend{b}
	producers, err := transport.NewProducerHandler(backend)
	if err != nil {
		return nil, err
	}
	fetch, err := transport.NewFetchHandler(backend)
	if err != nil {
		return nil, err
	}
	groups, err := transport.NewGroupHandler(backend)
	if err != nil {
		return nil, err
	}
	metadata, err := transport.NewMetadataHandler(backend)
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.Handle("/v1/producers/open", producers)
	mux.Handle("/v1/produce", producers)
	mux.Handle("/v1/fetch", fetch)
	mux.Handle("/v1/groups/", groups)
	mux.Handle("/v1/metadata", metadata)
	return mux, nil
}

// Shutdown stops admission, lets in-flight requests finish within ctx
// (their outcome is reported, or unknown), stops every partition, and
// releases the data-dir lock.
func (b *Broker) Shutdown(ctx context.Context) {
	b.ready.Store(false)
	b.stopServers(ctx)
	b.closePartitions()
	b.logger.Info("broker stopped")
}

func (b *Broker) stopServers(ctx context.Context) {
	for _, server := range b.servers {
		if err := server.Shutdown(ctx); err != nil {
			_ = server.Close()
		}
	}
	b.servers = nil
}

// Ready reports readyz: listeners up and every local partition serving.
func (b *Broker) Ready() bool {
	if !b.ready.Load() {
		return false
	}
	for _, r := range b.replicas {
		if r.actor.Err() != nil {
			return false
		}
	}
	return true
}

func replicationConfig(nodeID uint32, spec config.Partition) replication.Config {
	return replication.Config{NodeID: nodeID, Voters: spec.Replicas, MinISR: int(spec.MinISR)}
}
