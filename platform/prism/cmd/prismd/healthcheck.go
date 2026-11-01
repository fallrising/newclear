package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

const maxHealthBody = 4096

func runHealthcheck(parent context.Context, arguments []string, stderr io.Writer) int {
	flags := flag.NewFlagSet("healthcheck", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	endpoint := flags.String("url", "", "health URL")
	timeout := flags.Duration("timeout", 3*time.Second, "request timeout")
	if err := flags.Parse(arguments); err != nil || flags.NArg() != 0 || *timeout <= 0 || *timeout > 30*time.Second {
		writef(stderr, "prismd healthcheck: invalid arguments\n")
		return 2
	}
	if err := healthcheck(parent, *endpoint, *timeout); err != nil {
		writef(stderr, "prismd healthcheck: %v\n", err)
		return 1
	}
	return 0
}

func healthcheck(parent context.Context, endpoint string, timeout time.Duration) (result error) {
	parsed, err := url.Parse(endpoint)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" || parsed.Opaque != "" {
		return errors.New("invalid health URL")
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	transport := http.DefaultTransport.(*http.Transport).Clone()
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return errors.New("invalid health URL")
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("request failed: %w", sanitizeHealthError(err))
	}
	defer func() {
		if err := response.Body.Close(); err != nil {
			result = errors.Join(result, errors.New("health response close failed"))
		}
	}()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("unhealthy status %d", response.StatusCode)
	}
	count, err := io.CopyN(io.Discard, response.Body, maxHealthBody+1)
	if err != nil && !errors.Is(err, io.EOF) {
		return errors.New("health response read failed")
	}
	if count > maxHealthBody {
		return errors.New("health response too large")
	}
	return nil
}

func sanitizeHealthError(err error) error {
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return errors.New("connection unavailable")
}
