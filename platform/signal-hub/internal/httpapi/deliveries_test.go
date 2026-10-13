package httpapi

import "testing"

func TestM4RoutesEnforceRoles(t *testing.T) {
	h, _ := setup(t)
	for _, path := range []string{"/v1/subscriptions", "/v1/deliveries"} {
		for _, tc := range []struct {
			token  string
			status int
		}{{"", 401}, {sourceToken, 403}, {readerToken, 200}, {ownerToken, 200}} {
			status, _ := request(t, h, "GET", path, tc.token, "", "")
			if status != tc.status {
				t.Errorf("%s status=%d want=%d", path, status, tc.status)
			}
		}
	}
	for _, tc := range []struct {
		token  string
		status int
	}{{"", 401}, {sourceToken, 403}, {readerToken, 403}, {ownerToken, 404}} {
		status, _ := request(t, h, "POST", "/v1/deliveries/missing:1:replay", tc.token, "application/json", `{"reason":"synthetic retry"}`)
		if status != tc.status {
			t.Errorf("replay status=%d want=%d", status, tc.status)
		}
	}
}

func TestM4QueriesAndReplayValidation(t *testing.T) {
	h, _ := setup(t)
	for _, path := range []string{"/v1/subscriptions?state=dlq", "/v1/subscriptions?limit=0", "/v1/deliveries?state=bad", "/v1/deliveries?state=dlq&state=pending", "/v1/deliveries?limit=201", "/v1/deliveries?subscription="} {
		status, _ := request(t, h, "GET", path, readerToken, "", "")
		if status != 400 {
			t.Errorf("%s=%d", path, status)
		}
	}
	for _, tc := range []struct {
		body, ct string
		status   int
	}{{`{`, "application/json", 400}, {`{}`, "application/json", 400}, {`{"reason":"  "}`, "application/json", 400}, {`{"reason":"x","other":1}`, "application/json", 400}, {`{"reason":"x","reason":"y"}`, "application/json", 400}, {`{"reason":"x"}`, "text/plain", 415}} {
		status, _ := request(t, h, "POST", "/v1/deliveries/missing:1:replay", ownerToken, tc.ct, tc.body)
		if status != tc.status {
			t.Errorf("%s=%d want %d", tc.body, status, tc.status)
		}
	}
}
