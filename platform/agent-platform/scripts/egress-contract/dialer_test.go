package pool

import (
	"context"
	"encoding/binary"
	"errors"
	"net"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

// A real UDP DNS exchange, TTL zero, with answers changed between connections.
// Public destinations stop AFTER the original guard, before any TCP SYN.
func TestDNSRebindingChecksEveryResolvedDial(t *testing.T) {
	dns, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer dns.Close()
	var answer atomic.Value
	answer.Store("1.1.1.1")
	go func() {
		for {
			buf := make([]byte, 4096)
			n, peer, err := dns.ReadFrom(buf)
			if err != nil {
				return
			}
			query := buf[:n]
			end := 12
			for end < n && query[end] != 0 {
				end += int(query[end]) + 1
			}
			end += 5
			if end > n {
				continue
			}
			typ := binary.BigEndian.Uint16(query[end-4 : end-2])
			ip := net.ParseIP(answer.Load().(string))
			var addr []byte
			if typ == 1 {
				addr = ip.To4()
			}
			if typ == 28 && ip.To4() == nil {
				addr = ip.To16()
			}
			response := append([]byte(nil), query[:end]...)
			binary.BigEndian.PutUint16(response[2:4], 0x8180)
			for i := 6; i < 12; i++ {
				response[i] = 0
			}
			if addr != nil {
				binary.BigEndian.PutUint16(response[6:8], 1)
				response = append(response, 0xc0, 0x0c, byte(typ>>8), byte(typ), 0, 1, 0, 0, 0, 0, 0, byte(len(addr)))
				response = append(response, addr...)
			}
			_, _ = dns.WriteTo(response, peer)
		}
	}()
	d := newEgressDialer(nil)
	d.Resolver = &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "udp", dns.LocalAddr().String())
	}}
	guard := d.Control
	var allowed atomic.Int32
	d.Control = func(network, address string, c syscall.RawConn) error {
		if err := guard(network, address, c); err != nil {
			return err
		}
		allowed.Add(1)
		return errors.New("public guard passed; test stops before connect")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err = d.DialContext(ctx, "tcp", "same-name.test:80")
	if err == nil || !strings.Contains(err.Error(), "public guard passed") || allowed.Load() != 1 {
		t.Fatalf("public positive control missing: %v", err)
	}
	// Same hostname, changing DNS: all forms must be rejected by the original dial guard.
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "100.100.100.200",
		"::1", "fd00::1", "fe80::1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::"} {
		answer.Store(ip)
		_, err = d.DialContext(ctx, "tcp", "same-name.test:80")
		if err == nil || !strings.Contains(err.Error(), "blocked internal address") || allowed.Load() != 1 {
			t.Fatalf("DNS rebind %s bypassed guard: %v", ip, err)
		}
	}
}

func TestSpecialAddressFormsCannotBypassGuard(t *testing.T) {
	guard := newEgressDialer(nil).Control
	for _, ip := range []string{"0.0.0.0", "127.0.0.1", "172.16.0.1", "192.168.0.1",
		"100.64.0.1", "169.254.169.254", "198.18.0.1", "192.0.2.1", "240.0.0.1",
		"::", "::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "64:ff9b::7f00:1",
		"64:ff9b:1::1", "2001::1", "2002:7f00:1::", "fc00::1", "fe80::1", "ff02::1"} {
		if err := guard("tcp", net.JoinHostPort(ip, "443"), nil); err == nil {
			t.Fatalf("allowed %s", ip)
		}
	}
	for _, ip := range []string{"1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"} {
		if err := guard("tcp", net.JoinHostPort(ip, "443"), nil); err != nil {
			t.Fatalf("public %s: %v", ip, err)
		}
	}
}
