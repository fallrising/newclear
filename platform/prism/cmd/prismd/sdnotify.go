package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"strings"
	"time"
)

func notifyReady() error    { return notifySystemd("READY=1") }
func notifyStopping() error { return notifySystemd("STOPPING=1") }

func notifySystemd(message string) error {
	socket := os.Getenv("NOTIFY_SOCKET")
	if socket == "" {
		return nil
	}
	if abstract, ok := strings.CutPrefix(socket, "@"); ok {
		socket = "\x00" + abstract
	} else if !strings.HasPrefix(socket, "/") {
		return fmt.Errorf("sd_notify: invalid socket address")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	connection, err := (&net.Dialer{Timeout: time.Second}).DialContext(ctx, "unixgram", socket) //nolint:gosec // Validated local Unix datagram path supplied by the service manager.
	if err != nil {
		return fmt.Errorf("sd_notify: socket unavailable")
	}
	defer func() { _ = connection.Close() }()
	if err := connection.SetWriteDeadline(time.Now().Add(time.Second)); err != nil {
		return fmt.Errorf("sd_notify: set deadline: %w", err)
	}
	if _, err := connection.Write([]byte(message)); err != nil {
		return fmt.Errorf("sd_notify: send failed")
	}
	return nil
}
