package httpapi

import "testing"

func TestM3RoutesEnforceRoles(t *testing.T) {
	h, _ := setup(t)
	for _, path := range []string{"/v1/rules", "/v1/metrics/deploy-count"} {
		for _, tc := range []struct {
			token  string
			status int
		}{{"", 401}, {sourceToken, 403}} {
			status, _ := request(t, h, "GET", path, tc.token, "", "")
			if status != tc.status {
				t.Errorf("%s got %d want %d", path, status, tc.status)
			}
		}
	}
	for _, tc := range []struct {
		token  string
		status int
	}{{"", 401}, {sourceToken, 403}, {readerToken, 403}} {
		status, _ := request(t, h, "POST", "/v1/config:reload", tc.token, "", "")
		if status != tc.status {
			t.Errorf("reload got %d want %d", status, tc.status)
		}
	}
}
