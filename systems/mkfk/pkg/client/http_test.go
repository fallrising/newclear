package client

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

func TestM5OP04HTTPTransportAcceptsOnlyKnownLeaderHints(t *testing.T) {
	t.Parallel()
	hosts := make([]string, 0)
	doer := httpDoerFunc(func(request *http.Request) (*http.Response, error) {
		hosts = append(hosts, request.URL.Host)
		if len(hosts) == 1 {
			return jsonHTTPResponse(409, `{
  "request_id":"request-fixed",
  "error":{"code":"NOT_LEADER","message":"move","retryable":true,"outcome":"not_applied","details":{"leader_id":2}}
}`), nil
		}
		return jsonHTTPResponse(200, `{
  "request_id":"request-fixed",
  "data":{"base_offset":"0","last_offset":"0","next_sequence":"1","duplicate":false,"leader_term":"4"}
}`), nil
	})
	transport, err := NewHTTPTransport(doer, map[uint32]string{
		1: "http://broker-one.invalid:9092", 2: "http://broker-two.invalid:9092",
	}, 1)
	if err != nil {
		t.Fatal(err)
	}
	request := clientHTTPProduceRequest()
	if _, err := transport.Produce(context.Background(), "request-fixed", request); err == nil {
		t.Fatal("NOT_LEADER response unexpectedly succeeded")
	}
	if transport.CurrentBroker() != 2 {
		t.Fatalf("known leader hint was not accepted: %d", transport.CurrentBroker())
	}
	response, err := transport.Produce(context.Background(), "request-fixed", request)
	if err != nil || response.NextSequence != 1 {
		t.Fatalf("known hinted broker response = %#v, %v", response, err)
	}
	if len(hosts) != 2 || hosts[0] != "broker-one.invalid:9092" || hosts[1] != "broker-two.invalid:9092" {
		t.Fatalf("request hosts = %v", hosts)
	}

	unknownDoer := httpDoerFunc(func(_ *http.Request) (*http.Response, error) {
		return jsonHTTPResponse(409, `{
  "request_id":"request-fixed",
  "error":{"code":"NOT_LEADER","message":"untrusted","retryable":true,"outcome":"not_applied","details":{"leader_id":99}}
}`), nil
	})
	unknown, err := NewHTTPTransport(unknownDoer, map[uint32]string{1: "http://broker-one.invalid:9092"}, 1)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = unknown.Produce(context.Background(), "request-fixed", request)
	if unknown.CurrentBroker() != 1 {
		t.Fatalf("unknown leader hint changed broker to %d", unknown.CurrentBroker())
	}
}

func clientHTTPProduceRequest() protocol.ProduceRequest {
	value := "eA=="
	return protocol.ProduceRequest{
		Topic: "events", ProducerID: clientTestProducerID, Acks: "all",
		Records: []protocol.WireRecord{{KeyBase64: []byte("null"), ValueBase64: &value}},
	}
}

type httpDoerFunc func(*http.Request) (*http.Response, error)

func (function httpDoerFunc) Do(request *http.Request) (*http.Response, error) {
	return function(request)
}

func jsonHTTPResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}
