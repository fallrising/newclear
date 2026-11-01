package main

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSDNotifyDatagram(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notify.sock")
	listener, err := net.ListenUnixgram("unixgram", &net.UnixAddr{Name: path, Net: "unixgram"})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = listener.Close() }()
	t.Setenv("NOTIFY_SOCKET", path)
	for _, message := range []string{"READY=1", "STOPPING=1"} {
		if err := notifySystemd(message); err != nil {
			t.Fatal(err)
		}
		if err := listener.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
			t.Fatal(err)
		}
		var buffer [64]byte
		n, _, err := listener.ReadFromUnix(buffer[:])
		if err != nil || string(buffer[:n]) != message {
			t.Fatalf("datagram=%q err=%v", buffer[:n], err)
		}
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := notifyReady(); err == nil || strings.Contains(err.Error(), path) {
		t.Fatalf("sanitization error=%v", err)
	}
}

func TestSDNotifyAbstractAbsentAndInvalid(t *testing.T) {
	name := fmt.Sprintf("@prism-notify-%d-%d", os.Getpid(), time.Now().UnixNano())
	listener, err := net.ListenUnixgram("unixgram", &net.UnixAddr{Name: name, Net: "unixgram"})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = listener.Close() }()
	t.Setenv("NOTIFY_SOCKET", name)
	if err := notifyReady(); err != nil {
		t.Fatal(err)
	}
	if err := listener.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	var message [64]byte
	n, _, err := listener.ReadFromUnix(message[:])
	if err != nil || string(message[:n]) != "READY=1" {
		t.Fatalf("abstract datagram=%q err=%v", message[:n], err)
	}
	t.Setenv("NOTIFY_SOCKET", "")
	if err := notifyStopping(); err != nil {
		t.Fatalf("absent socket: %v", err)
	}
	t.Setenv("NOTIFY_SOCKET", "relative.sock")
	if err := notifyReady(); err == nil || !strings.Contains(err.Error(), "invalid socket") {
		t.Fatalf("invalid socket: %v", err)
	}
}
