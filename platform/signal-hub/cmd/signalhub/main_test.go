package main

import "testing"

func TestListenerBoundary(t *testing.T) {
	for _, value := range []string{"127.0.0.1:8080", "[::1]:0", "100.64.0.1:8080", "[fd7a:115c:a1e0::1]:8080"} {
		if _, err := listenAddress(value); err != nil {
			t.Errorf("valid %q: %v", value, err)
		}
	}
	for _, value := range []string{":8080", "0.0.0.0:8080", "[::]:8080", "192.168.1.1:8080", "example.invalid:8080", "8.8.8.8:8080", "127.0.0.1:-1", "[fe80::1%lo]:8080"} {
		if _, err := listenAddress(value); err == nil {
			t.Errorf("accepted %q", value)
		}
	}
}
